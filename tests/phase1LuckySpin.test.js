'use strict';
const assert = require('assert');
const fs = require('fs');

const pointsRoute = require('../routes/points');
assert.strictEqual(pointsRoute.SPIN_COOLDOWN_MS, 24 * 60 * 60 * 1000);
assert.deepStrictEqual(pointsRoute.SPIN_PRIZES.map(item => item.id), [
  'up_5', 'up_15', 'up_30', 'boost_2x_1h', 'gram_001', 'try_again'
]);
assert.strictEqual(pointsRoute.SPIN_PRIZES.filter(item => item.kind === 'points').length, 3);
assert.strictEqual(pointsRoute.SPIN_PRIZES.find(item => item.id === 'gram_001').amount, 0.01);

const source = fs.readFileSync(require.resolve('../routes/points'), 'utf8');
assert.match(source, /scope: 'spin'/);
assert.match(source, /spinLastClaimAt: \{ \$lte: cooldownCutoff \}/);
assert.match(source, /type: 'spin'/);
assert.match(source, /miningBoostUntil/);

const appSource = fs.readFileSync(require.resolve('../public/js/app.js'), 'utf8');
assert.match(appSource, /\/api\/points\/spin/);
assert.match(appSource, /getPendingIdempotencyKey\("spin"\)/);
assert.match(appSource, /spinCountdown/);
assert.match(appSource, /HapticFeedback/);

console.log('PASS — Lucky Spin prize contract, 24-hour cooldown, idempotency and client haptics');
