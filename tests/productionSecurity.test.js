'use strict';

const assert = require('assert');
const crypto = require('crypto');

const userPath = require.resolve('../models/User');
require.cache[userPath] = {
  id: userPath,
  filename: userPath,
  loaded: true,
  exports: { findOne: async () => null, findById: async () => null }
};

const { verifyInitData, MAX_INIT_DATA_AGE_SECONDS } = require('../utils/telegramAuth');
const botToken = 'offline-security-test-bot-token';

function signedInitData({ authDate = Math.floor(Date.now() / 1000), user = { id: 42, first_name: 'Security Test' }, extra = {} } = {}) {
  const params = new URLSearchParams({ auth_date: String(authDate), user: JSON.stringify(user), ...extra });
  const dataCheckString = [...params.entries()].map(([key, value]) => `${key}=${value}`).sort().join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

function signedParts({ authDate, user } = {}) {
  const initData = signedInitData({ authDate, user });
  return new URLSearchParams(initData);
}

function withHash(params) {
  const dataCheckString = [...params.entries()].filter(([key]) => key !== 'hash').map(([key, value]) => `${key}=${value}`).sort().join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex'));
  return params.toString();
}

async function main() {
  const now = Math.floor(Date.now() / 1000);
  const legitimate = signedInitData({ authDate: now });
  assert.ok(verifyInitData(legitimate, botToken), 'a correctly signed, current Telegram initData is accepted');
  assert.strictEqual(verifyInitData('', botToken), null, 'missing initData is rejected');
  assert.strictEqual(verifyInitData('auth_date=1&user=%7B%22id%22%3A42%7D', botToken), null, 'missing hash is rejected');

  const badHash = new URLSearchParams(legitimate);
  badHash.set('hash', '0'.repeat(64));
  assert.strictEqual(verifyInitData(badHash.toString(), botToken), null, 'invalid HMAC is rejected');

  const duplicate = signedParts({ authDate: now });
  duplicate.append('auth_date', String(now));
  assert.strictEqual(verifyInitData(duplicate.toString(), botToken), null, 'duplicate top-level fields are rejected before verification');

  assert.strictEqual(
    verifyInitData(withHash(new URLSearchParams({ auth_date: String(now), user: JSON.stringify({ id: '42', first_name: 'Wrong type' }) })), botToken),
    null,
    'a malformed Telegram user id is rejected even with a valid HMAC'
  );
  assert.strictEqual(
    verifyInitData(withHash(new URLSearchParams({ auth_date: String(now), user: JSON.stringify({ id: 42 }) })), botToken),
    null,
    'a Telegram user without required first_name is rejected'
  );

  assert.strictEqual(verifyInitData(signedInitData({ authDate: now + 1 }), botToken), null, 'future auth_date is rejected');
  assert.strictEqual(
    verifyInitData(signedInitData({ authDate: now - MAX_INIT_DATA_AGE_SECONDS - 1 }), botToken),
    null,
    'initData older than 24 hours is rejected'
  );
  const previousMaxAge = process.env.INIT_DATA_MAX_AGE;
  process.env.INIT_DATA_MAX_AGE = String(MAX_INIT_DATA_AGE_SECONDS * 2);
  try {
    assert.strictEqual(
      verifyInitData(signedInitData({ authDate: now - MAX_INIT_DATA_AGE_SECONDS - 1 }), botToken),
      null,
      'INIT_DATA_MAX_AGE cannot weaken the 24-hour replay bound'
    );
  } finally {
    if (previousMaxAge == null) delete process.env.INIT_DATA_MAX_AGE;
    else process.env.INIT_DATA_MAX_AGE = previousMaxAge;
  }

  // The native path remains independently authenticated by a strong Bearer
  // session and does not attempt Telegram fallback.
  const mobileAuthPath = require.resolve('../utils/mobileAuth');
  require.cache[mobileAuthPath] = {
    id: mobileAuthPath,
    filename: mobileAuthPath,
    loaded: true,
    exports: {
      requireMobileAuth() {
        return async (req, res, next) => {
          req.dbUser = { _id: 'native-user-1', telegramId: '42', isBanned: false };
          req.mobileSession = { _id: 'session-1', user: req.dbUser };
          next();
        };
      }
    }
  };
  const { requireUnifiedAuth } = require('../utils/unifiedAuth');
  const unified = requireUnifiedAuth(botToken);
  const nativeReq = {
    get(name) { return name.toLowerCase() === 'authorization' ? 'Bearer native-session-token' : ''; },
    body: {}, query: {}, method: 'GET', originalUrl: '/api/points/me', ip: '127.0.0.1'
  };
  const nativeRes = { statusCode: 200, status() { return this; }, json() { return this; } };
  let nativeNext = false;
  await unified(nativeReq, nativeRes, () => { nativeNext = true; });
  assert.strictEqual(nativeNext, true, 'a valid native session reaches protected unified routes');
  assert.strictEqual(nativeReq.dbUser._id, 'native-user-1');

  const sharedRateLimitPath = require.resolve('../utils/sharedRateLimit');
  const counters = new Map();
  const consumeCalls = [];
  const fakeConsume = async (identity, scope, maxRequests, windowMs) => {
    consumeCalls.push({ identity, scope, maxRequests, windowMs });
    const key = `${identity}|${scope}`;
    const count = (counters.get(key) || 0) + 1;
    counters.set(key, count);
    return { allowed: count <= maxRequests, count, resetAt: new Date(Date.now() + windowMs) };
  };
  require.cache[sharedRateLimitPath] = {
    id: sharedRateLimitPath,
    filename: sharedRateLimitPath,
    loaded: true,
    exports: { consumeRateLimit: fakeConsume }
  };
  const { createSensitiveRateLimit, mobileBootstrapRateLimit } = require('../utils/apiSecurity');
  const sensitive = createSensitiveRateLimit('claim', { ipMaxRequests: 100, userMaxRequests: 2 });
  const makeRequest = () => ({
    ip: '203.0.113.10',
    dbUser: { _id: 'native-user-1' },
    get() { return ''; }
  });
  const makeResponse = () => ({ statusCode: 200, headers: {}, set(key, value) { this.headers[key] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
  const concurrentResults = await Promise.all(Array.from({ length: 3 }, async () => {
    const req = makeRequest();
    const res = makeResponse();
    let passed = false;
    await sensitive(req, res, () => { passed = true; });
    return { passed, res };
  }));
  assert.strictEqual(concurrentResults.filter(item => item.passed).length, 2, 'authenticated-user sensitive limiter bounds concurrent requests');
  assert.strictEqual(consumeCalls.length, 6, 'each request consumes the IP bucket and admitted requests also consume the user bucket');

  const failing = createSensitiveRateLimit('withdraw', {
    consume: async () => { throw new Error('offline store unavailable'); }
  });
  const failingRes = makeResponse();
  let failingNext = false;
  await failing(makeRequest(), failingRes, () => { failingNext = true; });
  assert.strictEqual(failingNext, false, 'store failure never reaches a sensitive handler');
  assert.strictEqual(failingRes.statusCode, 503, 'store failure fails closed with 503');

  const mobileConsume = mobileBootstrapRateLimit('consume', { consume: fakeConsume });
  const mobileResults = await Promise.all(Array.from({ length: 6 }, async (_, index) => {
    const res = makeResponse();
    let passed = false;
    await mobileConsume({ ip: `203.0.113.${index + 30}`, body: { challengeId: 'qa-stable-challenge-id' } }, res, () => { passed = true; });
    return { passed, res };
  }));
  assert.strictEqual(mobileResults.filter(row => row.passed).length, 5, 'changing IP cannot bypass the per-challenge consume limit');
  const malformedRes = makeResponse();
  await mobileConsume({ ip: '203.0.113.90', body: { challengeId: ['fake'] } }, malformedRes, () => { throw new Error('malformed ID reached handler'); });
  assert.strictEqual(malformedRes.statusCode, 400);

  console.log('ALL PASS — production security verifier, native-session preservation, and fail-closed concurrent sensitive rate limits');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
