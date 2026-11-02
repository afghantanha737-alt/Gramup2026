'use strict';

const assert = require('assert');
const fs = require('fs');

const user = fs.readFileSync('models/User.js', 'utf8');
const route = fs.readFileSync('routes/mining.js', 'utf8');
const server = fs.readFileSync('server.js', 'utf8');

for (const field of ['miningLevel', 'miningStorageLevel', 'miningSavedPoints', 'miningLastClaimAt', 'miningBoostExpiresAt', 'totalMinedPoints']) {
  assert.match(user, new RegExp(`${field}:`), `missing ${field}`);
}
for (const field of ['antiBotVerifiedAt', 'termsAcceptedVersion', 'onboardingVersion']) {
  assert.match(user, new RegExp(`${field}:`), `missing ${field}`);
}
assert.match(server, /app\.use\(['"]\/api\/mining['"]/);
assert.match(server, /app\.use\(['"]\/api\/onboarding['"]/);
assert.match(route, /sensitiveRateLimit\('mining_claim'\)/);
assert.match(route, /sensitiveRateLimit\('mining_upgrade'\)/);
assert.match(route, /feature interaction time|Missing legacy state/);
assert.match(route, /validateIdempotencyKey\(req\.get\('Idempotency-Key'\)\)/);
assert.match(route, /executeIdempotently\(/, 'Mining mutations must persist and replay idempotent responses');
assert.match(route, /PointsLedger\.find\(/, 'Mining status must expose immutable mining history');
assert.doesNotMatch(route, /mining-claim:\$\{updated\._id\}:\$\{crypto\.randomUUID\(\)\}/);
console.log('ALL PASS — Mining schema contract, route mounts, rate limits and deterministic ledger identities');
