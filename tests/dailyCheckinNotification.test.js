'use strict';

const assert = require('assert');
const {
  DEFAULT_HOUR_UTC,
  shouldRunNow,
  nextCheckinDay,
  notificationText,
  runDailyCheckinNotificationSweep
} = require('../utils/dailyCheckinNotification');

const now = new Date('2026-10-24T04:12:00.000Z');
const yesterday = new Date('2026-10-23T12:00:00.000Z');
const today = new Date('2026-10-24T01:00:00.000Z');

assert.strictEqual(DEFAULT_HOUR_UTC, 4);
assert.strictEqual(shouldRunNow(now, 4), true);
assert.strictEqual(shouldRunNow(new Date('2026-10-24T05:00:00Z'), 4), false);
assert.strictEqual(nextCheckinDay({ streak: 1, lastCheckIn: yesterday }, now), 2);
assert.strictEqual(nextCheckinDay({ streak: 6, lastCheckIn: yesterday }, now), 7);
assert.strictEqual(nextCheckinDay({ streak: 7, lastCheckIn: yesterday }, now), 1);
assert.strictEqual(nextCheckinDay({ streak: 3, lastCheckIn: today }, now), 3);
assert.strictEqual(nextCheckinDay({ streak: 20, lastCheckIn: null }, now), 1);
assert.strictEqual(notificationText(2), 'Today is your Day 2! Go to the daily check-in and claim your 7 points for free.');
assert.strictEqual(notificationText(7), 'Today is your Day 7! Go to the daily check-in and claim your 15 points for free.');

async function testSweep() {
  const users = [
    { _id: 'u1', telegramId: '101', streak: 1, lastCheckIn: yesterday, isBanned: false },
    { _id: 'u2', telegramId: '102', streak: 6, lastCheckIn: yesterday, isBanned: true },
    { _id: 'u3', telegramId: '103', streak: 20, lastCheckIn: null, telegramBlockedAt: now }
  ];
  const sentMessages = [];
  const sentUsers = new Set();
  let query;
  const User = {
    find(filter, projection) {
      query = { filter, projection };
      return { lean: async () => users };
    },
    async updateOne(filter) {
      const id = filter._id;
      if (sentUsers.has(id)) return { modifiedCount: 0 };
      sentUsers.add(id);
      return { modifiedCount: 1 };
    }
  };
  const notifyUser = async (telegramId, text) => {
    sentMessages.push({ telegramId, text });
    return telegramId !== '103'; // failed delivery must not stop attempts to the rest
  };

  const result = await runDailyCheckinNotificationSweep(now, { User, notifyUser, hourUtc: 4 });
  assert.deepStrictEqual(query.filter, {}, 'the sweep queries all registered users without audience filters');
  assert.match(query.projection, /telegramId/);
  assert.strictEqual(sentMessages.length, 3, 'every registered Telegram user is attempted, including banned/blocked records');
  assert.deepStrictEqual(sentMessages.map(message => message.text), [
    'Today is your Day 2! Go to the daily check-in and claim your 7 points for free.',
    'Today is your Day 7! Go to the daily check-in and claim your 15 points for free.',
    'Today is your Day 1! Go to the daily check-in and claim your 5 points for free.'
  ]);
  assert.deepStrictEqual(result, { sent: 2, failed: 1, alreadySent: 0, total: 3 });

  const repeated = await runDailyCheckinNotificationSweep(now, { User, notifyUser, hourUtc: 4 });
  assert.strictEqual(sentMessages.length, 3, 'the existing per-user reminder timestamp prevents same-day repeats');
  assert.strictEqual(repeated.alreadySent, 3);
  assert.strictEqual((await runDailyCheckinNotificationSweep(now, { User, notifyUser, hourUtc: 9 })).skipped, 'wrong_hour');
}

testSweep().then(() => {
  console.log('PASS — automated daily check-in notifications schedule, calculate personalized rewards, attempt all users, and de-duplicate daily sends');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
