'use strict';
const assert = require('assert');
const crypto = require('crypto');
const userPath = require.resolve('../models/User');
const now = Math.floor(Date.now() / 1000);
const botToken = 'test-bot-token';
const user = {
  _id: 'user-42', telegramId: '42', createdAt: new Date(now * 1000 - 60_000),
  username: '', firstName: 'Test', lastName: '', photoUrl: '', isBanned: false,
  phoneCountryCode: '+93', phoneVerifiedAt: new Date(), referralMessageConsent: 'unset'
};
require.cache[userPath] = {
  id: userPath,
  filename: userPath,
  loaded: true,
  exports: { findOne: async () => user, findById: async () => user }
};

function signedInitData() {
  const params = new URLSearchParams({ auth_date: String(now), user: JSON.stringify({ id: 42, first_name: 'Test' }) });
  const dataCheckString = [...params.entries()].map(([key, value]) => `${key}=${value}`).sort().join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

const initData = signedInitData();
const { requireTelegramAuth } = require('../utils/telegramAuth');
const middleware = requireTelegramAuth(botToken);
function callMiddleware({ header = '', query = {} } = {}) {
  const req = {
    get: name => name === 'X-Telegram-Init-Data' ? header : '',
    query,
    body: null,
    method: 'GET',
    originalUrl: '/api/points/me',
    ip: '127.0.0.1',
    dbUser: null
  };
  const res = {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.payload = value; return this; }
  };
  return new Promise(resolve => middleware(req, res, () => resolve({ passed: true, req, res })).then(() => {
    if (res.payload) resolve({ passed: false, req, res });
  }));
}

(async () => {
  const queryResult = await callMiddleware({ query: { initData } });
  assert.strictEqual(queryResult.passed, false, 'valid-looking initData in the URL query is rejected');
  assert.strictEqual(queryResult.res.statusCode, 401);

  const headerResult = await callMiddleware({ header: initData });
  assert.strictEqual(headerResult.passed, true, 'the signed Telegram header still authenticates');
  assert.strictEqual(headerResult.req.dbUser.telegramId, '42');
  console.log('PASS — Telegram initData uses the signed header, not a replayable URL query parameter');
})().catch(error => { console.error(error); process.exitCode = 1; });
