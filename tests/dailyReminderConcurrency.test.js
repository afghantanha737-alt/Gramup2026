'use strict';

const assert = require('assert');
const { runDailyReminderSweep } = require('../utils/dailyReminder');
const { runDailyCheckinNotificationSweep } = require('../utils/dailyCheckinNotification');

async function main() {
  const now = new Date('2026-10-26T08:10:00.000Z');
  const todayStart = new Date('2026-10-26T00:00:00.000Z');
  const user = {
    _id: 'user-1',
    telegramId: '123456',
    language: 'en',
    streak: 3,
    lastCheckIn: new Date('2026-10-25T08:00:00.000Z'),
    lastReminderSentAt: null,
    isBanned: false,
    telegramBlockedAt: null
  };
  let sends = 0;
  const User = {
    find() {
      return { lean: async () => [{ ...user }] };
    },
    async updateOne(filter, update) {
      const dueBeforeToday = !user.lastReminderSentAt || new Date(user.lastReminderSentAt) < todayStart;
      if (String(filter._id) !== String(user._id) || filter.isBanned !== false || filter.telegramBlockedAt !== null || !dueBeforeToday) {
        return { modifiedCount: 0 };
      }
      user.lastReminderSentAt = update.$set.lastReminderSentAt;
      return { modifiedCount: 1 };
    }
  };
  const Settings = {
    getGlobal: async () => ({ dailyReminderEnabled: true, dailyReminderHourUtc: 8, dailyReminderMessage: '', dailyReminderAudience: 'all' }),
    updateOne: async () => ({ modifiedCount: 1 })
  };
  const notifyUser = async () => { sends += 1; return true; };

  await Promise.all([
    runDailyReminderSweep(now, { User, Settings, notifyUser }),
    runDailyCheckinNotificationSweep(now, { User, Settings, notifyUser, hourUtc: 8 })
  ]);

  assert.strictEqual(sends, 1, 'competing daily sweeps must not overwrite one another\'s marker or send twice');
  assert.strictEqual(user.lastReminderSentAt.getTime(), now.getTime());
  console.log('PASS — daily reminder and check-in notifications share an atomic per-user/day claim');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
