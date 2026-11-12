'use strict';
const express = require('express');
const router = express.Router();
require('../utils/asyncHandler').wrapRouter(router);
const { requireUnifiedAuth } = require('../utils/unifiedAuth');
const { withMembership } = require('../utils/membership');
const { recordLedgerRequired } = require('../utils/ledger');
const { executeIdempotently, validateIdempotencyKey, idempotencyTransactionId } = require('../utils/idempotency');
const { sensitiveRateLimit } = require('../utils/apiSecurity');
const User = require('../models/User');
const PointsLedger = require('../models/PointsLedger');
const Settings = require('../models/Settings');
const VipSubscription = require('../models/VipSubscription');
const { releaseForPayout } = require('../utils/vipReserve');
const { NEW_VIP_POLICY_VERSION } = require('../utils/vipPolicy');
const { calculateVipSubscriptionAccrual, calculateVipSubscriptionCycleAccrual, calculateVipMiningStatus, calculateVipMiningCycleStatus, isVipMiningEligible, ACTIVE_STATUSES, MICRO_UNITS_PER_POINT, MINING_CYCLE_SECONDS } = require('../utils/vipMining');

const auth = withMembership(requireUnifiedAuth(process.env.BOT_TOKEN));
const claimRateLimit = sensitiveRateLimit('claim');
const startRateLimit = sensitiveRateLimit('general');
const MINING_HISTORY_LIMIT = 20;

// Mining Rig Levels (Points / hour & Upgrade cost in Points)
const RIG_LEVELS = [
  { level: 1, ratePerHour: 20, upgradeCost: 0, name: 'Basic CPU Miner' },
  { level: 2, ratePerHour: 45, upgradeCost: 150, name: 'Dual-Core Rig' },
  { level: 3, ratePerHour: 90, upgradeCost: 400, name: 'Quad-Core ASIC' },
  { level: 4, ratePerHour: 160, upgradeCost: 1000, name: 'Octa GPU Station' },
  { level: 5, ratePerHour: 260, upgradeCost: 2500, name: 'Quantum Cluster' },
  { level: 6, ratePerHour: 400, upgradeCost: 5000, name: 'Server Farm Rig' },
  { level: 7, ratePerHour: 600, upgradeCost: 10000, name: 'Hydra Supercomputer' },
  { level: 8, ratePerHour: 900, upgradeCost: 20000, name: 'Nebula Mining Array' },
  { level: 9, ratePerHour: 1400, upgradeCost: 45000, name: 'Dyson Swarm Harvester' },
  { level: 10, ratePerHour: 2200, upgradeCost: 100000, name: 'Singularity Core' }
];

// Battery / Storage Levels (Max hours of offline accumulation before storage is full)
const STORAGE_LEVELS = [
  { level: 1, maxHours: 3, upgradeCost: 0, name: 'Standard Battery (3h)' },
  { level: 2, maxHours: 6, upgradeCost: 100, name: 'Extended Pack (6h)' },
  { level: 3, maxHours: 12, upgradeCost: 300, name: 'Lithium Array (12h)' },
  { level: 4, maxHours: 18, upgradeCost: 750, name: 'Graphene Cell (18h)' },
  { level: 5, maxHours: 24, upgradeCost: 1500, name: 'Fusion Battery (24h)' },
  { level: 6, maxHours: 48, upgradeCost: 4000, name: 'Perpetual Cell (48h)' }
];

