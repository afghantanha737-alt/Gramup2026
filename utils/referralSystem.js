'use strict';

const crypto = require('crypto');
const User = require('../models/User');
const Settings = require('../models/Settings');
const ReferralRelationship = require('../models/ReferralRelationship');
const { withMongoTransaction } = require('./mongoTransaction');
const { sendNotificationOnce } = require('./notificationDelivery');
const {
  DEFAULT_REFERRAL_LEVEL_RATES,
  DEFAULT_REFERRAL_INITIAL_REWARD_POINTS,
  normalizeReferralRates,
  referralIdentifierQuery,
  calculateReferralCommission,
  reviewStatusOf
} = require('./referralCore');

function sessionQuery(query, session) {
  return session ? query.session(session) : query;
}

function safeRates(settings) {
  try { return normalizeReferralRates(settings?.referralLevelRates); }
  catch { return [...DEFAULT_REFERRAL_LEVEL_RATES]; }
}

function referralDiagnostic(stage, details = {}) {
  if (process.env.NODE_ENV !== 'test') return;
  console.info('[REFERRAL_DIAGNOSTIC]', JSON.stringify({ stage, ...details }));
}

async function getReferralSettings(session) {
  let query = Settings.findOne({ key: 'global' });
  if (session) query = query.session(session);
  const settings = await query;
  return {
    rates: safeRates(settings),
    // Exact current policy: each newly linked eligible direct invite credits 10 Points.
    // The persisted setting is intentionally not read, so stale admin values cannot alter it.
    initialRewardPoints: DEFAULT_REFERRAL_INITIAL_REWARD_POINTS
  };
}

function deterministicTransactionId(prefix, stableId) {
  return `${prefix}-${crypto.createHash('sha256').update(String(stableId)).digest('hex')}`;
}

function relationStatus(users) {
  const statuses = users.map(reviewStatusOf);
  if (statuses.includes('blocked')) return 'blocked';
  for (const value of ['fraud_review', 'restricted', 'under_review']) {
    if (statuses.includes(value)) return value;
  }
  return 'active';
}

async function createOrUpdateRelationship({ referrerId, referredUserId, level, status, source, session, initialRewardStatus }) {
  const update = {
    $set: { level, status, statusReason: status === 'active' ? '' : status, source },
    $setOnInsert: { referrerId, referredUserId, ...(initialRewardStatus ? { initialRewardStatus } : {}) }
  };
  return ReferralRelationship.findOneAndUpdate(
    { referrerId, referredUserId },
    update,
    { upsert: true, new: true, setDefaultsOnInsert: true, session }
  );
}

/**
 * Attaches a referred user exactly once. Only a newly-created parent-child link can
 * unlock the one-time initial reward; pre-existing links are marked legacy-exempt.
 */
