'use strict';
const express = require('express');
const router = express.Router();
require('../utils/asyncHandler').wrapRouter(router);
const MobileSession = require('../models/MobileSession');
const { createMobileChallenge, findChallenge, consumeMobileChallenge, getMobileSession, hashToken } = require('../utils/mobileAuth');
const { mobileBootstrapRateLimit } = require('../utils/apiSecurity');

function botDeepLink(token) {
  const username = String(process.env.BOT_USERNAME || '').replace(/^@/, '').trim();
  return username ? `https://t.me/${username}?start=mobile_${encodeURIComponent(token)}` : '';
}

router.post('/challenge', mobileBootstrapRateLimit('challenge'), async (req, res) => {
  const challenge = await createMobileChallenge();
  res.json({ success: true, challengeId: challenge.challengeId, token: challenge.token, expiresAt: challenge.expiresAt, deepLink: botDeepLink(challenge.token) });
});

router.get('/challenge/:challengeId', mobileBootstrapRateLimit('poll'), async (req, res) => {
  const challenge = await findChallenge(req.params.challengeId, String(req.query.token || ''));
  if (!challenge) return res.status(404).json({ success: false, code: 'MOBILE_CHALLENGE_INVALID', message: 'چالش ورود منقضی یا نامعتبر است.' });
  res.json({ success: true, status: challenge.status, telegramId: challenge.status === 'verified' ? challenge.telegramId : undefined, expiresAt: challenge.expiresAt });
});

router.post('/consume', mobileBootstrapRateLimit('consume'), async (req, res) => {
  const { challengeId, token } = req.body || {};
  const result = await consumeMobileChallenge(String(challengeId || ''), String(token || ''), req.get('user-agent'));
  if (!result) return res.status(401).json({ success: false, code: 'MOBILE_CHALLENGE_NOT_VERIFIED', message: 'ورود Telegram هنوز تأیید نشده است.' });
  res.json({ success: true, accessToken: result.accessToken, expiresAt: result.expiresAt, user: { id: String(result.user._id), telegramId: result.user.telegramId, firstName: result.user.firstName, username: result.user.username, points: result.user.points, upBalance: Number(result.user.points) || 0, gramBalance: result.user.gramBalance } });
});

router.get('/me', require('../utils/mobileAuth').requireMobileAuth(), async (req, res) => {
  const u = req.dbUser;
  res.json({ success: true, user: { id: String(u._id), telegramId: u.telegramId, firstName: u.firstName, username: u.username, points: u.points, upBalance: Number(u.points) || 0, gramBalance: u.gramBalance, language: u.language } });
});

router.post('/logout', require('../utils/mobileAuth').requireMobileAuth(), async (req, res) => {
  await MobileSession.updateOne({ _id: req.mobileSession._id }, { $set: { revokedAt: new Date() } });
  res.json({ success: true });
});

module.exports = router;
