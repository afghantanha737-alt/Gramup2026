'use strict';
const crypto = require('crypto');
const express = require('express');
const router = express.Router();
require('../utils/asyncHandler').wrapRouter(router);
const { requireUnifiedAuth } = require('../utils/unifiedAuth');
const { withMembership } = require('../utils/membership');
const { recordLedgerRequired } = require('../utils/ledger');
const PointsLedger = require('../models/PointsLedger');
const { sensitiveRateLimit } = require('../utils/apiSecurity');
const { validateIdempotencyKey, executeIdempotently, idempotencyTransactionId } = require('../utils/idempotency');
const { bot, notifyUser } = require('../utils/bot');
const User = require('../models/User');

const auth = withMembership(requireUnifiedAuth(process.env.BOT_TOKEN));

// Mining Rig Levels (Points / hour & Upgrade cost in Points)
const RIG_LEVELS = [
  { level: 1, ratePerHour: 20, upgradeCost: 0, name: 'Basic CPU Miner' },
  { level: 2, ratePerHour: 45, upgradeCost: 150, name: 'Dual-Core Rig' },
  { level: 3, ratePerHour: 90, upgradeCost: 400, name: 'Quad-Core ASIC' },
  { level: 4, ratePerHour: 160, upgradeCost: 1000, name: 'Octa GPU Station' },
  { level: 5, ratePerHour: 260, upgradeCost: 2500, name: 'Quantum Cluster' }
];

// Battery / Storage Levels (Max hours of offline accumulation before storage is full)
const STORAGE_LEVELS = [
  { level: 1, maxHours: 3, upgradeCost: 0, name: 'Standard Battery (3h)' },
  { level: 2, maxHours: 6, upgradeCost: 100, name: 'Extended Pack (6h)' },
  { level: 3, maxHours: 8, upgradeCost: 300, name: 'Lithium Array (8h)' }
];
const STARS_PRODUCTS = Object.freeze({
  streak_freeze: { title: 'Streak Freeze / Missed Day Recovery', description: 'Protect or recover one missed daily streak day.', stars: 50 },
  hash_boost_7d: { title: '7-Day 2x Hashrate Boost', description: 'Double your mining hashrate for seven days.', stars: 150 },
  vip_gold: { title: 'VIP Gold Badge & Zero-Fee Swap', description: 'Unlock VIP Gold status and zero-fee swaps.', stars: 250 }
});

