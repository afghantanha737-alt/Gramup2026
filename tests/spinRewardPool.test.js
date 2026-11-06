'use strict';

const assert = require('assert');
const fs = require('fs');
const { SPIN_PRIZES, defaultSpinPrizes, isValidSpinPrizePool, normalizeSpinPrizes } = require('../utils/spinRewards');
const pointsRoute = require('../routes/points');
const Settings = require('../models/Settings');

const expectedIds = [
  'hashrate_boost_10_1h', 'gram_005', 'up_0', 'up_50', 'up_100', 'up_250'
];
assert.deepStrictEqual(SPIN_PRIZES.map(prize => prize.id), expectedIds);
assert.deepStrictEqual(SPIN_PRIZES.map(prize => prize.probability), [35, 2.5, 2.5, 25, 15, 20]);
assert.strictEqual(SPIN_PRIZES.reduce((sum, prize) => sum + prize.probability, 0), 100);
assert.strictEqual(SPIN_PRIZES.find(prize => prize.id === 'hashrate_boost_10_1h').label, '10% Mining Hashrate Boost');
assert.deepStrictEqual(SPIN_PRIZES.find(prize => prize.id === 'gram_005'), {
  id: 'gram_005', kind: 'gram', amount: 0.05, label: '+0.05 GRAM', probability: 2.5
});
assert.deepStrictEqual(SPIN_PRIZES.find(prize => prize.id === 'up_0'), {
  id: 'up_0', kind: 'points', amount: 0, label: '0 UP', probability: 2.5
});
assert.strictEqual(SPIN_PRIZES.some(prize => ['up_20', 'extra_spins_2'].includes(prize.id)), false);
assert.strictEqual(isValidSpinPrizePool(defaultSpinPrizes()), true);

const stalePool = [
  { id: 'hashrate_boost_10_1h', kind: 'boost', amount: 10, label: '10% Mining Hashrate Boost · 1h', probability: 35 },
  { id: 'up_50', kind: 'points', amount: 50, label: '+50 UP', probability: 25 },
  { id: 'up_100', kind: 'points', amount: 100, label: '+100 UP', probability: 15 },
  { id: 'up_250', kind: 'points', amount: 250, label: '+250 UP', probability: 10 },
  { id: 'gram_005', kind: 'gram', amount: 0.05, label: '+0.05 GRAM', probability: 5 },
  { id: 'try_again', kind: 'none', amount: 0, label: 'Try Again', probability: 10 }
];
assert.strictEqual(isValidSpinPrizePool(stalePool), false);
assert.deepStrictEqual(normalizeSpinPrizes(stalePool), defaultSpinPrizes());
assert.deepStrictEqual(pointsRoute.spinPolicy({ luckySpinPrizes: stalePool }).prizes, defaultSpinPrizes());

const settings = new Settings();
assert.deepStrictEqual(settings.luckySpinPrizes.map(prize => String(prize.id)), expectedIds);
assert.strictEqual(settings.luckySpinPrizes.reduce((sum, prize) => sum + Number(prize.probability), 0), 100);

const source = fs.readFileSync(require.resolve('../routes/points'), 'utf8');
const adminSource = fs.readFileSync(require.resolve('../routes/admin'), 'utf8');
const adminPage = fs.readFileSync(require.resolve('../public/admin.html'), 'utf8');
const appSource = fs.readFileSync(require.resolve('../public/js/app.js'), 'utf8');
const i18nSource = fs.readFileSync(require.resolve('../public/js/i18n.js'), 'utf8');
const cssSource = fs.readFileSync(require.resolve('../public/css/style.css'), 'utf8');

const expectedPicks = [
  [0, 'hashrate_boost_10_1h'], [35, 'gram_005'], [37.5, 'up_0'],
  [40, 'up_50'], [65, 'up_100'], [80, 'up_250']
];
for (const [roll, prizeId] of expectedPicks) {
  assert.strictEqual(pointsRoute.pickWeightedPrize(SPIN_PRIZES, roll).id, prizeId, `roll ${roll} selects ${prizeId}`);
}

assert.match(source, /prize\.kind === 'spins'\) update\.\$inc\.tickets \+= prize\.amount/);
assert.match(source, /prize\.kind === 'spins'\) update\.\$inc\.tickets = prize\.amount/);
assert.match(source, /const ledgerAmount = \['points', 'gram'\]\.includes\(prize\.kind\) \? prize\.amount : 0/);
assert.match(source, /const rewardAmount = \['points', 'gram'\]\.includes\(prize\.kind\) \? Number\(prize\.amount\) : 0/);
assert.match(adminSource, /isValidSpinPrizePool\(prizes\)/);
assert.match(adminSource, /luckySpinPrizes: normalizeSpinPrizes\(settings\.luckySpinPrizes\)/);
assert.match(adminPage, /data-spin-field="kind" disabled/);
assert.match(adminPage, /data-spin-field="probability"/);
assert.doesNotMatch(adminPage, /onclick="addLuckySpinRewardRow\(\)"/);
assert.match(appSource, /gram_005: \["\+0\.05", "GRAM"\]/);
assert.match(appSource, /up_0: \["0", "UP"\]/);
assert.match(appSource, /spinPrizeTargetRotation\(prizeId\)/);
assert.match(appSource, /runSpinWheelAnimation\(wheel, result\.prizeId \?\? result\.prize\?\.id\)/);
assert.match(cssSource, /60deg/);
assert.match(i18nSource, /spin_prize_zero_up:/);
assert.match(i18nSource, /spin_prize_gram:/);
assert.match(i18nSource, /spin_extra_spins_added:/);

console.log('PASS — canonical six-spin pool, 100% odds, ticket rewards, ledger amounts, Admin contract, and result-aligned wheel');
