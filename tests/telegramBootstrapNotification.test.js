'use strict';
const assert = require('assert');
const express = require('express');
function stub(moduleName, exports) {
  const p = require.resolve(moduleName);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}
const user = { _id: 'test-user', telegramId: '123', language: 'en', phoneCountryCode: '+93', phoneVerifiedAt: new Date(),
  points: 10, createdAt: new Date('2020-01-01'), referralCode: 'ref', referredBy: null };
stub('../models/User', {});
stub('../utils/unifiedAuth', {
  requireUnifiedAuth: () => (req, _res, next) => { req.dbUser = user; req.tgUser = { id: 123 }; req.telegramStartParam = 'ref_test'; next(); },
  isNativeSessionRequest: req => req.get('X-Test-Native') === '1'
});
stub('../utils/telegramAuth', { requireTelegramAuth: () => (_req, _res, next) => next() });
stub('../utils/referralSystem', { linkReferral: async () => { throw Error('unexpected financial call'); } });
stub('../utils/bot', { bot: {} });
stub('../utils/maintenance', { getMaintenanceState: async () => ({ enabled: false }), isAllowedTelegramId: () => false });
let failWelcome;
let calls = 0;
let pending = new Promise((_resolve, reject) => { failWelcome = reject; });
stub('../utils/telegramStart', { welcomeTriggerKey: value => value, sendWelcomeMessage: () => { calls++; return pending; } });
const app = express(); app.use('/api/auth', require('../routes/auth'));
(async () => {
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const endpoint = `http://127.0.0.1:${server.address().port}/api/auth/me`;
  const unhandled = [];
  const onUnhandled = error => unhandled.push(error);
  process.on('unhandledRejection', onUnhandled);
  try {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(1000) });
    assert.strictEqual(response.status, 200, 'bootstrap finishes while welcome is still unresolved');
    assert.strictEqual((await response.json()).points, 10);
    assert.strictEqual(calls, 1);
    failWelcome(Error('simulated late Telegram failure'));
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(unhandled.length, 0, 'a late notification rejection is caught');
    pending = Promise.resolve({ sent: true });
    const native = await fetch(endpoint, { headers: { 'X-Test-Native': '1' }, signal: AbortSignal.timeout(1000) });
    assert.strictEqual(native.status, 200);
    assert.strictEqual(calls, 1, 'native bootstrap does not introduce Telegram sending');
    assert.strictEqual(user.points, 10, 'only optional notification execution is changed');
  } finally {
    process.off('unhandledRejection', onUnhandled);
    await new Promise(resolve => server.close(resolve));
  }
  console.log('PASS — real HTTP bootstrap is nonblocking during a pending welcome; late rejection is caught and native/financial behavior is preserved');
})().catch(error => { console.error(error); process.exitCode = 1; });