function getMiningState(user, now = new Date()) {
  // Missing legacy state is anchored at first observation; no retroactive payout.
  const level = Math.min(Math.max(Number(user.miningLevel) || 1, 1), RIG_LEVELS.length);
  const storageLevel = Math.min(Math.max(Number(user.miningStorageLevel) || 1, 1), STORAGE_LEVELS.length);
  const rigConfig = RIG_LEVELS.find(r => r.level === level) || RIG_LEVELS[0];
  const storageConfig = STORAGE_LEVELS.find(s => s.level === storageLevel) || STORAGE_LEVELS[0];
  const nowMs = now.getTime();
  const boostUntilMs = (user.miningBoostExpiresAt || user.miningBoostUntil) ? new Date(user.miningBoostExpiresAt || user.miningBoostUntil).getTime() : 0;
  const boostActive = Number.isFinite(boostUntilMs) && boostUntilMs > nowMs && Number(user.miningBoostMultiplier) > 1;
  const multiplier = boostActive ? Math.min(2, Number(user.miningBoostMultiplier) || 1) : 1;
  // A missing miningLastClaimAt means mining has not started. Anchor at the
  // current server time so legacy users never receive retroactive accrual.
  const lastClaimAt = user.miningLastClaimAt ? new Date(user.miningLastClaimAt) : now;
  const lastClaimMs = lastClaimAt.getTime();
  const totalElapsedMs = Math.max(0, nowMs - lastClaimMs);
  const baseRatePerMs = (rigConfig.ratePerHour * multiplier) / (3600 * 1000);
  const newlyAccumulatedPoints = totalElapsedMs * baseRatePerMs;
  const savedPoints = Number(user.miningSavedPoints) || 0;
  const totalRawPoints = savedPoints + newlyAccumulatedPoints;
  const maxStoragePoints = Math.max(1, Math.floor(storageConfig.maxHours * rigConfig.ratePerHour * multiplier));
  const accumulatedPoints = Math.max(0, Math.min(maxStoragePoints, Math.floor(totalRawPoints)));
  const nextRig = RIG_LEVELS.find(r => r.level === level + 1) || null;
  const nextStorage = STORAGE_LEVELS.find(s => s.level === storageLevel + 1) || null;
  return {
    level, storageLevel, rigName: rigConfig.name, storageName: storageConfig.name,
    baseRatePerHour: rigConfig.ratePerHour, effectiveRatePerHour: rigConfig.ratePerHour * multiplier,
    boostActive, boostMultiplier: multiplier, boostUntil: boostActive ? new Date(boostUntilMs).toISOString() : null,
    maxStorageHours: storageConfig.maxHours, maxStoragePoints, accumulatedPoints,
    isStorageFull: accumulatedPoints >= maxStoragePoints,
    elapsedSeconds: Math.floor(totalElapsedMs / 1000),
    storageFullSeconds: Math.floor(storageConfig.maxHours * 3600),
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

async function notifyMiningVaultIfFull(user, state) {
  if (!state.isStorageFull || !user?.telegramId || user.miningStorageFullNotifiedAt) return false;
  const marked = await User.findOneAndUpdate({ _id: user._id, miningStorageFullNotifiedAt: null }, { $set: { miningStorageFullNotifiedAt: new Date() } }, { new: true }).lean();
  if (!marked) return false;
  void notifyUser(user.telegramId, '⚡ Your Gramup mining vault is full! Claim your tokens now to continue mining.');
  return true;
}

function optimisticUserFilter(user) {
  return {
    _id: user._id,
    points: Number(user.points) || 0,
    miningLevel: Number(user.miningLevel) || 1,
    miningStorageLevel: Number(user.miningStorageLevel) || 1,
    miningSavedPoints: Number(user.miningSavedPoints) || 0,
    miningLastClaimAt: user.miningLastClaimAt || null
  };
}

router.get('/status', auth, async (req, res) => {
  const user = await User.findById(req.dbUser._id);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  const history = await PointsLedger.find({ user: user._id, currency: 'points', type: { $in: ['mining_claim', 'mining_upgrade'] } })
    .sort({ createdAt: -1, _id: -1 }).limit(50).lean();
  const mining = getMiningState(user, new Date());
  void notifyMiningVaultIfFull(user, mining).catch(error => console.warn('Mining vault alert failed:', error.message || error));
  return res.json({ success: true, mining, history });
});

router.post('/stars/invoice', auth, async (req, res) => {
  const productKey = String(req.body?.product || '').trim();
  const product = STARS_PRODUCTS[productKey];
  if (!product) return res.status(400).json({ success: false, code: 'STARS_PRODUCT_INVALID', message: 'محصول Stars نامعتبر است.' });
  if (!bot) return res.status(503).json({ success: false, code: 'TELEGRAM_BOT_UNAVAILABLE', message: 'پرداخت تلگرام موقتاً در دسترس نیست.' });
  const payload = `gramup-stars:v1:${req.dbUser._id}:${productKey}:${crypto.randomUUID()}`;
  await bot.sendInvoice(String(req.dbUser.telegramId), { title: product.title, description: product.description, payload, currency: 'XTR', prices: [{ label: product.title, amount: product.stars }] });
  return res.json({ success: true, product: product.title, stars: product.stars, message: 'Invoice به ربات تلگرام شما ارسال شد.' });
});

router.post('/claim', auth, sensitiveRateLimit('mining_claim'), async (req, res) => {
  const now = new Date();
  const idempotencyKey = validateIdempotencyKey(req.get('Idempotency-Key'));
  try {
    const outcome = await executeIdempotently({
      userId: req.dbUser._id, scope: 'mining_claim', key: idempotencyKey, body: {},
      execute: async session => {
      const current = await User.findById(req.dbUser._id).session(session);
      if (!current) throw miningError('USER_NOT_FOUND', 'کاربر پیدا نشد.', 404);
      const state = getMiningState(current, now);
      const pointsToClaim = state.accumulatedPoints;
      if (pointsToClaim < 1) throw miningError('MINING_NO_POINTS', 'هنوز UP برای دریافت جمع نشده است.', 400);
      const updated = await User.findOneAndUpdate(optimisticUserFilter(current), {
        $set: { miningSavedPoints: 0, miningLastClaimAt: now, miningStorageFullNotifiedAt: null },
        $inc: { points: pointsToClaim, totalMinedPoints: pointsToClaim }
      }, { new: true, session });
      if (!updated) throw miningError('MINING_CONFLICT', 'وضعیت استخراج تغییر کرده است؛ دوباره تلاش کنید.', 409);
      const sourceId = idempotencyTransactionId({ userId: updated._id, scope: 'mining_claim', key: idempotencyKey, leg: 'ledger' });
      await recordLedgerRequired({
        user: updated._id, type: 'mining_claim', currency: 'points', amount: pointsToClaim,
        description: `استخراج ${pointsToClaim} UP از ماینر`, balanceAfter: updated.points,
        sourceId, session
      });
      return { status: 200, body: { success: true, claimedPoints: pointsToClaim, newBalance: updated.points, mining: getMiningState(updated, now), message: `${pointsToClaim} UP استخراج‌شده با موفقیت واریز شد!` }, resourceId: sourceId };
      }
    });
    return res.status(outcome.status).json(outcome.body);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
    throw error;
  }
});

router.post('/upgrade', auth, sensitiveRateLimit('mining_upgrade'), async (req, res) => {
  const type = String(req.body?.type || '').trim();
  if (!['rig', 'storage'].includes(type)) return res.status(400).json({ success: false, message: 'نوع ارتقاء نامعتبر است.' });
  const now = new Date();
  const idempotencyKey = validateIdempotencyKey(req.get('Idempotency-Key'));
  try {
    const outcome = await executeIdempotently({
      userId: req.dbUser._id, scope: 'mining_upgrade', key: idempotencyKey, body: { type },
      execute: async session => {
      const current = await User.findById(req.dbUser._id).session(session);
      if (!current) throw miningError('USER_NOT_FOUND', 'کاربر پیدا نشد.', 404);
      const state = getMiningState(current, now);
      const next = type === 'rig' ? state.nextRigUpgrade : state.nextStorageUpgrade;
      if (!next) throw miningError('MINING_MAX_LEVEL', type === 'rig' ? 'دستگاه ماینر شما در بالاترین سطح قرار دارد.' : 'ظرفیت باتری در بالاترین سطح قرار دارد.');
      const pendingPoints = state.accumulatedPoints;
      const newBalance = (Number(current.points) || 0) + pendingPoints - next.cost;
      if (newBalance < 0) throw miningError('MINING_INSUFFICIENT_POINTS', `UP کافی نیست. هزینه ارتقاء: ${next.cost} UP.`);
      const setFields = { miningSavedPoints: 0, miningLastClaimAt: now, points: newBalance, miningStorageFullNotifiedAt: null };
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
          description: `تسویه خودکار ${pendingPoints} UP هنگام ارتقاء`,
          balanceAfter: (Number(current.points) || 0) + pendingPoints,
          sourceId: idempotencyTransactionId({ userId: updated._id, scope: 'mining_upgrade', key: idempotencyKey, leg: 'accrual' }), session
        });
      }
      await recordLedgerRequired({
        user: updated._id, type: 'mining_upgrade', currency: 'points', amount: -next.cost,
        description: type === 'rig' ? `ارتقاء ماینر به سطح ${next.level} (${next.name})` : `ارتقاء ظرفیت ذخیره به سطح ${next.level} (${next.name})`,
        balanceAfter: updated.points,
        sourceId: idempotencyTransactionId({ userId: updated._id, scope: 'mining_upgrade', key: idempotencyKey, leg: 'upgrade' }), session
      });
      const label = type === 'rig' ? 'ماینر' : 'ظرفیت باتری';
      return { status: 200, body: { success: true, mining: getMiningState(updated, now), newBalance: updated.points, message: `${label} به سطح ${next.level} ارتقاء یافت!` }, resourceId: idempotencyTransactionId({ userId: updated._id, scope: 'mining_upgrade', key: idempotencyKey, leg: 'upgrade' }) };
      }
    });
    return res.status(outcome.status).json(outcome.body);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
    throw error;
  }
});

module.exports = router;
module.exports.getMiningState = getMiningState;
module.exports.RIG_LEVELS = RIG_LEVELS;
module.exports.STORAGE_LEVELS = STORAGE_LEVELS;
module.exports.STARS_PRODUCTS = STARS_PRODUCTS;
module.exports.notifyMiningVaultIfFull = notifyMiningVaultIfFull;
