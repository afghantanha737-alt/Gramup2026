'use strict';
const express = require('express');
const router = express.Router();
require('../utils/asyncHandler').wrapRouter(router);
const { requireUnifiedAuth } = require('../utils/unifiedAuth');
const { withMembership } = require('../utils/membership');
const User = require('../models/User');
const { getAdsConfig, adsStateForUser, grantAdReward, safeEqual } = require('../utils/adsgram');

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

// POST /api/ads/mining-boost — فعال‌سازی بوست ۲ برابری ماینینگ به مدت ۳۰ دقیقه بعد از تماشای تبلیغ Adsgram
router.post('/mining-boost', auth, async (req, res) => {
  try {
    const user = await User.findById(req.dbUser._id);
    if (!user) return res.status(404).json({ success: false, message: 'کاربر پیدا نشد.' });

    const now = new Date();
    const BOOST_DURATION_MS = 30 * 60 * 1000; // ۳۰ دقیقه
    const currentExpiry = user.miningBoostExpiresAt ? new Date(user.miningBoostExpiresAt).getTime() : 0;
    const baseTime = currentExpiry > now.getTime() ? currentExpiry : now.getTime();
    const newExpiresAt = new Date(baseTime + BOOST_DURATION_MS);

    user.miningBoostExpiresAt = newExpiresAt;
    user.totalAdViews = (Number(user.totalAdViews) || 0) + 1;
    await user.save();

    return res.json({
      success: true,
      boostExpiresAt: newExpiresAt.toISOString(),
      message: 'بوست ۲ برابری ماینینگ به مدت ۳۰ دقیقه با موفقیت فعال شد.'
    });
  } catch (error) {
    console.error('Mining boost failed:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/ads/adsgram-reward?userid=[userId]&secret=YOUR_SECRET
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
