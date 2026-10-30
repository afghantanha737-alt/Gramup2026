'use strict';

// Both the in-app poller and the optional Render cron use this dispatcher.
// Scheduled work may remind users, but may never claim a daily reward for them.
async function runDailySchedule(now = new Date(), dependencies = {}) {
  const Settings = dependencies.Settings || require('../models/Settings');
  const settings = await Settings.getGlobal();
  const { runDailyReminderSweep, isCatchUpDue } = require('./dailyReminder');
  const run = dependencies.runDailyReminderSweep || runDailyReminderSweep;
  return run(now, { ...dependencies, Settings, force: isCatchUpDue(settings, now) });
}

module.exports = { runDailySchedule };