function getMiningState(user, now = new Date()) {
  const level = Math.min(Math.max(Number(user.miningLevel) || 1, 1), RIG_LEVELS.length);
  const storageLevel = Math.min(Math.max(Number(user.miningStorageLevel) || 1, 1), STORAGE_LEVELS.length);
  const rigConfig = RIG_LEVELS.find(r => r.level === level) || RIG_LEVELS[0];
  const storageConfig = STORAGE_LEVELS.find(s => s.level === storageLevel) || STORAGE_LEVELS[0];
  const nowMs = now.getTime();
  const boostExpiresAt = user.miningBoostExpiresAt ? new Date(user.miningBoostExpiresAt) : null;
  const isBoosted = Boolean(boostExpiresAt && boostExpiresAt.getTime() > nowMs);
  const effectiveRatePerHour = isBoosted ? rigConfig.ratePerHour * 2 : rigConfig.ratePerHour;
  // A missing anchor means the miner has not started; never infer one from account creation.
  const hasStartAnchor = Boolean(user.miningLastClaimAt);
  const lastClaimAt = hasStartAnchor ? new Date(user.miningLastClaimAt) : now;
  const lastClaimMs = lastClaimAt.getTime();
  const totalElapsedMs = hasStartAnchor ? Math.max(0, nowMs - lastClaimMs) : 0;
  let boostedMs = 0;
  let normalMs = 0;
  if (hasStartAnchor && boostExpiresAt && boostExpiresAt.getTime() > lastClaimMs) {
    const boostEndMs = Math.min(nowMs, boostExpiresAt.getTime());
    boostedMs = Math.max(0, boostEndMs - lastClaimMs);
    normalMs = Math.max(0, nowMs - boostEndMs);
  } else {
    normalMs = totalElapsedMs;
  }
  const baseRatePerMs = rigConfig.ratePerHour / (3600 * 1000);
  const newlyAccumulatedPoints = (boostedMs * baseRatePerMs * 2) + (normalMs * baseRatePerMs);
  const savedPoints = Number(user.miningSavedPoints) || 0;
  const totalRawPoints = savedPoints + newlyAccumulatedPoints;
  // Capacity is tied to storage hardware, not the temporary boost; it cannot shrink when boost expires.
  const maxStoragePoints = Math.max(1, Math.floor(storageConfig.maxHours * rigConfig.ratePerHour));
  const accumulatedPointsExact = Math.max(0, Math.min(maxStoragePoints, totalRawPoints));
  const accumulatedPoints = Math.max(0, Math.min(maxStoragePoints, Math.floor(totalRawPoints)));
  const nextRig = RIG_LEVELS.find(r => r.level === level + 1) || null;
  const nextStorage = STORAGE_LEVELS.find(s => s.level === storageLevel + 1) || null;
  const balance = Number(user.points) || 0;
  return {
    level, storageLevel, rigName: rigConfig.name, storageName: storageConfig.name,
    baseRatePerHour: rigConfig.ratePerHour, effectiveRatePerHour,
    maxStorageHours: storageConfig.maxHours, maxStoragePoints, accumulatedPoints, accumulatedPointsExact,
    isStorageFull: accumulatedPoints >= maxStoragePoints,
    elapsedSeconds: Math.floor(totalElapsedMs / 1000),
    storageFullSeconds: Math.floor(storageConfig.maxHours * 3600),
    isStarted: hasStartAnchor,
    miningLastClaimAt: hasStartAnchor ? lastClaimAt.toISOString() : null,
    isBoosted,
    boostExpiresAt: isBoosted ? boostExpiresAt.toISOString() : null,
    boostRemainingSeconds: isBoosted ? Math.max(0, Math.floor((boostExpiresAt.getTime() - nowMs) / 1000)) : 0,
    rigs: RIG_LEVELS.map(rig => ({ ...rig, owned: rig.level <= level, status: rig.level === level ? 'current' : rig.level < level ? 'owned' : 'locked' })),
    nextRigUpgrade: nextRig ? { level: nextRig.level, name: nextRig.name, ratePerHour: nextRig.ratePerHour, cost: nextRig.upgradeCost } : null,
    nextStorageUpgrade: nextStorage ? { level: nextStorage.level, name: nextStorage.name, maxHours: nextStorage.maxHours, cost: nextStorage.upgradeCost } : null,
    totalMinedPoints: Number(user.totalMinedPoints) || 0,
    userPoints: balance,
    points: balance,
    balance,
    upBalance: balance,
    serverNow: now.toISOString()
  };
}

