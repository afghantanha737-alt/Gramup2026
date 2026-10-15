'use strict';
const express = require('express');
const router = express.Router();
require('../utils/asyncHandler').wrapRouter(router);
const { requireUnifiedAuth } = require('../utils/unifiedAuth');
const { withMembership } = require('../utils/membership');
const User = require('../models/User');
const { getAdsConfig, adsStateForUser, grantAdReward, grantMiningBoost, safeEqual } = require('../utils/adsgram');

const auth = withMembership(requireUnifiedAuth(process.env.BOT_TOKEN));

// GET /api/ads/config — وضعیت تبلیغات برای کاربر فعلی
router.get('/config', auth, async (req, res) => {
  res.json({ success: true, ads: adsStateForUser(req.dbUser) });
});

// POST /api/ads/reward — بعد از اینکه AdController.show() با موفقیت (تماشا تا انتها) تمام شد
router.post('/reward', auth, async (req, res) => {
  const config = getAdsConfig();
  if (config.rewardSecret) {
    // در حالت Reward URL، پاداش را خود سرور AdsGram تایید می‌کند؛ کلاینت فقط موجودی را تازه می‌کند.
    return res.json({ success: true, pending: true, ads: adsStateForUser(req.dbUser) });
  }
  try {
    const result = await grantAdReward(req.dbUser._id, 'client');
    return res.json({ success: true, earned: result.earned, points: result.user.points, ads: adsStateForUser(result.user) });
  } catch (error) {
    if (error.code && error.code.startsWith('ADS_')) {
      return res.status(error.statusCode || 400).json({ success: false, code: error.code, message: error.message });
    }
    throw error;
  }
});

// Client calls cannot prove that an ad was watched. Boosts are granted only by the authenticated AdsGram Reward URL below.
router.post('/mining-boost', auth, async (req, res) => {
  return res.status(409).json({
    success: false,
    code: 'ADS_REWARD_CALLBACK_REQUIRED',
    message: 'بوست فقط پس از تأیید پاداش از سرور AdsGram فعال می‌شود.'
  });
});

/**
 * GET /api/ads/adsgram-reward?userid=[userId]&secret=YOUR_SECRET[&reward=mining_boost]
 * آدرس «Reward URL» در تنظیمات بلاک AdsGram (اختیاری). AdsGram [userId] را با Telegram ID کاربر جایگزین می‌کند.
 */
router.get('/adsgram-reward', async (req, res) => {
  const config = getAdsConfig();
  if (!config.rewardSecret || !safeEqual(req.query.secret, config.rewardSecret)) {
    return res.status(403).json({ success: false, message: 'forbidden' });
  }
  const telegramId = String(req.query.userid || '').trim();
  if (!/^[0-9]{1,20}$/.test(telegramId)) return res.status(400).json({ success: false, message: 'invalid userid' });
  const user = await User.findOne({ telegramId }).select('_id');
  if (!user) return res.status(404).json({ success: false, message: 'user not found' });
  try {
    if (String(req.query.reward || '') === 'mining_boost') {
      const result = await grantMiningBoost(user._id, 'adsgram');
      return res.json({ success: true, reward: 'mining_boost', boostExpiresAt: result.boostExpiresAt.toISOString() });
    }
    const result = await grantAdReward(user._id, 'adsgram');
    return res.json({ success: true, earned: result.earned });
  } catch (error) {
    if (error.code && error.code.startsWith('ADS_')) {
      // 200 تا AdsGram درخواست را بی‌دلیل تکرار نکند؛ پاداش اضافه داده نمی‌شود.
      return res.json({ success: false, code: error.code });
    }
    throw error;
  }
});

module.exports = router;
