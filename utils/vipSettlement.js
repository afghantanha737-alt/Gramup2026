'use strict';

const VipSubscription = require('../models/VipSubscription');
const User = require('../models/User');
const PointsLedger = require('../models/PointsLedger');
const { recordLedgerRequired } = require('./ledger');
const { withMongoTransaction } = require('./mongoTransaction');

function duplicateLedgerError() {
  const error = new Error('VIP principal return was already recorded; transaction was aborted to prevent a duplicate credit.');
  error.code = 'VIP_LEDGER_DUPLICATE';
  error.statusCode = 409;
  return error;
}

function legacySettlementFilter({ subscriptionId = null, now = new Date() } = {}) {
  const filter = {
    status: 'active',
    policyVersion: { $in: [null, 'legacy_v1'] },
    principalReturnedAt: null,
    reconciliationStatus: { $nin: ['needs_review', 'ineligible', 'settled'] },
    endAt: { $lte: now }
  };
  if (subscriptionId) filter._id = subscriptionId;
  return filter;
}

/**
 * Settle one eligible legacy subscription inside a caller-owned transaction.
 * This function intentionally does not create a transaction by itself; callers
 * must use an explicit reconciliation transaction.
 */
async function settleLegacyVipSubscriptionInSession(subscriptionId, now, session) {
  const sourceId = `vip:${subscriptionId}:principal`;
  const subscription = await VipSubscription.findOne(legacySettlementFilter({ subscriptionId, now })).session(session);
  if (!subscription) return { settled: false, skipped: true };

  const previousLedger = await PointsLedger.findOne({ sourceId }).session(session);
  if (previousLedger) {
    subscription.status = 'completed';
    subscription.reconciliationStatus = 'settled';
    subscription.principalReturnedAt = previousLedger.createdAt || now;
    await subscription.save({ session });
    return { settled: false, alreadyRecorded: true, subscriptionId: String(subscription._id) };
  }

  subscription.status = 'completed';
  subscription.reconciliationStatus = 'settled';
  subscription.principalReturnedAt = now;
  await subscription.save({ session });

  const user = await User.findOneAndUpdate(
    { _id: subscription.user },
    { $inc: { points: subscription.pricePoints } },
    { new: true, session }
  );
  if (!user) throw new Error('VIP subscriber no longer exists; principal return transaction was not committed.');

  const ledger = await recordLedgerRequired({
    user: user._id,
    type: 'vip_principal_return',
    currency: 'points',
    amount: subscription.pricePoints,
    description: 'Authorized legacy VIP reconciliation',
    balanceAfter: user.points,
    sourceId,
    transactionId: sourceId,
    session
  });
  if (!ledger.created) throw duplicateLedgerError();

  return {
    settled: true,
    subscriptionId: String(subscription._id),
    userId: String(user._id),
    points: user.points,
    amount: subscription.pricePoints
  };
}

// Compatibility helper retained for existing explicit callers. It is no longer
// used by application startup or the normal VIP catalog endpoint.
async function settleOne(subscriptionId, now) {
  return withMongoTransaction(session => settleLegacyVipSubscriptionInSession(subscriptionId, now, session));
}

async function settleMaturedVipSubscriptions({ userId = null, now = new Date(), limit = 100 } = {}) {
  const filter = legacySettlementFilter({ now });
  if (userId) filter.user = userId;
  const rows = await VipSubscription.find(filter).select('_id').sort({ endAt: 1 }).limit(Math.min(500, Math.max(1, limit))).lean();
  const results = [];
  for (const row of rows) {
    try {
      results.push(await settleOne(row._id, now));
    } catch (error) {
      console.error('VIP principal settlement failed:', String(row._id), error.message || error);
      results.push({ settled: false, error: error.code || 'SETTLEMENT_FAILED' });
    }
  }
  return { scanned: rows.length, settled: results.filter(result => result.settled).length, results };
}

module.exports = {
  legacySettlementFilter,
  settleLegacyVipSubscriptionInSession,
  settleMaturedVipSubscriptions
};
