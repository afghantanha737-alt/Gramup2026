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
  startAt: new Date(now.getTime() - day * 2), endAt: new Date(now.getTime() + day * 28),
  lastClaimAt: new Date(now.getTime() - day), claimsCompleted: 1, durationDays: 30,
  totalRewardCents: 21000
};

assert.deepStrictEqual(claimReadiness(readySub, now), {
  claimNumber: 2,
  rewardPoints: 7,
  nextClaimAt: now
});
assert.strictEqual(claimReadiness({ ...readySub, lastClaimAt: new Date(now.getTime() - 12 * 60 * 60 * 1000) }, now), null,
  'reward is not ready until 24 hours after the preceding claim');
assert.strictEqual(claimReadiness({ ...readySub, status: 'completed' }, now), null);
assert.strictEqual(claimReadiness({ ...readySub, claimsCompleted: 30 }, now), null);
assert.strictEqual(vipRewardNotificationText(readySub, 7),
  'Your VIP reward for VIP Plan 3 (7 Points) is ready to claim! Head over to your VIP dashboard and claim your reward.');

async function testSweep() {
  const subscriptions = [
    readySub,
    { ...readySub, _id: 'sub-not-ready', lastClaimAt: new Date(now.getTime() - 1000) },
    { ...readySub, _id: 'sub-complete', claimsCompleted: 30 }
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
  assert.strictEqual(first.totalReady, 1, 'only the currently claimable subscription is notified');
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].telegramId, user.telegramId);
  assert.match(sent[0].text, /VIP Plan 3 \(7 Points\)/);

  const repeated = await runVipRewardNotificationSweep(now, deps);
  assert.strictEqual(repeated.duplicate, 1);
  assert.strictEqual(sent.length, 1, 'same plan claim receives at most one reminder per UTC day');

  const nextDay = new Date(now.getTime() + day);
  const nextDayResult = await runVipRewardNotificationSweep(nextDay, deps);
  assert.strictEqual(nextDayResult.sent, 2, 'unclaimed rewards may be reminded again on a later day and newly-ready plans are included');
  assert.strictEqual(sent.length, 3);
}

testSweep().then(() => {
  console.log('PASS — VIP reminders only target ready claims, use server reward math, and deduplicate per subscription/day');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