function miningError(code, message, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function optimisticUserFilter(user) {
  return {
    _id: user._id,
    points: Number(user.points) || 0,
    miningLevel: Number(user.miningLevel) || 1,
    miningStorageLevel: Number(user.miningStorageLevel) || 1,
    miningSavedPoints: Number(user.miningSavedPoints) || 0,
    miningLastClaimAt: user.miningLastClaimAt || null,
    miningBoostExpiresAt: user.miningBoostExpiresAt || null
  };
}

function miningLedgerIdentity(userId, scope, key, leg) {
  const transactionId = idempotencyTransactionId({ userId, scope, key, leg });
  return { sourceId: `mining:${scope}:${transactionId}`, transactionId };
}

function validatedKey(req) {
  const key = validateIdempotencyKey(req.get('Idempotency-Key'));
  if (!key) throw miningError('IDEMPOTENCY_KEY_REQUIRED', 'هدر Idempotency-Key معتبر و الزامی است.', 400);
  return key;
}

function sendOperationResult(res, result) {
  return res.status(result.status).json(result.body);
}

router.get('/status', auth, async (req, res) => {
  const user = await User.findById(req.dbUser._id).select('+vipMiningCycleStartedAt +vipMiningCycleEndsAt +vipMiningCycleNotifiedAt');
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  const now = new Date();
  // Do not filter startAt in Mongo: legacy BSON strings compare differently
  // from Date values. The accrual helper normalizes parseable dates in JS.
  const subscriptions = await VipSubscription.find({
    user: user._id,
    status: { $in: ['active', 'completed'] }
  }).select('_id user planNumber pricePoints monthlyRewardPercent durationDays principalDailyBps rewardDailyBps dailyRewardAveragePoints totalRewardCents totalRewardPoints claimedRewardPoints startAt endAt status policyVersion claimsCompleted reserveLiabilityCents reservePaidCents lastClaimAt vipMiningLastClaimAt vipMiningRemainder vipMiningPaidMicros vipMiningReserveRemainderMicros').lean();
  const history = await PointsLedger.find({
    user: user._id,
    type: { $in: ['mining_claim', 'mining_upgrade'] },
    currency: 'points'
  }).sort({ createdAt: -1, _id: -1 }).limit(MINING_HISTORY_LIMIT)
    .select('type amount currency description balanceAfter sourceId transactionId createdAt').lean();
  const mining = calculateVipMiningStatus(subscriptions, now);
  const cycle = calculateVipMiningCycleStatus(subscriptions, user.vipMiningCycleStartedAt, user.vipMiningCycleEndsAt, now);
  mining.cycle = cycle;
  mining.cycleStartedAt = cycle.cycleStartedAt;
  mining.cycleEndsAt = cycle.cycleEndsAt;
  mining.cycleRemainingSeconds = cycle.remainingSeconds;
  mining.cycleAccruedPoints = cycle.accruedPoints;
  const balance = Number(user.points) || 0;
  mining.history = history;
  mining.userPoints = balance;
  mining.points = balance;
  mining.balance = balance;
  mining.upBalance = balance;
  return res.json({
    success: true,
    mining,
    vipMining: mining,
    history,
    userPoints: balance,
    points: balance,
    balance,
    upBalance: balance,
    cycle
  });
});

router.post('/start', auth, startRateLimit, async (req, res) => {
  const now = new Date();
  const current = await User.findById(req.dbUser._id);
  if (!current) return res.status(404).json({ success: false, code: 'USER_NOT_FOUND', message: 'کاربر پیدا نشد.' });
  const subscriptions = await VipSubscription.find({ user: current._id, status: { $in: ['active', 'completed'] } }).sort({ startAt: 1 });
  const eligible = subscriptions.some(subscription => {
    const start = new Date(subscription.startAt).getTime();
    const end = new Date(subscription.endAt).getTime();
    return isVipMiningEligible(subscription) && Number.isFinite(start) && Number.isFinite(end) && start <= now.getTime() && end > now.getTime();
  });
  if (!eligible) return res.status(409).json({ success: false, code: 'VIP_MINING_PURCHASE_REQUIRED', message: 'برای شروع ماینینگ باید یک پلن VIP فعال داشته باشید.' });
  if (current.vipMiningCycleEndsAt && new Date(current.vipMiningCycleEndsAt).getTime() > now.getTime()) {
    return res.status(409).json({ success: false, code: 'VIP_MINING_CYCLE_ACTIVE', message: 'چرخه ماینینگ فعلی هنوز تمام نشده است.' });
  }
  if (current.vipMiningCycleEndsAt && new Date(current.vipMiningCycleEndsAt).getTime() <= now.getTime()) {
    return res.status(409).json({ success: false, code: 'VIP_MINING_CLAIM_REQUIRED', message: 'ابتدا توکن‌های چرخه قبلی را دریافت کنید.' });
  }
  const started = await User.findOneAndUpdate(
    { _id: current._id, $or: [{ vipMiningCycleStartedAt: null }, { vipMiningCycleStartedAt: { $exists: false } }] },
    { $set: { vipMiningCycleStartedAt: now, vipMiningCycleEndsAt: new Date(now.getTime() + MINING_CYCLE_SECONDS * 1000), vipMiningCycleNotifiedAt: null } },
    { new: true }
  );
  if (!started) return res.status(409).json({ success: false, code: 'VIP_MINING_CYCLE_CONFLICT', message: 'چرخه ماینینگ هم‌زمان تغییر کرد؛ دوباره تلاش کنید.' });
  const cycle = calculateVipMiningCycleStatus(subscriptions, started.vipMiningCycleStartedAt, started.vipMiningCycleEndsAt, now);
  return res.json({ success: true, startedAt: cycle.cycleStartedAt, endsAt: cycle.cycleEndsAt, cycle, message: 'چرخه ماینینگ ۶ساعته شروع شد.' });
});

router.post('/claim', auth, claimRateLimit, async (req, res) => {
  try {
    const key = validatedKey(req);
    const scope = 'mining_claim';
    const result = await executeIdempotently({
      userId: req.dbUser._id,
      scope,
      key,
      body: req.body || {},
      execute: async session => {
        const now = new Date();
        const current = await User.findById(req.dbUser._id).session(session);
        if (!current) throw miningError('USER_NOT_FOUND', 'کاربر پیدا نشد.', 404);
        const cycleStartedAt = current.vipMiningCycleStartedAt;
        const cycleEndsAt = current.vipMiningCycleEndsAt;
        if (!cycleStartedAt || !cycleEndsAt) throw miningError('VIP_MINING_NOT_STARTED', 'ابتدا چرخه ماینینگ را شروع کنید.', 409);
        if (new Date(cycleEndsAt).getTime() > now.getTime()) throw miningError('VIP_MINING_CYCLE_ACTIVE', 'چرخه ۶ساعته هنوز تمام نشده است.', 409);
        const subscriptions = await VipSubscription.find({
          user: current._id,
          status: { $in: ['active', 'completed'] }
        }).session(session).sort({ startAt: 1 });
        const cycle = calculateVipMiningCycleStatus(subscriptions, cycleStartedAt, cycleEndsAt, new Date(cycleEndsAt));
        const pointsToClaim = Number(cycle.accruedPoints.toFixed(6)) || 0;
        if (pointsToClaim <= 0) throw miningError('VIP_MINING_NO_POINTS', 'در این چرخه توکن قابل دریافت وجود ندارد.', 400);
        const hasNewPolicyMiner = subscriptions.some(subscription =>
          isVipMiningEligible(subscription) && String(subscription.policyVersion || '') === NEW_VIP_POLICY_VERSION
        );
        const settings = hasNewPolicyMiner ? await Settings.findOne({ key: 'global' }).session(session).lean() : null;
        if (hasNewPolicyMiner && settings?.vipPayoutsEnabled !== true) {
          throw miningError('VIP_PAYOUTS_DISABLED', 'پرداخت‌های این نسخه VIP موقتاً فعال نیست.', 409);
        }
        for (const subscription of subscriptions) {
          if (!isVipMiningEligible(subscription)) continue;
          const accrual = calculateVipSubscriptionCycleAccrual(subscription, cycleStartedAt, cycleEndsAt, new Date(cycleEndsAt));
          if (accrual.earnedMicros < 1) continue;
          const isNewPolicy = String(subscription.policyVersion || '') === NEW_VIP_POLICY_VERSION;
          const previousReservePaidCents = Number(subscription.reservePaidCents) || 0;
          const reserveLiabilityCents = Number(subscription.reserveLiabilityCents) || 0;
          const previousMiningPaidMicros = Math.max(0, Number(subscription.vipMiningPaidMicros) || 0);
          const nextMiningPaidMicros = previousMiningPaidMicros + accrual.earnedMicros;
          const reserveCentsToRelease = isNewPolicy
            ? Math.floor(nextMiningPaidMicros / 10000) - Math.floor(previousMiningPaidMicros / 10000)
            : 0;
          if (isNewPolicy && reserveCentsToRelease > reserveLiabilityCents - previousReservePaidCents) {
            throw miningError('VIP_RESERVE_EXCEEDED', 'مقدار پرداخت از تعهد ذخیره VIP بیشتر است؛ تراکنش انجام نشد.', 409);
          }
          if (isNewPolicy && reserveCentsToRelease > 0) {
            const released = await releaseForPayout(reserveCentsToRelease, session);
            if (!released) throw miningError('VIP_RESERVE_UNAVAILABLE', 'Reserve قابل پرداخت کافی نیست؛ پرداخت انجام نشد.', 409);
          }
          const expectedMiningRemainder = Number(subscription.vipMiningRemainder) || 0;
          const subscriptionFilter = {
            _id: subscription._id,
            user: current._id,
            status: subscription.status,
            vipMiningPaidMicros: previousMiningPaidMicros === 0 ? { $in: [null, 0] } : previousMiningPaidMicros,
            vipMiningRemainder: expectedMiningRemainder === 0 ? { $in: [null, 0] } : expectedMiningRemainder
          };
          const subscriptionUpdate = { $set: {
            vipMiningLastClaimAt: new Date(cycleEndsAt),
            vipMiningRemainder: 0,
            vipMiningPaidMicros: nextMiningPaidMicros
          }};
          if (isNewPolicy) {
            const previousReserveRemainderMicros = Math.min(9999, Math.max(0, Number(subscription.vipMiningReserveRemainderMicros) || 0));
            subscriptionFilter.reservePaidCents = previousReservePaidCents === 0 ? { $in: [null, 0] } : previousReservePaidCents;
            subscriptionFilter.vipMiningReserveRemainderMicros = previousReserveRemainderMicros === 0 ? { $in: [null, 0] } : previousReserveRemainderMicros;
            subscriptionUpdate.$set.vipMiningReserveRemainderMicros = nextMiningPaidMicros % 10000;
            subscriptionUpdate.$set.reservePaidCents = previousReservePaidCents + reserveCentsToRelease;
            if (reserveLiabilityCents > 0 && previousReservePaidCents + reserveCentsToRelease >= reserveLiabilityCents) {
              subscriptionUpdate.$set.status = 'completed';
              subscriptionUpdate.$set.reserveReleasedAt = now;
            }
          }
          const updatedSubscription = await VipSubscription.findOneAndUpdate(subscriptionFilter, subscriptionUpdate, { new: true, session });
          if (!updatedSubscription) throw miningError('VIP_MINING_CONFLICT', 'وضعیت ماینر هم‌زمان تغییر کرده است؛ دوباره تلاش کنید.', 409);
        }
        const nextStart = now;
        const nextEnd = new Date(now.getTime() + MINING_CYCLE_SECONDS * 1000);
        const updated = await User.findOneAndUpdate(
          { _id: current._id, vipMiningCycleStartedAt: cycleStartedAt, vipMiningCycleEndsAt: cycleEndsAt },
          { $inc: { points: pointsToClaim, totalMinedPoints: pointsToClaim }, $set: { vipMiningCycleStartedAt: nextStart, vipMiningCycleEndsAt: nextEnd, vipMiningCycleNotifiedAt: null } },
          { new: true, session }
        );
        if (!updated) throw miningError('VIP_MINING_CONFLICT', 'چرخه ماینینگ هم‌زمان تغییر کرده است؛ دوباره تلاش کنید.', 409);
        const identity = miningLedgerIdentity(updated._id, scope, key, 'claim');
        await recordLedgerRequired({
          user: updated._id, type: 'mining_claim', currency: 'points', amount: pointsToClaim,
          description: `دریافت ${pointsToClaim} UP از چرخه ۶ساعته ماینینگ VIP`, balanceAfter: updated.points,
          ...identity, session
        });
        const refreshedSubscriptions = await VipSubscription.find({ user: updated._id, status: { $in: ['active', 'completed'] } }).session(session).sort({ startAt: 1 });
        const mining = calculateVipMiningStatus(refreshedSubscriptions, now);
        mining.cycle = calculateVipMiningCycleStatus(refreshedSubscriptions, nextStart, nextEnd, now);
        return {
          status: 200,
          body: { success: true, claimedPoints: pointsToClaim, newBalance: updated.points, userPoints: updated.points, points: updated.points, balance: updated.points, upBalance: updated.points, mining, vipMining: mining, cycle: mining.cycle, message: `${pointsToClaim} UP با موفقیت دریافت و چرخه بعدی شروع شد.` },
          resourceId: updated._id
        };
      }
    });
    return sendOperationResult(res, result);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
    throw error;
  }
});
router.post('/upgrade', auth, claimRateLimit, async (req, res) => {
  return res.status(409).json({ success: false, code: 'VIP_MINING_PACKAGES_ONLY', message: 'برای افزایش سرعت استخراج، پلن VIP خریداری کنید.' });
});

module.exports = router;
module.exports.getMiningState = getMiningState;
module.exports.RIG_LEVELS = RIG_LEVELS;
module.exports.STORAGE_LEVELS = STORAGE_LEVELS;
module.exports.calculateVipSubscriptionAccrual = calculateVipSubscriptionAccrual;
module.exports.calculateVipMiningStatus = calculateVipMiningStatus;
