'use strict';
const assert = require('assert');
const fs = require('fs');

const pointsRoute = require('../routes/points');
assert.strictEqual(pointsRoute.spinPolicy({ luckySpinCooldownHours: 24 }).cooldownHours, undefined);
assert.deepStrictEqual(pointsRoute.SPIN_PRIZES.map(item => item.id), [
  'hashrate_boost_10_1h', 'gram_005', 'up_0', 'up_50', 'up_100', 'up_250'
]);
assert.strictEqual(pointsRoute.SPIN_PRIZES.filter(item => item.kind === 'points').length, 4);
assert.strictEqual(pointsRoute.SPIN_PRIZES.find(item => item.id === 'gram_005').amount, 0.05);
assert.strictEqual(pointsRoute.SPIN_PRIZES.find(item => item.id === 'up_0').amount, 0);
assert.deepStrictEqual(pointsRoute.SPIN_PRIZES.map(item => item.probability), [35, 2.5, 2.5, 25, 15, 20]);
assert.strictEqual(pointsRoute.SPIN_PRIZES.some(item => ['up_20', 'extra_spins_2'].includes(item.id)), false);
assert.strictEqual(pointsRoute.SPIN_PRIZES.reduce((sum, item) => sum + item.probability, 0), 100);
assert.strictEqual(pointsRoute.SPIN_PRIZES[0].probability > pointsRoute.SPIN_PRIZES[1].probability, true);

const source = fs.readFileSync(require.resolve('../routes/points'), 'utf8');
assert.match(source, /scope: 'spin'/);
assert.doesNotMatch(source, /SPIN_COOLDOWN|cooldownCutoff|nextAllowedAt|spinLastClaimAt: \{ \$lte:/);
assert.match(source, /type: 'spin'/);
assert.match(source, /miningBoostUntil/);

const appSource = fs.readFileSync(require.resolve('../public/js/app.js'), 'utf8');
assert.match(appSource, /\/api\/points\/spin/);
assert.match(appSource, /getPendingIdempotencyKey\("spin"\)/);
assert.doesNotMatch(appSource, /spinCountdown|spinNextAt|spinCooldownHours|24H/);
assert.match(appSource, /HapticFeedback/);

console.log('PASS — Lucky Spin rewards, unlimited eligible spins, idempotency and client haptics');
