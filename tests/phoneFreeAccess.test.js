'use strict';

const assert = require('assert');
const crypto = require('crypto');
const express = require('express');

const telegramId = '123456';
const sentBotMessages = [];
const user = {
  _id: 'user-1', telegramId, username: 'test-user', firstName: 'Test', lastName: '', photoUrl: '',
  referralCode: 'R123', referredBy: null, points: 500, gramBalance: 3.25,
  createdAt: new Date('2020-01-01T00:00:00Z'), telegramBlockedAt: null, isBanned: false,
  language: 'en', referralMessageConsent: 'unset', save: async () => user
};
const UserPath = require.resolve('../models/User');
const userModel = { findOne: async filter => String(filter.telegramId) === telegramId ? user : null };
require.cache[UserPath] = { id: UserPath, filename: UserPath, loaded: true, exports: userModel };

const botToken = 'test-phone-gate-token';
process.env.BOT_TOKEN = botToken;
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
    user: JSON.stringify({ id: Number(telegramId), first_name: 'Test', username: 'test-user' })
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
  app.get('/api/secure', auth, (req, res) => res.json({ success: true, telegramId: req.dbUser.telegramId }));
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
    assert.strictEqual(response.status, 200, 'Telegram-authenticated users without stored phone fields can use protected APIs');
    assert.deepStrictEqual(await response.json(), { success: true, telegramId });

    response = await send('/api/auth/me');
    assert.strictEqual(response.status, 200);
    const bootstrap = await response.json();
    assert.strictEqual(bootstrap.telegramId, telegramId, 'identity is not masked for users without phone data');
    assert.strictEqual(bootstrap.points, 500, 'balances are not hidden for users without phone data');
    assert.strictEqual(bootstrap.referralCode, 'R123');
    assert.strictEqual(bootstrap.phoneVerificationRequired, undefined, 'phone gate state is no longer returned');
    assert.strictEqual(bootstrap.phoneCountryCode, undefined, 'country verification metadata is no longer returned');

    response = await send('/api/auth/request-phone-contact', 'POST');
    assert.strictEqual(response.status, 404, 'the phone-contact request endpoint is retired');
    assert.strictEqual(sentBotMessages.length, 0, 'no bot contact prompt is sent');

    response = await send('/api/auth/referral-message-consent', 'PATCH', { consent: 'granted' });
    assert.strictEqual(response.status, 200, 'notification preferences work without phone verification');
    assert.strictEqual(user.referralMessageConsent, 'granted');

    user.phoneCountryCode = '+1';
    user.phoneVerifiedAt = null;
    response = await send('/api/secure');
    assert.strictEqual(response.status, 200, 'legacy phone metadata and country prefix do not restrict access');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }

  console.log('PASS — Telegram auth and bootstrap authorize users without phone data; legacy phone metadata does not gate access');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