async function linkReferral({ referredUserId, referrerId, riskScore = 0, riskFlags = [], source = 'signup' }) {
  if (!referredUserId || !referrerId || String(referredUserId) === String(referrerId)) return { linked: false, reason: 'invalid_link' };

  const result = await withMongoTransaction(async session => {
    let invitee = await sessionQuery(User.findById(referredUserId), session);
    const referrer = await sessionQuery(User.findById(referrerId), session);
    if (!invitee || !referrer || referrer.isBanned) return { linked: false, reason: 'invalid_referrer' };
    if (invitee.referredBy && String(invitee.referredBy) !== String(referrer._id)) return { linked: false, reason: 'already_linked' };

    let cycleCursor = referrer;
    const cycleSeen = new Set();
    for (let depth = 0; cycleCursor && depth < 100; depth += 1) {
      if (String(cycleCursor._id) === String(invitee._id)) return { linked: false, reason: 'referral_cycle' };
      if (!cycleCursor.referredBy || cycleSeen.has(String(cycleCursor._id))) break;
      cycleSeen.add(String(cycleCursor._id));
      cycleCursor = await sessionQuery(User.findById(cycleCursor.referredBy).select('_id referredBy'), session);
    }

    let linkedNow = false;
    if (!invitee.referredBy) {
      invitee = await User.findOneAndUpdate(
        { _id: invitee._id, referredBy: null },
        { $set: {
          referredBy: referrer._id,
          referralInitialRewardEligible: true,
          referralRiskScore: Math.max(0, Number(riskScore) || 0),
          referralRiskFlags: Array.isArray(riskFlags) ? riskFlags : []
        } },
        { new: true, session }
      );
      if (!invitee) return { linked: false, reason: 'concurrent_link' };
      linkedNow = true;
      await User.updateOne({ _id: referrer._id }, { $inc: { invitedCount: 1 } }, { session });
    }

    const { rates, initialRewardPoints } = await getReferralSettings(session);
    let currentAncestor = referrer;
    const relationshipPath = [invitee];
    const seen = new Set([String(invitee._id)]);
    let directRelationship = null;
    for (let level = 1; level <= rates.length && currentAncestor; level += 1) {
      const ancestorId = String(currentAncestor._id);
      if (seen.has(ancestorId)) break;
      seen.add(ancestorId);
      relationshipPath.push(currentAncestor);
      const chainStatus = relationStatus(relationshipPath);
      const relationship = await createOrUpdateRelationship({
        referrerId: currentAncestor._id,
        referredUserId: invitee._id,
        level,
        status: chainStatus,
        source,
        session,
        initialRewardStatus: level === 1 ? (linkedNow || invitee.referralInitialRewardEligible ? 'pending' : 'legacy_exempt') : 'not_applicable'
      });
      if (level === 1) directRelationship = relationship;
      if (!currentAncestor.referredBy) break;
      currentAncestor = await sessionQuery(User.findById(currentAncestor.referredBy).select('_id referredBy isBanned accountReviewStatus referralRiskBlocked referralRiskScore'), session);
    }

    let initialPaid = false;
    referralDiagnostic('relationship_registered', {
      directRelationshipStatus: directRelationship?.status || null,
      initialRewardStatus: directRelationship?.initialRewardStatus || null
    });
    const paymentGateReasons = [];
    if (!invitee.referralInitialRewardEligible) paymentGateReasons.push('referralInitialRewardEligible_false');
    if (!directRelationship) paymentGateReasons.push('directRelationship_missing');
    else if (directRelationship.status !== 'active') paymentGateReasons.push(`directRelationship_status_${directRelationship.status || 'missing'}`);
    referralDiagnostic('payment_gate', {
      referralInitialRewardEligible: Boolean(invitee.referralInitialRewardEligible),
      directRelationshipStatus: directRelationship?.status || null,
      initialRewardPoints,
      referralRiskScore: Number(invitee.referralRiskScore) || 0,
      referralRiskFlags: Array.isArray(invitee.referralRiskFlags) ? invitee.referralRiskFlags : [],
      accountReviewStatus: invitee.accountReviewStatus || 'normal',
      isBanned: Boolean(invitee.isBanned),
      referralRiskBlocked: Boolean(invitee.referralRiskBlocked),
      referrerAccountReviewStatus: referrer.accountReviewStatus || 'normal',
      referrerIsBanned: Boolean(referrer.isBanned),
      referrerReferralRiskBlocked: Boolean(referrer.referralRiskBlocked),
      referrerReferralRiskScore: Number(referrer.referralRiskScore) || 0,
      initialRewardStatus: directRelationship?.initialRewardStatus || null,
      paymentGatePassed: paymentGateReasons.length === 0,
      paymentGateReasons
    });
    if (invitee.referralInitialRewardEligible && directRelationship?.status === 'active') {
      const claimed = await User.findOneAndUpdate(
        { _id: invitee._id, referredBy: referrer._id, referralInitialRewardEligible: true },
        { $set: { referralInitialRewardEligible: false } },
        { new: true, session }
      );
      referralDiagnostic('claim', { result: claimed ? 'claimed' : 'null' });
      if (claimed) {
        const sourceId = `referral-initial:${invitee._id}`;
        if (initialRewardPoints > 0) {
          const PointsLedger = require('../models/PointsLedger');
          const existingLedger = await sessionQuery(PointsLedger.findOne({ sourceId }).select('_id'), session);
          if (!existingLedger) {
            const updatedReferrer = await User.findByIdAndUpdate(
              referrer._id,
              { $inc: { points: initialRewardPoints } },
              { new: true, session }
            );
            if (!updatedReferrer) throw new Error('دعوت‌کننده برای پاداش اولیه Referral پیدا نشد.');
            referralDiagnostic('points_update', { applied: true });
            const { recordLedgerRequired } = require('./ledger');
            const ledgerResult = await recordLedgerRequired({
              user: updatedReferrer._id,
              type: 'referral_initial',
              amount: initialRewardPoints,
              description: `پاداش اولیه دعوت کاربر ${invitee._id}`,
              balanceAfter: updatedReferrer.points,
              sourceId,
              transactionId: deterministicTransactionId('RI', invitee._id),
              referralLevel: 1,
              sourceUserId: invitee._id,
              recipientUserId: updatedReferrer._id,
              session
            });
            referralDiagnostic('ledger', { created: Boolean(ledgerResult.created) });
            if (!ledgerResult.created) {
              const error = new Error('Referral initial reward was concurrently recorded; abort to preserve idempotency.');
              error.code = 'REFERRAL_INITIAL_DUPLICATE_RACE';
              throw error;
            }
          }
        }
        if (directRelationship) {
          directRelationship.initialRewardStatus = 'paid';
          directRelationship.initialRewardTransactionId = deterministicTransactionId('RI', invitee._id);
          await directRelationship.save({ session });
        }
        initialPaid = true;
      }
    }

    referralDiagnostic('transaction_work_complete', {
      initialPaid,
      initialRewardStatus: directRelationship?.initialRewardStatus || null,
      referralInitialRewardEligible: Boolean(invitee.referralInitialRewardEligible)
    });

    if (directRelationship && !invitee.referralInitialRewardEligible && !linkedNow && directRelationship.initialRewardStatus !== 'paid') {
      directRelationship.initialRewardStatus = 'legacy_exempt';
      await directRelationship.save({ session });
    }

    const referredName = invitee.username
      ? `@${invitee.username}`
      : [invitee.firstName, invitee.lastName].filter(Boolean).join(' ') || '—';
    return {
      linked: linkedNow || Boolean(invitee.referredBy),
      created: linkedNow,
      initialPaid,
      referrerId: referrer._id,
      referredUserId: invitee._id,
      notification: initialPaid && initialRewardPoints > 0 ? {
        eventKey: `referral-initial:${invitee._id}`,
        type: 'referral_initial',
        user: referrer._id,
        telegramId: referrer.telegramId,
        language: referrer.language,
        referredName,
        rewardPoints: initialRewardPoints
      } : null
    };
  });

  referralDiagnostic('commit', { committed: true, initialPaid: Boolean(result.initialPaid) });

  if (result.notification) {
    referralDiagnostic('notification_trigger', { triggered: true });
    const notification = result.notification;
    sendNotificationOnce({
      eventKey: notification.eventKey,
      type: notification.type,
      user: notification.user,
      telegramId: notification.telegramId,
      text: require('./botMessages').botText(
        'referralInitial',
        notification.language,
        notification.referredName,
        notification.rewardPoints
      )
    }).catch(error => console.error('Referral notification failed:', error.message || error));
  } else {
    referralDiagnostic('notification_trigger', { triggered: false });
  }

  const { notification, ...publicResult } = result;
  return publicResult;
}

