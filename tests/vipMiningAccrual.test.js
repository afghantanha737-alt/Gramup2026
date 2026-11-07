'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  calculateVipSubscriptionAccrual,
  calculateVipMiningStatus,
  getVipMiningDailyRateCents,
  MICRO_UNITS_PER_POINT
} = require('../utils/vipMining');
const { newVipPolicyForPlan } = require('../utils/vipPolicy');
const root = path.join(__dirname, '..');
const miningRoute = fs.readFileSync(path.join(root, 'routes/mining.js'), 'utf8');
const pointsRoute = fs.readFileSync(path.join(root, 'routes/points.js'), 'utf8');
const subscriptionModel = fs.readFileSync(path.join(root, 'models/VipSubscription.js'), 'utf8');

function subscription(planNumber, pricePoints, startAt, endAt, status = 'active') {
  const policy = newVipPolicyForPlan(planNumber);
  return {
    _id: `vip-${planNumber}-${startAt.getTime()}`,
    planNumber,
    pricePoints,
    principalDailyBps: policy.principalDailyBps,
    rewardDailyBps: policy.rewardDailyBps,
    dailyRewardAveragePoints: 0,
    durationDays: policy.durationDays,
    startAt,
    endAt,
    status,
    vipMiningLastClaimAt: null,
    vipMiningRemainder: 0
  };
}

const start = new Date('2026-11-01T00:00:00.000Z');
const end = new Date(start.getTime() + 100 * 86400 * 1000);
const vip1 = subscription(1, 10000, start, end);
assert.equal(getVipMiningDailyRateCents(vip1), 11000);
assert.equal(calculateVipSubscriptionAccrual(vip1, new Date(start.getTime() + 86400 * 1000)).earnedMicros, 110 * MICRO_UNITS_PER_POINT,
  'VIP 1 accrues exactly 110 UP in one elapsed day');

const vip4 = subscription(4, 100000, start, end);
assert.equal(getVipMiningDailyRateCents(vip4) / 100, 1150, 'higher VIP tiers use their stored principal-plus-reward daily terms');
const nowOneDay = new Date(start.getTime() + 86400 * 1000);
const legacyStringDates = { ...vip1, startAt: start.toISOString(), endAt: end.toISOString() };
const stringDateStatus = calculateVipMiningStatus([legacyStringDates], nowOneDay);
assert.equal(stringDateStatus.activeMinerCount, 1, 'parseable legacy BSON string timestamps remain eligible for mining');
assert.equal(stringDateStatus.accruedPoints, 110, 'string timestamps preserve the full elapsed-period accrual');
const newlyPurchased = subscription(1, 10000, nowOneDay, new Date(nowOneDay.getTime() + 100 * 86400 * 1000));
const stacked = calculateVipMiningStatus([vip1, vip4, newlyPurchased], nowOneDay);
assert.equal(stacked.activeMinerCount, 3, 'every unexpired purchased subscription counts as an active miner');
assert.equal(stacked.dailyRate, 1370, 'daily mining rates stack immediately across all active packages');
assert.equal(stacked.accruedPoints, 1260, 'the old miners accrue for a day but the just-purchased miner does not accrue retroactively');
assert.equal(stacked.perSecondRate, 1370 / 86400);
const vip1Status = stacked.activeMiners.find(miner => miner.id === vip1._id);
const newVip1Status = stacked.activeMiners.find(miner => miner.id === newlyPurchased._id);
assert.equal(vip1Status.dailyRate, 110, 'each miner exposes its own daily UP income');
assert.equal(vip1Status.daysRemaining, 99, 'remaining days are calculated from that subscription end time');
assert.equal(vip1Status.remainingPercent, 99, 'remaining percentage is based on the contract duration');
assert.equal(newVip1Status.daysRemaining, 100, 'a newly purchased miner starts at its full duration');
assert.equal(newVip1Status.remainingPercent, 100, 'a newly purchased miner starts at 100% remaining');

const elevenMiners = Array.from({ length: 11 }, (_, index) =>
  subscription((index % 10) + 1, 10000, start, end));
const elevenMinerStatus = calculateVipMiningStatus(elevenMiners, nowOneDay);
assert.equal(elevenMinerStatus.activeMinerCount, 11, 'all eleven active purchased miners remain eligible');
assert.equal(elevenMinerStatus.activeMiners.length, 11, 'the status response retains every active miner without a display cap');
assert.equal(elevenMinerStatus.dailyRate,
  elevenMiners.reduce((sum, miner) => sum + getVipMiningDailyRateCents(miner) / 100, 0),
  'all eleven miners contribute to the combined mining rate');

