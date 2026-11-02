'use strict';

const assert = require('assert');
const {
  claimReadiness,
  vipRewardNotificationText,
  runVipRewardNotificationSweep
} = require('../utils/vipRewardNotification');

const now = new Date('2026-10-24T08:00:00.000Z');
const day = 24 * 60 * 60 * 1000;
const readySub = {
  _id: 'sub-1', user: 'user-1', planNumber: 3, status: 'active',
  policyVersion: 'legacy_v1', pricePoints: 1000,
  startAt: new Date(now.getTime() - day), endAt: new Date(now.getTime() + day * 29),
  lastClaimAt: new Date(now.getTime() - day), claimsCompleted: 1, durationDays: 30,
  totalRewardCents: 21000, claimedRewardPoints: 0, principalPaidPoints: 0, principalReturnedAt: null
};

assert.deepStrictEqual(claimReadiness(readySub, now), {
  claimNumber: 2,
  rewardPoints: 7,
  principalPoints: 0,
  totalPayoutPoints: 7,
  nextClaimAt: null
});
assert.ok(claimReadiness({ ...readySub, lastClaimAt: new Date(now.getTime() - 12 * 60 * 60 * 1000) }, now),
  'partial mining claims are ready before a full day has elapsed');
assert.strictEqual(claimReadiness({ ...readySub, status: 'completed' }, now), null);
assert.ok(claimReadiness({ ...readySub, claimsCompleted: 30 }, now), 'claim operations no longer stop at the number of contract days');
assert.strictEqual(vipRewardNotificationText(readySub, 7),
  'Your unclaimed mining balance for VIP Plan 3 is 7 Points. Claim it to your wallet any time from the VIP dashboard.');

async function testSweep() {
  const subscriptions = [
    readySub,
    { ...readySub, _id: 'sub-not-ready', startAt: new Date(now.getTime() - 1000), endAt: new Date(now.getTime() + day * 30) },
    { ...readySub, _id: 'sub-complete', status: 'completed', claimsCompleted: 30 }
  ];
  const user = { _id: 'user-1', telegramId: '123456' };
  const deliveryKeys = new Set();
  const sent = [];
  const VipSubscription = {
    find() { return { lean: async () => subscriptions }; }
  };
  const User = {
    find() { return { lean: async () => [user] }; }
  };
  const DistributedJobLock = {
    async create(record) {
      if (deliveryKeys.has(record._id)) {
        const error = new Error('duplicate');
        error.code = 11000;
        throw error;
      }
      deliveryKeys.add(record._id);
    }
  };
  const notifyUser = async (telegramId, text) => {
    sent.push({ telegramId, text });
    return true;
  };
  const deps = { VipSubscription, User, DistributedJobLock, notifyUser };

  const first = await runVipRewardNotificationSweep(now, deps);
  assert.strictEqual(first.sent, 1);
  assert.strictEqual(first.totalReady, 1, 'only subscriptions with at least 0.01 unclaimed Points are notified');
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].telegramId, user.telegramId);
  assert.match(sent[0].text, /VIP Plan 3 is 7 Points/);

  const repeated = await runVipRewardNotificationSweep(now, deps);
  assert.strictEqual(repeated.duplicate, 1);
  assert.strictEqual(sent.length, 1, 'same miner receives at most one reminder per UTC day');

  const nextDay = new Date(now.getTime() + day);
  const nextDayResult = await runVipRewardNotificationSweep(nextDay, deps);
  assert.strictEqual(nextDayResult.sent, 2, 'unclaimed balances may be reminded again on a later day');
  assert.strictEqual(sent.length, 3);
}

testSweep().then(() => {
  console.log('PASS — VIP reminders target continuously accrued balances and deduplicate per subscription/day');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
