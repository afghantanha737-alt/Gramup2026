'use strict';
const express = require('express');
const router = express.Router();
require('../utils/asyncHandler').wrapRouter(router);
const { requireUnifiedAuth, isNativeSessionRequest } = require('../utils/unifiedAuth');
const { requireTelegramAuth } = require('../utils/telegramAuth');
const User = require('../models/User');
const { hashNetworkIdentifier, hashDeviceIdentifier, assessReferralRisk } = require('../utils/referralRisk');
const { linkReferral } = require('../utils/referralSystem');
const { referralIdentifierQuery } = require('../utils/referralCore');
const { isVerifiedAllowedPhone, contactRequestKeyboard } = require('../utils/telegramPhoneContact');
const { bot } = require('../utils/bot');
const { botText } = require('../utils/botMessages');
const { sendWelcomeMessage, welcomeTriggerKey } = require('../utils/telegramStart');
const { getMaintenanceState, isAllowedTelegramId } = require('../utils/maintenance');

const auth = requireUnifiedAuth(process.env.BOT_TOKEN);
const telegramAuth = requireTelegramAuth(process.env.BOT_TOKEN);

// GET /api/auth/me — بوت اولیه کاربر + اعمال کد رفرال از URL (fallback وقتی startapp نداریم)
router.get('/me', auth, async (req, res) => {
  let u = req.dbUser;
  const refFromUrl = String(req.query.ref || '').trim();
  const referralQuery = referralIdentifierQuery(refFromUrl);

  // رفرال از طریق URL فقط برای حساب‌های تازه‌ساخته‌شده (۲۴ ساعت اول) پذیرفته می‌شود
  // تا کاربران قدیمی نتوانند بعداً برای خودشان دعوت‌کننده ثبت کنند.
  const isFreshAccount = u.createdAt && Date.now() - new Date(u.createdAt).getTime() < 24 * 60 * 60 * 1000;

  if (isVerifiedAllowedPhone(u) && !u.referredBy && referralQuery && isFreshAccount) {
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
    try {
      await sendWelcomeMessage({
        message: { chat: { id: u.telegramId }, from: req.tgUser },
        user: u,
        bot,
        User,
        appUrl: process.env.APP_URL,
        payload: autoWelcomeIdentifier,
        botText,
        triggerKey: welcomeTriggerKey(autoWelcomeIdentifier)
      });
    } catch (error) {
      // Welcome delivery must not prevent the Mini App from bootstrapping.
      console.warn('Automatic startapp welcome delivery failed:', error.message || error);
    }
  }

  const maintenanceState = await getMaintenanceState();
  const maintenanceAllowed = isAllowedTelegramId(maintenanceState, u.telegramId);
  const phoneVerified = isVerifiedAllowedPhone(u);
  res.json({
    success: true,
    telegramId: phoneVerified ? u.telegramId : '',
    firstName: phoneVerified ? u.firstName : '',
    lastName: phoneVerified ? u.lastName : '',
    username: phoneVerified ? u.username : '',
    photoUrl: phoneVerified ? u.photoUrl : '',
    points: phoneVerified ? u.points : 0,
    referralCode: phoneVerified ? u.referralCode : '',
    language: u.language,
    phoneVerificationRequired: !phoneVerified,
    phoneCountryCode: phoneVerified ? u.phoneCountryCode : '',
    referralMessageConsent: phoneVerified ? (u.referralMessageConsent || 'unset') : 'unset',
    maintenance: {
      enabled: maintenanceState.enabled,
      allowed: maintenanceAllowed,
      required: maintenanceState.enabled && !maintenanceAllowed
    }
  });
});

// Telegram-only bootstrap: requireTelegramAuth deliberately permits this route
// before phone verification so the bot can receive the user's Contact.
router.post('/request-phone-contact', telegramAuth, async (req, res) => {
  if (isVerifiedAllowedPhone(req.dbUser)) return res.json({ success: true, alreadyVerified: true });
  const username = String(process.env.BOT_USERNAME || '').replace(/^@/, '').trim();
  if (!username || !/^[A-Za-z0-9_]{5,32}$/.test(username)) {
    return res.status(503).json({ success: false, code: 'PHONE_CONTACT_BOT_UNAVAILABLE', message: 'ربات برای تأیید شماره در دسترس نیست.' });
  }
  const botUrl = `https://t.me/${username}`;
  const previousRequestAt = req.dbUser.phoneContactRequestedAt;
  req.dbUser.phoneContactRequestedAt = new Date();
  await req.dbUser.save();
  try {
    if (!bot) throw new Error('Telegram bot is unavailable');
    const language = req.dbUser.language || 'fa';
    await bot.sendMessage(String(req.dbUser.telegramId), botText('phoneContactRequest', language), {
      reply_markup: contactRequestKeyboard(botText('phoneShareButton', language))
    });
  } catch (error) {
    req.dbUser.phoneContactRequestedAt = previousRequestAt || null;
    await req.dbUser.save().catch(() => {});
    return res.status(503).json({ success: false, code: 'PHONE_CONTACT_DELIVERY_FAILED', message: 'ارسال درخواست تأیید شماره ناموفق بود.' });
  }
  res.json({ success: true, botUrl });
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
