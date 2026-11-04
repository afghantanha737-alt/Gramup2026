'use strict';

const assert = require('assert');
const {
  DAY_MS,
  centsFromPoints,
  cumulativeAccruedCents,
  estimatedAccruedPoints,
  calculateVipAccrual
} = require('../utils/vipAccrual');

const startAt = new Date('2026-11-01T00:00:00.000Z');
const endAt = new Date(startAt.getTime() + 100 * DAY_MS);
const plan1 = {
  status: 'active',
  policyVersion: 'v2_100d',
  startAt,
  endAt,
  durationDays: 100,
  pricePoints: 10000,
  principalDailyBps: 100,
  rewardDailyBps: 10,
  totalRewardCents: 100000,
  claimedRewardPoints: 0,
  principalPaidPoints: 0,
  principalReturnedAt: null
};

assert.strictEqual(centsFromPoints(0.076), 8, 'ledger precision rounds to cents');
assert.strictEqual(centsFromPoints(-0.01), null);
assert.strictEqual(cumulativeAccruedCents(1100000, startAt, endAt, startAt), 0);
assert.strictEqual(cumulativeAccruedCents(1100000, startAt, endAt, endAt), 1100000,
  'all configured payout liability is accrued at maturity');

const oneMinute = new Date(startAt.getTime() + 60 * 1000);
const minuteAccrual = calculateVipAccrual(plan1, oneMinute);
assert.strictEqual(minuteAccrual.dailyMiningRatePoints, 110);
assert.strictEqual(minuteAccrual.rewardPendingCents, 1);
assert.strictEqual(minuteAccrual.principalPendingCents, 6);
assert.strictEqual(minuteAccrual.unclaimedPoints, 0.07);
assert.strictEqual(minuteAccrual.estimatedUnclaimedPoints, 0.076,
  'the UI estimate exposes granular real-time accrual beyond the cent-rounded claim amount');
assert.strictEqual(minuteAccrual.canClaim, true);

const oneHour = calculateVipAccrual(plan1, new Date(startAt.getTime() + 60 * 60 * 1000));
assert.strictEqual(oneHour.unclaimedPoints, 4.58);
assert.strictEqual(oneHour.estimatedUnclaimedPoints, 4.583);

const beforeStorageCap = calculateVipAccrual({ ...plan1, lastClaimAt: startAt },
  new Date(startAt.getTime() + 23 * 60 * 60 * 1000));
assert.strictEqual(beforeStorageCap.storageFull, false);
assert.strictEqual(beforeStorageCap.elapsedSeconds, 23 * 60 * 60);
const afterStorageCap = calculateVipAccrual({ ...plan1, lastClaimAt: startAt },
  new Date(startAt.getTime() + 48 * 60 * 60 * 1000));
assert.strictEqual(afterStorageCap.elapsedSeconds, 86400);
assert.strictEqual(afterStorageCap.storageFull, true);
assert.strictEqual(afterStorageCap.storageCapAt.getTime(), startAt.getTime() + DAY_MS);
assert.strictEqual(afterStorageCap.unclaimedPoints, 110,
  'active miner accrual stays frozen at exactly one day, even when queried two days later');

const afterFirstClaim = calculateVipAccrual({
  ...plan1,
  claimedRewardPoints: minuteAccrual.rewardPoints,
  principalPaidPoints: minuteAccrual.principalPoints,
  lastClaimAt: oneMinute
}, new Date(startAt.getTime() + 2 * 60 * 1000));
assert.ok(afterFirstClaim.rewardPendingCents > 0 || afterFirstClaim.principalPendingCents > 0,
  'unpaid fractional-cent remainder and new accrual carry forward after partial claims');
assert.strictEqual(afterFirstClaim.unclaimedPoints, 0.08,
  'second partial claim only includes unpaid cents accumulated since the first claim');

const final = calculateVipAccrual({
  ...plan1,
  claimedRewardPoints: 0,
  principalPaidPoints: 0
}, endAt);
assert.strictEqual(final.rewardPendingCents, 1000, 'unclaimed reward is capped at one storage day');
assert.strictEqual(final.principalPendingCents, 10000, 'unclaimed principal accrual is capped at one storage day');
assert.strictEqual(final.unclaimedPoints, 110);
assert.strictEqual(final.dailyMiningRatePoints, 0);
assert.strictEqual(final.canClaim, true);
assert.strictEqual(final.storageFull, false, 'matured plans are settlement-ready rather than storage-full');

const legacy = {
  status: 'active',
  policyVersion: 'legacy_v1',
  startAt,
  endAt: new Date(startAt.getTime() + 30 * DAY_MS),
  durationDays: 30,
  pricePoints: 10000,
  totalRewardCents: 100000,
  claimedRewardPoints: 0,
  principalPaidPoints: 0,
  principalReturnedAt: null
};
const legacyDay = calculateVipAccrual(legacy, new Date(startAt.getTime() + DAY_MS));
assert.strictEqual(legacyDay.unclaimedPoints, 33.33);
assert.strictEqual(legacyDay.dailyMiningRatePoints, 33.3333);
assert.strictEqual(legacyDay.principalPoints, 0, 'legacy principal is not paid early');
const legacyMatured = calculateVipAccrual(legacy, legacy.endAt);
assert.strictEqual(legacyMatured.rewardPendingCents, 3333, 'legacy mining reward is capped at one storage day');
assert.strictEqual(legacyMatured.principalPendingCents, 1000000,
  'legacy principal becomes claimable only at maturity');
assert.strictEqual(legacyMatured.unclaimedPoints, 10033.33);

assert.strictEqual(estimatedAccruedPoints(1100000, 0, startAt, endAt, oneMinute), 0.076);
assert.strictEqual(calculateVipAccrual({ ...plan1, startAt: 'invalid' }, oneMinute), null);

console.log('PASS — VIP accrual is continuous in estimates, cent-safe in credits, bounded by maturity, and preserves legacy principal terms');
