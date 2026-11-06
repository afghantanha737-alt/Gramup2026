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
const MobileSession = { create: async doc => { createdSessions += 1; return doc; } };
const User = { findOne: async () => ({ _id: 'user-1', telegramId: '42', isBanned: false }) };
for (const [file, exports] of [[challengePath, MobileAuthChallenge], [sessionPath, MobileSession], [userPath, User]]) {
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}
const { createMobileChallenge, verifyMobileChallenge, consumeMobileChallenge } = require('../utils/mobileAuth');

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
  console.log('PASS — mobile auth challenge verification and session consumption are atomic under concurrency');
})().catch(error => { console.error(error); process.exitCode = 1; });