async function findReferrerByIdentifier(identifier, projection = '_id telegramId isBanned signupIpHash') {
  const query = referralIdentifierQuery(identifier);
  if (!query) return null;
  return User.findOne(query).select(projection);
}

async function linkReferralByIdentifier({ referredUserId, identifier, riskScore = 0, riskFlags = [], source = 'signup' }) {
  const query = referralIdentifierQuery(identifier);
  if (!query) return { linked: false, reason: 'invalid_referral_identifier' };
  const referrer = await User.findOne(query).select('_id isBanned');
  if (!referrer || referrer.isBanned || String(referrer._id) === String(referredUserId)) return { linked: false, reason: 'invalid_referrer' };
  return linkReferral({ referredUserId, referrerId: referrer._id, riskScore, riskFlags, source });
}

async function linkReferralByCode(options = {}) {
  return linkReferralByIdentifier({ ...options, identifier: options.identifier || options.referralCode });
}

/** Distributes commission only from the original earning ledger row, never from referral credits. */
async function distributeReferralCommissions(earningEntry, session) {
  const amount = Number(earningEntry?.amount);
  if (!session || !earningEntry?.user || !Number.isFinite(amount) || amount <= 0 || earningEntry.currency !== 'points') return [];
  const { isEligibleOriginalEarn } = require('./referralCore');
  if (!isEligibleOriginalEarn(earningEntry)) return [];
  if (!earningEntry.sourceId) throw new Error('Qualifying original earnings must have a stable sourceId for referral idempotency.');

  const { rates } = await getReferralSettings(session);
  const origin = await sessionQuery(User.findById(earningEntry.user).select('_id referredBy isBanned accountReviewStatus referralRiskBlocked referralRiskScore createdAt'), session);
  if (!origin || !origin.referredBy) return [];
  // evaluateReferralEligibility(origin, completions) is managed via referralSweep and task submission gates.
  const paid = [];
  const pathUsers = [origin];
  const seen = new Set([String(origin._id)]);
  let child = origin;
  for (let level = 1; level <= rates.length && child?.referredBy; level += 1) {
    const ancestor = await sessionQuery(User.findById(child.referredBy).select('_id telegramId referredBy isBanned accountReviewStatus referralRiskBlocked referralRiskScore'), session);
    if (!ancestor || seen.has(String(ancestor._id))) break;
    seen.add(String(ancestor._id));
    pathUsers.push(ancestor);

    const status = relationStatus(pathUsers);
    await createOrUpdateRelationship({
      referrerId: ancestor._id,
      referredUserId: origin._id,
      level,
      status,
      source: 'earning',
      session
    });

    const points = calculateReferralCommission(amount, rates[level - 1]);
    if (status === 'active' && points > 0) {
      const sourceId = `referral-commission:${earningEntry.sourceId}:recipient:${ancestor._id}:level:${level}`;
      const existing = await sessionQuery(require('../models/PointsLedger').findOne({ sourceId }).select('_id'), session);
      if (!existing) {
        const updatedReferrer = await User.findByIdAndUpdate(ancestor._id, { $inc: { points } }, { new: true, session });
        if (!updatedReferrer) throw new Error('دریافت‌کننده‌ی کمیسیون Referral پیدا نشد.');
        const transactionId = deterministicTransactionId('RC', sourceId);
        const { recordLedgerRequired } = require('./ledger');
        const ledgerResult = await recordLedgerRequired({
          user: ancestor._id,
          type: 'referral_commission',
          amount: points,
          description: `کمیسیون Referral سطح ${level} از کاربر ${origin._id}`,
          balanceAfter: updatedReferrer.points,
          sourceId,
          transactionId,
          referralLevel: level,
          sourceUserId: origin._id,
          recipientUserId: ancestor._id,
          commissionRatePercent: rates[level - 1],
          earningTransactionId: earningEntry.transactionId || earningEntry.sourceId,
          session
        });
        if (!ledgerResult.created) {
          const error = new Error('Referral commission was concurrently recorded; abort to preserve idempotency.');
          error.code = 'REFERRAL_COMMISSION_DUPLICATE_RACE';
          throw error;
        }
        paid.push({ level, recipientId: ancestor._id, amount: points, transactionId });
      }
    }
    child = ancestor;
  }
  return paid;
}

module.exports = { linkReferral, findReferrerByIdentifier, linkReferralByIdentifier, linkReferralByCode, distributeReferralCommissions, deterministicTransactionId };
