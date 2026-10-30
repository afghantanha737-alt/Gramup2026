'use strict';

// Both the in-app poller and the optional Render cron use this dispatcher and
// the same distributed lock. Reminder-only mode never runs beside auto-credit.
async function runDailySchedule(now = new Date(), dependencies = {}) {
  const Settings = dependencies.Settings || require('../models/Settings');
  const settings = await Settings.getGlobal();
  if (settings.dailyAutoCheckinEnabled === true) {
    const run = dependencies.runDailyAutoCheckinSweep
      || require('./dailyAutoCheckin').runDailyAutoCheckinSweep;
    try {
      const result = await run(now, { ...dependencies, Settings });
      if (!result.skipped) {
        await Settings.updateOne({ key: 'global' }, { $set: {
          dailyReminderLastRunAt: now,
          dailyReminderLastSentCount: Number(result.notificationsSent) || 0,
          dailyReminderLastFailedCount: Number(result.notificationsFailed) || 0,
          dailyAutoCheckinLastFailedCount: Number(result.failed) || 0,
          dailyAutoCheckinLastAlreadyClaimedCount: Number(result.alreadyClaimed) || 0,
          dailyAutoCheckinLastBannedCount: Number(result.banned) || 0,
          dailyReminderLastStatus: result.failed || result.notificationsFailed ? 'partial' : 'ok',
          dailyReminderLastError: (result.errors || []).join('; ').slice(0, 300),
          dailyAutoCheckinLastCreditedCount: Number(result.credited) || 0,
          dailyAutoCheckinLastCreditedPoints: Number(result.pointsCredited) || 0
        } });
      }
      return result;
    } catch (error) {
      await Settings.updateOne({ key: 'global' }, { $set: {
        dailyReminderLastRunAt: now,
        dailyReminderLastStatus: 'error',
        dailyReminderLastError: String(error.message || error).slice(0, 300)
      } });
      throw error;
    }
  }
  const { runDailyReminderSweep, isCatchUpDue } = require('./dailyReminder');
  const run = dependencies.runDailyReminderSweep || runDailyReminderSweep;
  return run(now, { ...dependencies, Settings, force: isCatchUpDue(settings, now) });
}

module.exports = { runDailySchedule };
