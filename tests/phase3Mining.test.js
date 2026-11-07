'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
process.env.BOT_TOKEN = 'phase3-test-token';
const { calculateVipMiningStatus } = require('../utils/vipMining');
const source = fs.readFileSync(require.resolve('../routes/mining'), 'utf8');

const startAt = new Date('2026-11-05T00:00:00.000Z');
const endAt = new Date(startAt.getTime() + 100 * 86400 * 1000);
const miners = [
  { _id: 'vip-1', user: 'u1', planNumber: 1, pricePoints: 10000, principalDailyBps: 100, rewardDailyBps: 10,
    durationDays: 100, startAt, endAt, status: 'active', reserveLiabilityCents: 1100000, reservePaidCents: 0 },
  { _id: 'vip-4', user: 'u1', planNumber: 4, pricePoints: 100000, principalDailyBps: 100, rewardDailyBps: 15,
    durationDays: 100, startAt, endAt, status: 'active', reserveLiabilityCents: 11500000, reservePaidCents: 0 }
];
const status = calculateVipMiningStatus(miners, new Date(startAt.getTime() + 3600 * 1000));
assert.equal(status.activeMinerCount, 2);
assert.equal(status.dailyRate, 1260);
assert.ok(Math.abs(status.accruedPoints - 52.5) <= 0.000001);
assert.equal(status.perSecondRate, 1260 / 86400);
const none = calculateVipMiningStatus([], new Date(startAt.getTime() + 3600 * 1000));
assert.equal(none.activeMinerCount, 0);
assert.equal(none.accruedPoints, 0, 'no purchased VIP miner means no free mining');
assert.match(source, /VIP_MINING_PURCHASE_REQUIRED/);
assert.match(source, /VIP_MINING_PACKAGES_ONLY/);
assert.match(source, /type: 'mining_claim'/);
assert.doesNotMatch(source, /type: 'mining_upgrade'/);
console.log('PASS — VIP miner package rates stack in real time; no free rig mining or upgrade payouts remain');
