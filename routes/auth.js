'use strict';
const express = require('express');
const router = express.Router();
require('../utils/asyncHandler').wrapRouter(router);
const { requireTelegramAuth, generateReferralCode } = require('../utils/telegramAuth');
const User = require('../models/User');
const { hashNetworkIdentifier, hashDeviceIdentifier, assessReferralRisk } = require('../utils/referralRisk');
const { linkReferral } = require('../utils/referralSystem');
const { referralIdentifierQuery } = require('../utils/referralCore');
const Settings = require('../models/Settings');

const auth = requireTelegramAuth(process.env.BOT_TOKEN);

// GET /api/auth/me — بوت اولیه کاربر + اعمال کد رفرال از URL (fallback وقتی startapp نداریم)
router.get('/me', auth, async (req, res) => {
  let u = req.dbUser;
  const refFromUrl = String(req.query.ref || '').trim();
  const referralQuery = referralIdentifierQuery(refFromUrl);

  // رفرال از طریق URL فقط برای حساب‌های تازه‌ساخته‌شده (۲۴ ساعت اول) پذیرفته می‌شود
  // تا کاربران قدیمی نتوانند بعداً برای خودشان دعوت‌کننده ثبت کنند.
  const isFreshAccount = u.createdAt && Date.now() - new Date(u.createdAt).getTime() < 24 * 60 * 60 * 1000;

  if (!u.referredBy && referralQuery && isFreshAccount) {
    const referrer = await User.findOne(referralQuery).select('_id telegramId isBanned signupIpHash signupDeviceHash');
    // جلوگیری از خودارجاعی و دور رفرال (A دعوت‌کننده‌ی B و B دعوت‌کننده‌ی A)
    const isCycle = referrer && referrer.referredBy && String(referrer.referredBy) === String(u._id);
    if (referrer && !referrer.isBanned && String(referrer._id) !== String(u._id) && !isCycle) {
      const risk = assessReferralRisk({ referrer, signupIpHash: hashNetworkIdentifier(req.ip), signupDeviceHash: hashDeviceIdentifier(req.get('user-agent') || '') });
      await linkReferral({ referredUserId: u._id, referrerId: referrer._id, riskScore: risk.score, riskFlags: risk.flags, source: 'signup' });
      u = await User.findById(u._id);
    }
  }

  const settings = await Settings.getGlobal();
  const allowedTelegramIds = Array.isArray(settings.maintenanceAllowedTelegramIds)
    ? settings.maintenanceAllowedTelegramIds.map(String)
    : [];
  const maintenanceEnabled = settings.maintenanceEnabled === true;
  res.json({
    success: true,
    telegramId: u.telegramId,
    firstName: u.firstName,
    lastName: u.lastName,
    username: u.username,
    photoUrl: u.photoUrl,
    points: u.points,
    referralCode: u.referralCode,
    language: u.language,
    maintenance: {
      enabled: maintenanceEnabled,
      allowed: allowedTelegramIds.includes(String(u.telegramId)),
      required: maintenanceEnabled && !allowedTelegramIds.includes(String(u.telegramId))
    }
  });
});

// PATCH /api/auth/language — تغییر زبان انتخابی کاربر
router.patch('/language', auth, async (req, res) => {
  const { language } = req.body || {};
  if (!['fa', 'ps', 'en'].includes(language)) {
    return res.status(400).json({ success: false, message: 'زبان نامعتبر است.' });
  }
  req.dbUser.language = language;
  await req.dbUser.save();
  res.json({ success: true, language });
});

module.exports = router;
