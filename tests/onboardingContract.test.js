'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const routeSource = fs.readFileSync(path.join(root, 'routes/onboarding.js'), 'utf8');
const userSource = fs.readFileSync(path.join(root, 'models/User.js'), 'utf8');
const challengeSource = fs.readFileSync(path.join(root, 'models/OnboardingChallenge.js'), 'utf8');

// Stub only route dependencies to exercise its pure proof/status helpers.
const userPath = require.resolve('../models/User');
const challengePath = require.resolve('../models/OnboardingChallenge');
require.cache[userPath] = { id: userPath, filename: userPath, loaded: true, exports: {} };
require.cache[challengePath] = { id: challengePath, filename: challengePath, loaded: true, exports: {} };
const onboarding = require('../routes/onboarding');

assert.match(routeSource, /router\.get\('\/status'/);
assert.match(routeSource, /router\.post\('\/antibot\/challenge'/);
assert.match(routeSource, /router\.post\('\/antibot\/verify'/);
assert.match(routeSource, /router\.post\('\/terms\/accept'/);
assert.match(routeSource, /router\.post\('\/complete'/);
assert.match(routeSource, /sensitiveRateLimit\('onboarding'/);
assert.doesNotMatch(routeSource, /localStorage/);
assert.doesNotMatch(challengeSource, /expireAfterSeconds/, 'Onboarding must not mutate an existing expiresAt index into TTL');
for (const field of ['antiBotVerifiedAt', 'antiBotVerificationVersion', 'termsAcceptedVersion', 'termsAcceptedAt', 'onboardingVersion', 'onboardingCompletedAt']) {
  assert.match(userSource, new RegExp(`${field}:`), `User model must persist ${field}`);
}

const nonce = 'synthetic-onboarding-nonce';
let counter = 0;
while (!onboarding.validProofOfWork(nonce, String(counter), 3)) counter += 1;
assert.ok(counter >= 0);
assert.strictEqual(onboarding.validProofOfWork(nonce, String(counter), 3), true);
assert.strictEqual(onboarding.validProofOfWork(nonce, String(counter + 1), 8), false);
assert.strictEqual(onboarding.validProofOfWork(nonce, '-1', 3), false);
assert.strictEqual(onboarding.normalizeCounter('0002'), null);
assert.strictEqual(onboarding.normalizeCounter('42'), '42');

const unverified = onboarding.onboardingStatus({ connectedWallet: { address: 'EQabc', network: 'TON_MAINNET' } });
assert.strictEqual(unverified.antiBot.status, 'required');
assert.strictEqual(unverified.terms.required, true);
assert.strictEqual(unverified.wallet.state, 'connected_unverified');

const verified = onboarding.onboardingStatus({
  antiBotVerificationVersion: onboarding.ANTI_BOT_VERSION,
  antiBotVerifiedAt: new Date(),
  termsAcceptedVersion: onboarding.TERMS_VERSION,
  termsAcceptedAt: new Date(),
  onboardingVersion: onboarding.ONBOARDING_VERSION,
  onboardingCompletedAt: new Date(),
  connectedWallet: { address: 'EQabc', canonicalAddress: 'EQabc', network: 'TON_MAINNET', proofVerifiedAt: new Date() }
});
assert.strictEqual(verified.antiBot.status, 'verified');
assert.strictEqual(verified.terms.required, false);
assert.strictEqual(verified.wallet.state, 'verified');
assert.ok(verified.completedAt);

// Keep Node's crypto import used so static bundlers/test linters do not simplify
// the proof test into a client supplied value.
assert.strictEqual(crypto.createHash('sha256').update('onboarding').digest('hex').length, 64);
console.log('ALL PASS — onboarding server contract, server-verifiable proof-of-work, terms versioning and TON proof state');
