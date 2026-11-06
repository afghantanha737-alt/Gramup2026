'use strict';
const assert = require('assert');
const path = require('path');

const challengePath = require.resolve('../models/MobileAuthChallenge');
const sessionPath = require.resolve('../models/MobileSession');
const userPath = require.resolve('../models/User');
let challenge = null;
let createdSessions = 0;
const MobileAuthChallenge = {
  create: async doc => { challenge = { _id: 'challenge-1', status: 'pending', consumedAt: null, ...doc }; return challenge; },
  findOne: async filter => {
    if (!challenge) return null;
    if (filter.challengeId && filter.challengeId !== challenge.challengeId) return null;
    if (filter.tokenHash && filter.tokenHash !== challenge.tokenHash) return null;
    if (filter.status && filter.status !== challenge.status) return null;
    return { ...challenge };
  },
  findOneAndUpdate: async (filter, update) => {
    if (!challenge) return null;
    if (filter._id && filter._id !== challenge._id) return null;
    if (filter.challengeId && filter.challengeId !== challenge.challengeId) return null;
    if (filter.tokenHash && filter.tokenHash !== challenge.tokenHash) return null;
    if (filter.status && filter.status !== challenge.status) return null;
    if (filter.consumedAt === null && challenge.consumedAt !== null) return null;
    if (filter.expiresAt?.$gt && challenge.expiresAt <= filter.expiresAt.$gt) return null;
    Object.assign(challenge, update.$set || {});
    return { ...challenge };
  },
  updateOne: async (filter, update) => {
    if (challenge?._id === filter._id && challenge.status === filter.status) Object.assign(challenge, update.$set || {});
  }
};
const noPhoneUser = { _id: 'user-1', telegramId: '42', isBanned: false };
const mobileSession = { _id: 'session-1', user: noPhoneUser, save: async () => {} };
const MobileSession = {
  create: async doc => { createdSessions += 1; return doc; },
  findOne: () => ({ populate: async () => mobileSession })
};
const User = { findOne: async () => noPhoneUser };
for (const [file, exports] of [[challengePath, MobileAuthChallenge], [sessionPath, MobileSession], [userPath, User]]) {
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}
const { createMobileChallenge, verifyMobileChallenge, consumeMobileChallenge, requireMobileAuth } = require('../utils/mobileAuth');

(async () => {
  const created = await createMobileChallenge();
  const verifyResults = await Promise.all([
    verifyMobileChallenge(`mobile_${created.token}`, '42'),
    verifyMobileChallenge(`mobile_${created.token}`, '42')
  ]);
  assert.strictEqual(verifyResults.filter(Boolean).length, 1, 'only one concurrent verifier claims the pending challenge');

  const consumeResults = await Promise.all([
    consumeMobileChallenge(created.challengeId, created.token, 'test-agent'),
    consumeMobileChallenge(created.challengeId, created.token, 'test-agent')
  ]);
  assert.strictEqual(consumeResults.filter(Boolean).length, 1, 'only one concurrent consume receives an access token');
  assert.strictEqual(createdSessions, 1, 'exactly one mobile session is created for the one-time challenge');
  assert.strictEqual(challenge.status, 'consumed');
  const consumed = consumeResults.find(Boolean);
  let passed = false;
  const req = { get: name => name === 'authorization' ? `Bearer ${consumed.accessToken}` : '' };
  const res = { status() { return this; }, json() { throw new Error('phone-free session should not be rejected'); } };
  await requireMobileAuth()(req, res, () => { passed = true; });
  assert.strictEqual(passed, true, 'mobile business APIs accept a valid session when the user has no phone data');
  assert.strictEqual(req.dbUser, noPhoneUser);
  console.log('PASS — mobile challenge consumption is atomic and phone-free Bearer sessions authorize normally');
})().catch(error => { console.error(error); process.exitCode = 1; });
