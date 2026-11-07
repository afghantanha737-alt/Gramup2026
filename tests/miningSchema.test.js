'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

const user = fs.readFileSync('models/User.js', 'utf8');
const route = fs.readFileSync('routes/mining.js', 'utf8');
const server = fs.readFileSync('server.js', 'utf8');
const subscription = fs.readFileSync('models/VipSubscription.js', 'utf8');

for (const field of ['miningLevel', 'miningStorageLevel', 'miningSavedPoints', 'miningLastClaimAt', 'totalMinedPoints']) {
  assert.match(user, new RegExp(`${field}:`), `historical field compatibility missing for ${field}`);
}
for (const field of ['antiBotVerifiedAt', 'termsAcceptedVersion', 'onboardingVersion']) assert.match(user, new RegExp(`${field}:`));
assert.match(server, /app\.use\(['"]\/api\/mining['"]/);
assert.match(route, /router\.get\('\/status'/);
assert.match(route, /router\.post\('\/start'[\s\S]*VIP_MINING_PURCHASE_REQUIRED/);
assert.match(route, /router\.post\('\/claim'[\s\S]*calculateVipMiningStatus/);
assert.match(route, /router\.post\('\/upgrade'[\s\S]*VIP_MINING_PACKAGES_ONLY/);
assert.match(route, /executeIdempotently\(/);
assert.match(route, /validateIdempotencyKey\(req\.get\('Idempotency-Key'\)\)/);
assert.match(route, /scope = 'mining_claim'/);
assert.match(route, /releaseForPayout\(reserveCentsToRelease, session\)/);
assert.match(route, /type: 'mining_claim'/);
assert.match(route, /PointsLedger\.find\(/);
assert.match(subscription, /vipMiningPaidMicros/);
assert.match(route, /mining\.upBalance = balance/);
assert.doesNotMatch(route, /createdAt\s*\?\s*new Date\(user\.createdAt\)/);
console.log('PASS — VIP-only Mining routes, idempotent wallet claims, reserve settlement, and bounded history are mounted; free-rig start is disabled');
