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
  const user = await User.findById(req.dbUser._id);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  const history = await PointsLedger.find({
    user: user._id,
    type: { $in: ['mining_claim', 'mining_upgrade'] },
    currency: 'points'
  }).sort({ createdAt: -1, _id: -1 }).limit(MINING_HISTORY_LIMIT)
    .select('type amount currency description balanceAfter sourceId transactionId createdAt').lean();
  const mining = getMiningState(user, new Date());
  mining.history = history;
  return res.json({
    success: true,
    mining,
    history,
    userPoints: mining.userPoints,
    points: mining.points,
    balance: mining.balance,
    upBalance: mining.upBalance
  });
});

router.post('/start', auth, startRateLimit, async (req, res) => {
  const now = new Date();
  const started = await User.findOneAndUpdate(
    { _id: req.dbUser._id, miningLastClaimAt: null },
    { $set: { miningLastClaimAt: now } },
    { new: true }
  );
  const user = started || await User.findById(req.dbUser._id);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  const mining = getMiningState(user, now);
  return res.json({
    success: true,
    started: Boolean(started),
    mining,
    newBalance: Number(user.points) || 0,
    userPoints: Number(user.points) || 0,
    points: Number(user.points) || 0,
    balance: Number(user.points) || 0,
    upBalance: Number(user.points) || 0
  });
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
        const state = getMiningState(current, now);
        const pointsToClaim = state.accumulatedPoints;
        if (pointsToClaim < 1) throw miningError('MINING_NO_POINTS', 'هنوز UP برای دریافت جمع نشده است.', 400);
        const updated = await User.findOneAndUpdate(optimisticUserFilter(current), {
          $set: { miningSavedPoints: 0, miningLastClaimAt: now },
          $inc: { points: pointsToClaim, totalMinedPoints: pointsToClaim }
        }, { new: true, session });
        if (!updated) throw miningError('MINING_CONFLICT', 'وضعیت استخراج تغییر کرده است؛ دوباره تلاش کنید.', 409);
        const identity = miningLedgerIdentity(updated._id, scope, key, 'claim');
        await recordLedgerRequired({
          user: updated._id, type: 'mining_claim', currency: 'points', amount: pointsToClaim,
          description: `استخراج ${pointsToClaim} UP از ماینر`, balanceAfter: updated.points,
          ...identity, session
        });
        return {
          status: 200,
          body: {
            success: true, claimedPoints: pointsToClaim, newBalance: updated.points,
            userPoints: Number(updated.points) || 0, points: Number(updated.points) || 0,
            balance: Number(updated.points) || 0, upBalance: Number(updated.points) || 0,
            mining: getMiningState(updated, now),
            message: `${pointsToClaim} UP استخراج‌شده با موفقیت واریز شد!`
          },
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
  const type = String(req.body?.type || '').trim();
  if (!['rig', 'storage'].includes(type)) return res.status(400).json({ success: false, message: 'نوع ارتقاء نامعتبر است.' });
  try {
    const key = validatedKey(req);
    const scope = 'mining_upgrade';
    const result = await executeIdempotently({
      userId: req.dbUser._id,
      scope,
      key,
      body: req.body || {},
      execute: async session => {
        const now = new Date();
        const current = await User.findById(req.dbUser._id).session(session);
        if (!current) throw miningError('USER_NOT_FOUND', 'کاربر پیدا نشد.', 404);
        const state = getMiningState(current, now);
        const next = type === 'rig' ? state.nextRigUpgrade : state.nextStorageUpgrade;
        if (!next) throw miningError('MINING_MAX_LEVEL', type === 'rig' ? 'دستگاه ماینر شما در بالاترین سطح قرار دارد.' : 'ظرفیت باتری در بالاترین سطح قرار دارد.');
        const pendingPoints = state.accumulatedPoints;
        const previousBalance = Number(current.points) || 0;
        const newBalance = previousBalance + pendingPoints - next.cost;
        if (newBalance < 0) throw miningError('MINING_INSUFFICIENT_POINTS', `UP کافی نیست. هزینه ارتقاء: ${next.cost} UP.`);
        const setFields = { miningSavedPoints: 0, miningLastClaimAt: now, points: newBalance };
        if (type === 'rig') setFields.miningLevel = next.level;
        else setFields.miningStorageLevel = next.level;
        const updated = await User.findOneAndUpdate(optimisticUserFilter(current), {
          $set: setFields,
          ...(pendingPoints ? { $inc: { totalMinedPoints: pendingPoints } } : {})
        }, { new: true, session });
        if (!updated) throw miningError('MINING_CONFLICT', 'وضعیت استخراج تغییر کرده است؛ دوباره تلاش کنید.', 409);
        if (pendingPoints > 0) {
          const claimIdentity = miningLedgerIdentity(updated._id, scope, key, 'settlement');
          await recordLedgerRequired({
            user: updated._id, type: 'mining_claim', currency: 'points', amount: pendingPoints,
            description: `تسویه خودکار ${pendingPoints} UP هنگام ارتقاء`,
            balanceAfter: previousBalance + pendingPoints,
            ...claimIdentity, session
          });
        }
        const upgradeIdentity = miningLedgerIdentity(updated._id, scope, key, 'upgrade');
        await recordLedgerRequired({
          user: updated._id, type: 'mining_upgrade', currency: 'points', amount: -next.cost,
          description: type === 'rig' ? `ارتقاء ماینر به سطح ${next.level} (${next.name})` : `ارتقاء ظرفیت ذخیره به سطح ${next.level} (${next.name})`,
          balanceAfter: updated.points,
          ...upgradeIdentity, session
        });
        const label = type === 'rig' ? 'ماینر' : 'ظرفیت باتری';
        return {
          status: 200,
          body: {
            success: true, mining: getMiningState(updated, now), newBalance: updated.points,
            userPoints: Number(updated.points) || 0, points: Number(updated.points) || 0,
            balance: Number(updated.points) || 0, upBalance: Number(updated.points) || 0,
            message: `${label} به سطح ${next.level} ارتقاء یافت!`
          },
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

module.exports = router;
module.exports.getMiningState = getMiningState;
module.exports.RIG_LEVELS = RIG_LEVELS;
module.exports.STORAGE_LEVELS = STORAGE_LEVELS;
