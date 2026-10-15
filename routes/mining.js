'use strict';
const express = require('express');
const router = express.Router();
require('../utils/asyncHandler').wrapRouter(router);
const { requireUnifiedAuth } = require('../utils/unifiedAuth');
const { withMembership } = require('../utils/membership');
const User = require('../models/User');
const PointsLedger = require('../models/PointsLedger');

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
  const isBoosted = boostExpiresAt && boostExpiresAt.getTime() > nowMs;
  const effectiveRatePerHour = isBoosted ? rigConfig.ratePerHour * 2 : rigConfig.ratePerHour;

  const lastClaimAt = user.miningLastClaimAt ? new Date(user.miningLastClaimAt) : (user.createdAt ? new Date(user.createdAt) : now);
  const lastClaimMs = lastClaimAt.getTime();
  const totalElapsedMs = Math.max(0, nowMs - lastClaimMs);

  let boostedMs = 0;
  let normalMs = 0;

  if (boostExpiresAt) {
    const boostExpiryMs = boostExpiresAt.getTime();
    if (boostExpiryMs > lastClaimMs) {
      const boostEndMs = Math.min(nowMs, boostExpiryMs);
      boostedMs = Math.max(0, boostEndMs - lastClaimMs);
      normalMs = Math.max(0, nowMs - boostEndMs);
    } else {
      normalMs = totalElapsedMs;
    }
  } else {
    normalMs = totalElapsedMs;
  }

  const baseRatePerMs = rigConfig.ratePerHour / (3600 * 1000);
  const newlyAccumulatedPoints = (boostedMs * baseRatePerMs * 2) + (normalMs * baseRatePerMs);
  const savedPoints = Number(user.miningSavedPoints) || 0;
  const totalRawPoints = savedPoints + newlyAccumulatedPoints;

  const maxStorageCapacityPoints = Math.floor(storageConfig.maxHours * rigConfig.ratePerHour * (isBoosted ? 2 : 1));
  const maxStoragePoints = Math.max(maxStorageCapacityPoints, Math.floor(storageConfig.maxHours * rigConfig.ratePerHour));
  const accumulatedPoints = Math.max(0, Math.min(maxStoragePoints, Math.floor(totalRawPoints)));
  const isStorageFull = accumulatedPoints >= maxStoragePoints;

  const nextRig = RIG_LEVELS.find(r => r.level === level + 1) || null;
  const nextStorage = STORAGE_LEVELS.find(s => s.level === storageLevel + 1) || null;

  return {
    level,
    storageLevel,
    rigName: rigConfig.name,
    storageName: storageConfig.name,
    baseRatePerHour: rigConfig.ratePerHour,
    effectiveRatePerHour,
    maxStorageHours: storageConfig.maxHours,
    maxStoragePoints,
    accumulatedPoints,
    isStorageFull,
    elapsedSeconds: Math.floor(totalElapsedMs / 1000),
    storageFullSeconds: Math.floor(storageConfig.maxHours * 3600),
    isBoosted: !!isBoosted,
    boostExpiresAt: isBoosted ? boostExpiresAt.toISOString() : null,
    boostRemainingSeconds: isBoosted ? Math.max(0, Math.floor((boostExpiresAt.getTime() - nowMs) / 1000)) : 0,
    nextRigUpgrade: nextRig ? { level: nextRig.level, name: nextRig.name, ratePerHour: nextRig.ratePerHour, cost: nextRig.upgradeCost } : null,
    nextStorageUpgrade: nextStorage ? { level: nextStorage.level, name: nextStorage.name, maxHours: nextStorage.maxHours, cost: nextStorage.upgradeCost } : null,
    totalMinedPoints: Number(user.totalMinedPoints) || 0,
    userPoints: Number(user.points) || 0,
    serverNow: now.toISOString()
  };
}

// GET /api/mining/status
router.get('/status', auth, async (req, res) => {
  const user = await User.findById(req.dbUser._id);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  const state = getMiningState(user, new Date());
  res.json({ success: true, mining: state });
});

// POST /api/mining/claim
router.post('/claim', auth, async (req, res) => {
  const now = new Date();
  const user = await User.findById(req.dbUser._id);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });

  const state = getMiningState(user, now);
  const pointsToClaim = state.accumulatedPoints;
  if (pointsToClaim < 1) {
    return res.status(400).json({ success: false, code: 'MINING_NO_POINTS', message: 'هنوز پوینتی برای دریافت جمع نشده است.' });
  }

  user.points = (Number(user.points) || 0) + pointsToClaim;
  user.totalMinedPoints = (Number(user.totalMinedPoints) || 0) + pointsToClaim;
  user.miningSavedPoints = 0;
  user.miningLastClaimAt = now;
  await user.save();

  try {
    await PointsLedger.create({
      user: user._id,
      type: 'mining_claim',
      currency: 'points',
      amount: pointsToClaim,
      description: `استخراج ${pointsToClaim} پوینت از ماینر`,
      balanceAfter: user.points
    });
  } catch (err) {
    console.error('PointsLedger error (mining_claim):', err.message);
  }

  const newState = getMiningState(user, now);
  return res.json({
    success: true,
    claimedPoints: pointsToClaim,
    newBalance: user.points,
    mining: newState,
    message: `${pointsToClaim} پوینت استخراج‌شده با موفقیت واریز شد!`
  });
});

