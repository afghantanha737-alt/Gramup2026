'use strict';

const { cycleDayForStreak, DAILY_CHECKIN_REWARDS } = require('./dailyCheckin');

const DEFAULT_HOUR_UTC = 8;
const BATCH_SIZE = 20;
const BATCH_DELAY_MS = 1100;
const DAY_MS = 24 * 60 * 60 * 1000;

function configuredHourUtc() {
  const rawValue = String(process.env.DAILY_CHECKIN_NOTIFICATION_HOUR_UTC || '').trim();
  if (!rawValue) return DEFAULT_HOUR_UTC;
  const value = Number(rawValue);
  return Number.isInteger(value) && value >= 0 && value <= 23 ? value : DEFAULT_HOUR_UTC;
}

function shouldRunNow(now = new Date(), hourUtc = configuredHourUtc()) {
  return now.getUTCHours() === hourUtc;
}

function utcDayStart(date) {
  return new Date(Math.floor(date.getTime() / DAY_MS) * DAY_MS);
}

function nextCheckinDay(user, now = new Date()) {
  const todayStart = utcDayStart(now).getTime();
  const lastCheckIn = user?.lastCheckIn ? new Date(user.lastCheckIn).getTime() : NaN;
  const lastCheckInDay = Number.isFinite(lastCheckIn) ? utcDayStart(new Date(lastCheckIn)).getTime() : null;
  const completedStreak = Math.max(0, Math.floor(Number(user?.streak) || 0));

  if (lastCheckInDay === todayStart) return cycleDayForStreak(completedStreak) || 1;
  if (lastCheckInDay === todayStart - DAY_MS && completedStreak > 0) {
    return cycleDayForStreak(completedStreak + 1);
  }
  return 1;
}

function notificationText(day) {
  const safeDay = Number.isInteger(day) && day >= 1 && day <= DAILY_CHECKIN_REWARDS.length ? day : 1;
  const points = DAILY_CHECKIN_REWARDS[safeDay - 1];
  return `Today is your Day ${safeDay}! Go to the daily check-in and claim your ${points} points for free.`;
}

async function runDailyCheckinNotificationSweep(now = new Date(), dependencies = {}) {
  if (!shouldRunNow(now, dependencies.hourUtc ?? configuredHourUtc())) {
    return { sent: 0, failed: 0, skipped: 'wrong_hour' };
  }

  const User = dependencies.User || require('../models/User');
  const notifyUser = dependencies.notifyUser || require('./bot').notifyUser;
  const users = await User.find({}, '_id telegramId streak lastCheckIn lastReminderSentAt').lean();
  const todayStart = utcDayStart(now);
  let sent = 0;
  let failed = 0;
  let alreadySent = 0;

  for (let offset = 0; offset < users.length; offset += BATCH_SIZE) {
    const batch = users.slice(offset, offset + BATCH_SIZE);
    const outcomes = await Promise.all(batch.map(async user => {
      // Claim the existing per-user daily reminder marker atomically so parallel
      // app instances (and the legacy reminder sweep) do not send duplicates.
      const claim = await User.updateOne({
        _id: user._id,
        $or: [
          { lastReminderSentAt: null },
          { lastReminderSentAt: { $exists: false } },
          { lastReminderSentAt: { $lt: todayStart } }
        ]
      }, { $set: { lastReminderSentAt: now } });

      if (!claim.modifiedCount) return 'already_sent';
      const day = nextCheckinDay(user, now);
      const delivered = await notifyUser(user.telegramId, notificationText(day));
      return delivered ? 'sent' : 'failed';
    }));

    for (const outcome of outcomes) {
      if (outcome === 'sent') sent += 1;
      else if (outcome === 'failed') failed += 1;
      else alreadySent += 1;
    }
    if (offset + BATCH_SIZE < users.length) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  return { sent, failed, alreadySent, total: users.length };
}

module.exports = {
  DEFAULT_HOUR_UTC,
  configuredHourUtc,
  shouldRunNow,
  utcDayStart,
  nextCheckinDay,
  notificationText,
  runDailyCheckinNotificationSweep
};