const oneSecondAt = new Date(start.getTime() + 1000);
const firstFragment = calculateVipSubscriptionAccrual(vip1, oneSecondAt);
assert.equal(firstFragment.earnedMicros, 1273);
const afterOneSecond = {
  ...vip1,
  vipMiningLastClaimAt: oneSecondAt,
  vipMiningPaidMicros: firstFragment.earnedMicros
};
const remainingDay = calculateVipSubscriptionAccrual(afterOneSecond, new Date(start.getTime() + 86400 * 1000));
assert.equal(firstFragment.earnedMicros + remainingDay.earnedMicros, 110 * MICRO_UNITS_PER_POINT,
  'fractional carry prevents loss across an early claim');
assert.equal(firstFragment.remainder, 0, 'cumulative paid-micro accounting preserves fractional claims without rounding loss');

const expiredAt = new Date(start.getTime() + 86400 * 1000);
const expired = subscription(1, 10000, start, expiredAt, 'completed');
const expiredStatus = calculateVipMiningStatus([expired], expiredAt);
assert.equal(expiredStatus.activeMinerCount, 0, 'completed subscriptions stop mining at endAt');
assert.equal(expiredStatus.pendingCompletedPoints, 110, 'unclaimed accrual up to expiry remains claimable');
assert.equal(expiredStatus.accruedPoints, 110);

const previouslyClaimed = {
  _id: 'legacy-migrated',
  planNumber: 1,
  pricePoints: 10000,
  principalDailyBps: 0,
  rewardDailyBps: 0,
  dailyRewardAveragePoints: 33.3333,
  durationDays: 30,
  startAt: start,
  endAt: new Date(start.getTime() + 30 * 86400 * 1000),
  status: 'active',
  policyVersion: 'legacy_v1',
  totalRewardCents: 100000,
  totalRewardPoints: 1000,
  claimedRewardPoints: 33.33,
  lastClaimAt: new Date(start.getTime() + 86400 * 1000)
};
const migrated = calculateVipMiningStatus([previouslyClaimed], new Date(start.getTime() + 2 * 86400 * 1000));
assert.equal(migrated.accruedPoints, 33.336666, 'migration offsets prior scheduled payouts without replaying them and preserves the fractional contract rate');

const reserveBacked = {
  ...vip1,
  policyVersion: 'v2_100d',
  reserveLiabilityCents: 1100000,
  reservePaidCents: 1099999,
  vipMiningReserveRemainderMicros: 0
};
const reserveCapped = calculateVipSubscriptionAccrual(reserveBacked, end);
assert.equal(reserveCapped.earnedMicros, 10000, 'mining cannot accrue more than the final unpaid reserve cent');
const paidOut = {
  ...reserveBacked,
  status: 'completed',
  reservePaidCents: 1100000
};
const fullyPaidStatus = calculateVipMiningStatus([paidOut], new Date(start.getTime() + 2 * 86400 * 1000));
assert.equal(fullyPaidStatus.activeMinerCount, 0);
assert.equal(fullyPaidStatus.accruedPoints, 0, 'fully paid subscriptions cannot pay the same liability again');

const vip10 = subscription(10, 1000000, start, end);
const highTier = calculateVipSubscriptionAccrual(vip10, end);
assert.equal(highTier.dailyRate, 12000);
assert.equal(highTier.earnedMicros, 12000 * 100 * MICRO_UNITS_PER_POINT);
assert.ok(Number.isSafeInteger(highTier.earnedMicros), 'high-tier 100-day accrual stays within exact JS integer range');

const noMiners = calculateVipMiningStatus([], nowOneDay);
assert.equal(noMiners.activeMinerCount, 0);
assert.equal(noMiners.dailyRate, 0);
assert.equal(noMiners.perSecondRate, 0);
assert.equal(noMiners.accruedPoints, 0, 'no subscriptions means no free mining');

assert.match(miningRoute, /router\.post\('\/start'[\s\S]*VIP_MINING_PURCHASE_REQUIRED/);
assert.match(miningRoute, /router\.post\('\/claim'[\s\S]*calculateVipMiningStatus/);
assert.doesNotMatch(miningRoute, /startAt:\s*\{\s*\$lte:\s*now\s*\}/, 'Mongo date comparisons must not omit parseable legacy string timestamps');
assert.match(miningRoute, /VIP_MINING_PACKAGES_ONLY/);
assert.match(miningRoute, /VIP_RESERVE_EXCEEDED/);
assert.match(pointsRoute, /miningDailyRate/);
assert.match(subscriptionModel, /vipMiningLastClaimAt/);
assert.match(subscriptionModel, /vipMiningRemainder/);
assert.match(subscriptionModel, /vipMiningPaidMicros/);
assert.match(subscriptionModel, /vipMiningReserveRemainderMicros/);
console.log('PASS — VIP rates, stacking, elapsed-second accrual, fractional carry, expiry settlement, and zero-free-mining checks');
