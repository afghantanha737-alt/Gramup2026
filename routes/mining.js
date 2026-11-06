'use strict';
const crypto = require('crypto');
const express = require('express');
const router = express.Router();
require('../utils/asyncHandler').wrapRouter(router);
const { requireUnifiedAuth } = require('../utils/unifiedAuth');
const { withMembership } = require('../utils/membership');
const { withMongoTransaction } = require('../utils/mongoTransaction');
const { recordLedgerRequired } = require('../utils/ledger');
const User = require('../models/User');

const auth = withMembership(requireUnifiedAuth(process.env.BOT_TOKEN));

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
  const lastClaimAt = user.miningLastClaimAt ? new Date(user.miningLastClaimAt) : (user.createdAt ? new Date(user.createdAt) : now);
  const lastClaimMs = lastClaimAt.getTime();
  const totalElapsedMs = Math.max(0, nowMs - lastClaimMs);
  let boostedMs = 0;
  let normalMs = 0;
  if (boostExpiresAt && boostExpiresAt.getTime() > lastClaimMs) {
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
  const accumulatedPoints = Math.max(0, Math.min(maxStoragePoints, Math.floor(totalRawPoints)));
  const nextRig = RIG_LEVELS.find(r => r.level === level + 1) || null;
  const nextStorage = STORAGE_LEVELS.find(s => s.level === storageLevel + 1) || null;
  return {
    level, storageLevel, rigName: rigConfig.name, storageName: storageConfig.name,
    baseRatePerHour: rigConfig.ratePerHour, effectiveRatePerHour,
    maxStorageHours: storageConfig.maxHours, maxStoragePoints, accumulatedPoints,
    isStorageFull: accumulatedPoints >= maxStoragePoints,
    elapsedSeconds: Math.floor(totalElapsedMs / 1000),
    storageFullSeconds: Math.floor(storageConfig.maxHours * 3600),
    isBoosted,
    boostExpiresAt: isBoosted ? boostExpiresAt.toISOString() : null,
    boostRemainingSeconds: isBoosted ? Math.max(0, Math.floor((boostExpiresAt.getTime() - nowMs) / 1000)) : 0,
    nextRigUpgrade: nextRig ? { level: nextRig.level, name: nextRig.name, ratePerHour: nextRig.ratePerHour, cost: nextRig.upgradeCost } : null,
    nextStorageUpgrade: nextStorage ? { level: nextStorage.level, name: nextStorage.name, maxHours: nextStorage.maxHours, cost: nextStorage.upgradeCost } : null,
    totalMinedPoints: Number(user.totalMinedPoints) || 0,
    userPoints: Number(user.points) || 0,
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

router.get('/status', auth, async (req, res) => {
  const user = await User.findById(req.dbUser._id);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  return res.json({ success: true, mining: getMiningState(user, new Date()) });
});

router.post('/claim', auth, async (req, res) => {
  const now = new Date();
  try {
    const outcome = await withMongoTransaction(async session => {
      const current = await User.findById(req.dbUser._id).session(session);
      if (!current) throw miningError('USER_NOT_FOUND', 'کاربر پیدا نشد.', 404);
      const state = getMiningState(current, now);
      const pointsToClaim = state.accumulatedPoints;
      if (pointsToClaim < 1) throw miningError('MINING_NO_POINTS', 'هنوز پوینتی برای دریافت جمع نشده است.', 400);
      const updated = await User.findOneAndUpdate(optimisticUserFilter(current), {
        $set: { miningSavedPoints: 0, miningLastClaimAt: now },
        $inc: { points: pointsToClaim, totalMinedPoints: pointsToClaim }
      }, { new: true, session });
      if (!updated) throw miningError('MINING_CONFLICT', 'وضعیت استخراج تغییر کرده است؛ دوباره تلاش کنید.', 409);
      const sourceId = `mining-claim:${updated._id}:${crypto.randomUUID()}`;
      await recordLedgerRequired({
        user: updated._id, type: 'mining_claim', currency: 'points', amount: pointsToClaim,
        description: `استخراج ${pointsToClaim} پوینت از ماینر`, balanceAfter: updated.points,
        sourceId, session
      });
      return { updated, pointsToClaim };
    });
    return res.json({
      success: true, claimedPoints: outcome.pointsToClaim, newBalance: outcome.updated.points,
      mining: getMiningState(outcome.updated, now),
      message: `${outcome.pointsToClaim} پوینت استخراج‌شده با موفقیت واریز شد!`
    });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
    throw error;
  }
});

router.post('/upgrade', auth, async (req, res) => {
  const type = String(req.body?.type || '').trim();
  if (!['rig', 'storage'].includes(type)) return res.status(400).json({ success: false, message: 'نوع ارتقاء نامعتبر است.' });
  const now = new Date();
  try {
    const outcome = await withMongoTransaction(async session => {
      const current = await User.findById(req.dbUser._id).session(session);
      if (!current) throw miningError('USER_NOT_FOUND', 'کاربر پیدا نشد.', 404);
      const state = getMiningState(current, now);
      const next = type === 'rig' ? state.nextRigUpgrade : state.nextStorageUpgrade;
      if (!next) throw miningError('MINING_MAX_LEVEL', type === 'rig' ? 'دستگاه ماینر شما در بالاترین سطح قرار دارد.' : 'ظرفیت باتری در بالاترین سطح قرار دارد.');
      const pendingPoints = state.accumulatedPoints;
      const newBalance = (Number(current.points) || 0) + pendingPoints - next.cost;
      if (newBalance < 0) throw miningError('MINING_INSUFFICIENT_POINTS', `پوینت کافی نیست. هزینه ارتقاء: ${next.cost} پوینت.`);
      const setFields = { miningSavedPoints: 0, miningLastClaimAt: now, points: newBalance };
      if (type === 'rig') setFields.miningLevel = next.level;
      else setFields.miningStorageLevel = next.level;
      const updated = await User.findOneAndUpdate(optimisticUserFilter(current), {
        $set: setFields,
        ...(pendingPoints ? { $inc: { totalMinedPoints: pendingPoints } } : {})
      }, { new: true, session });
      if (!updated) throw miningError('MINING_CONFLICT', 'وضعیت استخراج تغییر کرده است؛ دوباره تلاش کنید.', 409);
      if (pendingPoints > 0) {
        await recordLedgerRequired({
          user: updated._id, type: 'mining_claim', currency: 'points', amount: pendingPoints,
          description: `تسویه خودکار ${pendingPoints} پوینت هنگام ارتقاء`,
          balanceAfter: (Number(current.points) || 0) + pendingPoints,
          sourceId: `mining-claim:${updated._id}:${crypto.randomUUID()}`, session
        });
      }
      await recordLedgerRequired({
        user: updated._id, type: 'mining_upgrade', currency: 'points', amount: -next.cost,
        description: type === 'rig' ? `ارتقاء ماینر به سطح ${next.level} (${next.name})` : `ارتقاء ظرفیت ذخیره به سطح ${next.level} (${next.name})`,
        balanceAfter: updated.points,
        sourceId: `mining-upgrade:${updated._id}:${crypto.randomUUID()}`, session
      });
      return { updated, next };
    });
    const label = type === 'rig' ? 'ماینر' : 'ظرفیت باتری';
    return res.json({
      success: true, mining: getMiningState(outcome.updated, now), newBalance: outcome.updated.points,
      message: `${label} به سطح ${outcome.next.level} ارتقاء یافت!`
    });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
    throw error;
  }
});

module.exports = router;
module.exports.getMiningState = getMiningState;
module.exports.RIG_LEVELS = RIG_LEVELS;
module.exports.STORAGE_LEVELS = STORAGE_LEVELS;
