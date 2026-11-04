'use strict';

const assert = require('assert');
const crypto = require('crypto');
const express = require('express');

const telegramId = '123456';
const sentBotMessages = [];
const user = {
  _id: 'user-1', telegramId, username: '', firstName: 'Test', lastName: '', photoUrl: '',
    phoneCountryCode: '', phoneVerifiedAt: null, referralCode: 'R123', referredBy: null,
    points: 500,
  createdAt: new Date('2020-01-01T00:00:00Z'), telegramBlockedAt: null, isBanned: false,
  language: 'en', referralMessageConsent: 'unset', save: async () => user
};
const UserPath = require.resolve('../models/User');
const userModel = { findOne: async filter => String(filter.telegramId) === telegramId ? user : null };
require.cache[UserPath] = { id: UserPath, filename: UserPath, loaded: true, exports: userModel };

const botToken = 'test-phone-gate-token';
process.env.BOT_TOKEN = botToken;
process.env.BOT_USERNAME = 'Gram_up_bot';
const botPath = require.resolve('../utils/bot');
require.cache[botPath] = { id: botPath, filename: botPath, loaded: true, exports: { bot: {
  sendMessage: async (...args) => { sentBotMessages.push(args); return { message_id: sentBotMessages.length }; }
} } };
const settingsPath = require.resolve('../models/Settings');
require.cache[settingsPath] = { id: settingsPath, filename: settingsPath, loaded: true, exports: {
  getGlobal: async () => ({ maintenanceAllowedTelegramIds: [], maintenanceEnabled: false })
} };
const { requireTelegramAuth } = require('../utils/telegramAuth');
const auth = requireTelegramAuth(botToken);
const authRouter = require('../routes/auth');

function signedInitData() {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: Number(telegramId), first_name: 'Test' })
  });
  const pairs = [...params.entries()].map(([key, value]) => `${key}=${value}`).sort();
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(pairs.join('\n')).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

(async () => {
  const app = express();
  app.use(express.json());
  app.get('/api/secure', auth, (_req, res) => res.json({ success: true }));
  app.use('/api/auth', authRouter);

  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const initData = signedInitData();
  const send = (route, method = 'GET', body) => fetch(`${base}${route}`, {
    method,
    headers: { 'X-Telegram-Init-Data': initData, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  try {
    let response = await send('/api/secure');
    assert.strictEqual(response.status, 200, 'Telegram-authenticated users access protected APIs without phone verification');
    const bootstrap = await send('/api/auth/me');
    assert.strictEqual(bootstrap.status, 200, 'the regular app bootstrap is available without phone verification');
    const bootstrapData = await bootstrap.json();
    assert.strictEqual(bootstrapData.phoneVerificationRequired, false);
    assert.strictEqual(bootstrapData.telegramId, telegramId);
    assert.strictEqual(bootstrapData.points, 500, 'users receive their balance without sharing a phone number');
    assert.strictEqual(bootstrapData.referralCode, 'R123', 'users receive their referral identifier without phone verification');
    const contactRequest = await send('/api/auth/request-phone-contact', 'POST');
    assert.strictEqual(contactRequest.status, 200, 'the contact-request endpoint stays available');
    assert.strictEqual((await contactRequest.json()).botUrl, 'https://t.me/Gram_up_bot');
    assert.strictEqual(sentBotMessages.length, 1, 'the request sends one localized contact prompt to the Telegram user');
    assert.strictEqual(sentBotMessages[0][2].reply_markup.keyboard[0][0].request_contact, true);
    const repeatRequest = await send('/api/auth/request-phone-contact', 'POST');
    assert.strictEqual(repeatRequest.status, 200, 'users can retry the contact request at any time');
    assert.strictEqual((await repeatRequest.json()).botUrl, 'https://t.me/Gram_up_bot');
    assert.strictEqual(sentBotMessages.length, 2, 'a repeated request sends a fresh contact prompt instead of locking the user out');
    assert.strictEqual((await send('/api/auth/language', 'PATCH', { language: 'en' })).status, 200, 'users can change language without phone verification');
    response = await send('/api/auth/referral-message-consent', 'PATCH', { consent: 'granted' });
    assert.strictEqual(response.status, 200, 'unverified users can use protected account settings');
    assert.strictEqual(user.referralMessageConsent, 'granted');

    user.phoneCountryCode = '';
    user.phoneVerifiedAt = null;
    response = await send('/api/secure');
    assert.strictEqual(response.status, 200, 'users with no phone number remain fully authenticated');

    user.phoneCountryCode = '+1';
    user.phoneVerifiedAt = new Date();
    response = await send('/api/secure');
    assert.strictEqual(response.status, 200, 'a valid international +1 contact unlocks protected APIs');

    user.phoneCountryCode = '+44';
    response = await send('/api/secure');
    assert.strictEqual(response.status, 200, 'other international calling codes also unlock protected APIs');

    user.phoneCountryCode = '+98';
    response = await send('/api/secure');
    assert.strictEqual(response.status, 200, 'a verified +98 contact unlocks protected APIs');
    response = await send('/api/auth/referral-message-consent', 'PATCH', { consent: 'granted' });
    assert.strictEqual(response.status, 200, 'phone status does not change protected API access');
    assert.strictEqual(user.referralMessageConsent, 'granted');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }

  console.log('ALL PASS — Telegram authentication grants access without regional phone verification');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
