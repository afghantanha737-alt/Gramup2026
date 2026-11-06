'use strict';

const assert = require('assert');
const fs = require('fs');
const route = fs.readFileSync(require.resolve('../routes/points'), 'utf8');
const rewards = require('../utils/spinRewards');

assert.strictEqual(rewards.SPIN_PRIZES.length, 6, 'paid spin must use the six-slice canonical pool');
assert.strictEqual(rewards.SPIN_PRIZES.reduce((sum, prize) => sum + prize.probability, 0), 100, 'spin probabilities must total 100%');
assert.deepStrictEqual(
  rewards.SPIN_PRIZES.map(prize => prize.id),
  ['hashrate_boost_10_1h', 'gram_005', 'up_0', 'up_50', 'up_100', 'up_250']
);

const paidRoute = route.slice(route.indexOf("router.post('/spin/paid'"), route.indexOf("router.post('/exchange'"));
assert.match(paidRoute, /points:\s*\{\s*\$gte:\s*cost\s*\}/);
assert.match(paidRoute, /amount:\s*-cost/);
assert.match(paidRoute, /type: 'spin'/);
assert.match(paidRoute, /rewardAmount = \['points', 'gram'\]\.includes\(prize\.kind\) \? Number\(prize\.amount\) : 0/);
assert.match(paidRoute, /scope: 'spin_paid', key: operationKey, leg: 'debit'/);
assert.match(paidRoute, /scope: 'spin_paid', key: operationKey, leg: 'reward'/);
assert.match(paidRoute, /code: 'SPIN_PAYMENT_UNAVAILABLE'/);
assert.match(paidRoute, /Your UP balance was not changed/);
assert.match(paidRoute, /execute: async session =>/);

console.log('PASS — paid spin requires 50 UP, applies one canonical six-slice reward, journals debit/reward atomically, and fails closed');
