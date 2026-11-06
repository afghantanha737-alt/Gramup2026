'use strict';
const express = require('express');
const router = express.Router();
require('../utils/asyncHandler').wrapRouter(router);
const { requireUnifiedAuth, isNativeSessionRequest } = require('../utils/unifiedAuth');
const User = require('../models/User');
const { hashNetworkIdentifier, hashDeviceIdentifier, assessReferralRisk } = require('../utils/referralRisk');
const { linkReferral } = require('../utils/referralSystem');
const { referralIdentifierQuery } = require('../utils/referralCore');
const { bot } = require('../utils/bot');
const { botText } = require('../utils/botMessages');
const { sendWelcomeMessage, welcomeTriggerKey } = require('../utils/telegramStart');
const { getMaintenanceState, isAllowedTelegramId } = require('../utils/maintenance');
const { safelySendTelegram } = require('../utils/telegramNotification');

const auth = requireUnifiedAuth(process.env.BOT_TOKEN);

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

  const autoWelcomeIdentifier = String(req.telegramStartParam || refFromUrl || '').trim();
  // Native mobile sessions have no Telegram initData/start parameter. Never
  // attempt a bot action with an unauthenticated/absent Telegram user object.
  if (autoWelcomeIdentifier && bot && req.tgUser && !isNativeSessionRequest(req)) {
    // Best-effort delivery must not hold the bootstrap response open. The
    // helper handles both sync errors and rejected background promises.
    void safelySendTelegram(() => sendWelcomeMessage({
        message: { chat: { id: u.telegramId }, from: req.tgUser },
        user: u,
        bot,
        User,
        appUrl: process.env.APP_URL,
        payload: autoWelcomeIdentifier,
        botText,
        triggerKey: welcomeTriggerKey(autoWelcomeIdentifier)
      }), { context: 'bootstrap_welcome' });
  }

  const maintenanceState = await getMaintenanceState();
  const maintenanceAllowed = isAllowedTelegramId(maintenanceState, u.telegramId);
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
    referralMessageConsent: u.referralMessageConsent || 'unset',
    maintenance: {
      enabled: maintenanceState.enabled,
      allowed: maintenanceAllowed,
      required: maintenanceState.enabled && !maintenanceAllowed
    }
  });
});


router.patch('/referral-message-consent', auth, async (req, res) => {
  const consent = String(req.body?.consent || '');
  if (!['granted', 'denied'].includes(consent)) {
    return res.status(400).json({ success: false, code: 'INVALID_NOTIFICATION_CONSENT', message: 'انتخاب رضایت نامعتبر است.' });
  }
  req.dbUser.referralMessageConsent = consent;
  req.dbUser.referralMessageConsentAt = new Date();
  req.dbUser.referralMessageConsentVersion = 'referral-messages-v1';
  await req.dbUser.save();
  res.json({ success: true, consent, consentAt: req.dbUser.referralMessageConsentAt });
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