// POST /api/mining/upgrade
router.post('/upgrade', auth, async (req, res) => {
  const type = String(req.body?.type || '').trim();
  if (!['rig', 'storage'].includes(type)) return res.status(400).json({ success: false, message: 'نوع ارتقاء نامعتبر است.' });

  const now = new Date();
  const user = await User.findById(req.dbUser._id);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });

  if (type === 'rig') {
    const currentLevel = Math.min(Math.max(Number(user.miningLevel) || 1, 1), RIG_LEVELS.length);
    const nextRig = RIG_LEVELS.find(r => r.level === currentLevel + 1);
    if (!nextRig) return res.status(400).json({ success: false, message: 'دستگاه ماینر شما در بالاترین سطح قرار دارد.' });

    // Auto-claim pending points before upgrading
    const state = getMiningState(user, now);
    const pendingPoints = state.accumulatedPoints;
    if (pendingPoints > 0) {
      user.points = (Number(user.points) || 0) + pendingPoints;
      user.totalMinedPoints = (Number(user.totalMinedPoints) || 0) + pendingPoints;
      try {
        await PointsLedger.create({
          user: user._id,
          type: 'mining_claim',
          currency: 'points',
          amount: pendingPoints,
          description: `تسویه خودکار ${pendingPoints} پوینت هنگام ارتقاء ماینر`,
          balanceAfter: user.points
        });
      } catch (err) {}
    }

    if ((Number(user.points) || 0) < nextRig.upgradeCost) {
      user.miningSavedPoints = 0;
      user.miningLastClaimAt = now;
      await user.save();
      return res.status(400).json({ success: false, message: `پوینت کافی نیست. هزینه ارتقاء: ${nextRig.upgradeCost} پوینت.` });
    }

    user.miningSavedPoints = 0;
    user.miningLastClaimAt = now;
    user.points = user.points - nextRig.upgradeCost;
    user.miningLevel = nextRig.level;
    await user.save();

    try {
      await PointsLedger.create({
        user: user._id,
        type: 'mining_upgrade',
        currency: 'points',
        amount: -nextRig.upgradeCost,
        description: `ارتقاء ماینر به سطح ${nextRig.level} (${nextRig.name})`,
        balanceAfter: user.points
      });
    } catch (err) {}

    const newState = getMiningState(user, now);
    return res.json({
      success: true,
      mining: newState,
      newBalance: user.points,
      message: `ماینر به سطح ${nextRig.level} ارتقاء یافت!`
    });
  } else {
    const currentStorage = Math.min(Math.max(Number(user.miningStorageLevel) || 1, 1), STORAGE_LEVELS.length);
    const nextStorage = STORAGE_LEVELS.find(s => s.level === currentStorage + 1);
    if (!nextStorage) return res.status(400).json({ success: false, message: 'ظرفیت باتری در بالاترین سطح قرار دارد.' });

    // Auto-claim pending points before upgrading
    const state = getMiningState(user, now);
    const pendingPoints = state.accumulatedPoints;
    if (pendingPoints > 0) {
      user.points = (Number(user.points) || 0) + pendingPoints;
      user.totalMinedPoints = (Number(user.totalMinedPoints) || 0) + pendingPoints;
      try {
        await PointsLedger.create({
          user: user._id,
          type: 'mining_claim',
          currency: 'points',
          amount: pendingPoints,
          description: `تسویه خودکار ${pendingPoints} پوینت هنگام ارتقاء باتری`,
          balanceAfter: user.points
        });
      } catch (err) {}
    }

    if ((Number(user.points) || 0) < nextStorage.upgradeCost) {
      user.miningSavedPoints = 0;
      user.miningLastClaimAt = now;
      await user.save();
      return res.status(400).json({ success: false, message: `پوینت کافی نیست. هزینه ارتقاء: ${nextStorage.upgradeCost} پوینت.` });
    }

    user.miningSavedPoints = 0;
    user.miningLastClaimAt = now;
    user.points = user.points - nextStorage.upgradeCost;
    user.miningStorageLevel = nextStorage.level;
    await user.save();

    try {
      await PointsLedger.create({
        user: user._id,
        type: 'mining_upgrade',
        currency: 'points',
        amount: -nextStorage.upgradeCost,
        description: `ارتقاء باتری به سطح ${nextStorage.level} (${nextStorage.name})`,
        balanceAfter: user.points
      });
    } catch (err) {}

    const newState = getMiningState(user, now);
    return res.json({
      success: true,
      mining: newState,
      newBalance: user.points,
      message: `ظرفیت باتری به سطح ${nextStorage.level} ارتقاء یافت!`
    });
  }
});

module.exports = router;
module.exports.getMiningState = getMiningState;
