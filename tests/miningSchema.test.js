'use strict';

const assert = require('assert');
const fs = require('fs');

const user = fs.readFileSync('models/User.js', 'utf8');
const route = fs.readFileSync('routes/mining.js', 'utf8');
const server = fs.readFileSync('server.js', 'utf8');

for (const field of ['miningLevel', 'miningStorageLevel', 'miningSavedPoints', 'miningLastClaimAt', 'totalMinedPoints']) {
  assert.match(user, new RegExp(`${field}:`), `missing ${field}`);
}
for (const field of ['antiBotVerifiedAt', 'termsAcceptedVersion', 'onboardingVersion']) {
  assert.match(user, new RegExp(`${field}:`), `missing ${field}`);
}
assert.match(server, /app\.use\(['"]\/api\/mining['"]/);
assert.match(user, /miningLevel: \{ type: Number, default: 1, min: 1, max: 10 \}/);
assert.match(user, /miningStorageLevel: \{ type: Number, default: 1, min: 1, max: 6 \}/);
assert.match(route, /router\.get\('\/status'/);
assert.match(route, /router\.post\('\/start'/);
assert.match(route, /router\.post\('\/claim'/);
assert.match(route, /\{ _id: req\.dbUser\._id, miningLastClaimAt: null \}/, 'Start only writes a missing anchor');
assert.match(route, /\$set: \{ miningLastClaimAt: now \}/, 'Start initializes, but never resets, the anchor');
assert.match(route, /sensitiveRateLimit\('claim'\)/);
assert.match(route, /executeIdempotently\(/, 'Mining mutations must persist and replay idempotent responses');
assert.match(route, /validateIdempotencyKey\(req\.get\('Idempotency-Key'\)\)/);
assert.match(route, /scope = 'mining_claim'/);
assert.match(route, /scope = 'mining_upgrade'/);
assert.match(route, /miningLedgerIdentity\(/, 'Mining ledger identities must derive from user, scope, and key');
assert.match(route, /if \(pointsToClaim < 1\) throw miningError\('MINING_NO_POINTS'/);
assert.match(route, /\$inc: \{ points: pointsToClaim, totalMinedPoints: pointsToClaim \}/);
assert.match(route, /amount: pointsToClaim,[\s\S]*?\.\.\.identity, session/,
  'Claim balance changes and its ledger entry use the same points amount and Mongo session');
assert.match(route, /PointsLedger\.find\(/, 'Mining status must expose immutable mining history');
assert.match(route, /\.limit\(MINING_HISTORY_LIMIT\)/, 'Mining history must be bounded');
assert.match(route, /user: user\._id/);
assert.match(route, /upBalance: mining\.upBalance/);
assert.doesNotMatch(route, /createdAt\s*\?\s*new Date\(user\.createdAt\)/, 'Missing mining anchor must not backdate accrual');
console.log('ALL PASS — Mining schema, route mounts, rate limits, idempotency and bounded history contracts');
