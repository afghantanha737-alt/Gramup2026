'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  MINING_CYCLE_SECONDS,
  MINING_CYCLE_DAILY_FRACTION,
  MICRO_UNITS_PER_POINT,
  calculateVipMiningCycleStatus,
  calculateVipSubscriptionCycleAccrual
} = require('../utils/vipMining');
const route = fs.readFileSync('routes/mining.js', 'utf8');
const user = fs.readFileSync('models/User.js', 'utf8');
const server = fs.readFileSync('server.js', 'utf8');
const start = new Date('2026-11-12T00:00:00.000Z');
const end = new Date(start.getTime() + MINING_CYCLE_SECONDS * 1000);
const subscription = {
  _id: 'miner-1', planNumber: 1, pricePoints: 10000,
  principalDailyBps: 100, rewardDailyBps: 10,
  durationDays: 100, startAt: new Date(start.getTime() - 86400000),
  endAt: new Date(start.getTime() + 99 * 86400000), status: 'active',
  totalRewardPoints: 11000, totalRewardCents: 1100000,
  vipMiningPaidMicros: 0, reserveLiabilityCents: 1100000, reservePaidCents: 0
};
const half = calculateVipSubscriptionCycleAccrual(subscription, start, end, new Date(start.getTime() + 3 * 3600000));
assert.equal(half.earnedMicros / MICRO_UNITS_PER_POINT, 13.75, 'three hours pays half of the 25% daily cycle amount');
const complete = calculateVipMiningCycleStatus([subscription], start, end, end);
assert.equal(complete.status, 'ready');
assert.equal(complete.accruedPoints, 27.5, 'a complete cycle pays exactly 25% of the daily rate');
assert.equal(complete.remainingSeconds, 0);
assert.equal(complete.cycleProgressPercent, 100);
assert.equal(MINING_CYCLE_DAILY_FRACTION, 0.25);
assert.match(route, /router\.post\('\/start'/);
assert.match(route, /MINING_CYCLE_SECONDS/);
assert.match(route, /vipMiningCycleStartedAt/);
assert.match(route, /vipMiningCycleEndsAt/);
assert.match(route, /findOneAndUpdate\([\s\S]*vipMiningCycleStartedAt: cycleStartedAt/);
assert.match(user, /vipMiningCycleStartedAt:/);
assert.match(user, /vipMiningCycleEndsAt:/);
assert.match(server, /vip-mining-cycle-notification/);
console.log('PASS — six-hour cycle timing, 25% daily payout, atomic restart, persistence, and notification wiring');
