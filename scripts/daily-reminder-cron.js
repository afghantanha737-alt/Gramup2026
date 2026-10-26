'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const { withDistributedJobLock } = require('../utils/distributedJobLock');
const { runDailyReminderSweep } = require('../utils/dailyReminder');

async function main() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is not configured.');
  if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN is not configured.');

  await mongoose.connect(process.env.MONGO_URI);
  const startedAt = new Date();
  try {
    const result = await withDistributedJobLock(
      'daily-reminder-sweep',
      () => runDailyReminderSweep(startedAt, { force: true })
    );
    console.log(JSON.stringify({
      event: 'daily_reminder_cron_completed',
      schedule: '0 4 * * *',
      timezone: 'UTC',
      localTime: '08:30 Asia/Kabul',
      ...result,
      at: new Date().toISOString()
    }));
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(error => {
  console.error(JSON.stringify({
    event: 'daily_reminder_cron_failed',
    schedule: '0 4 * * *',
    timezone: 'UTC',
    error: String(error?.message || error).slice(0, 500),
    at: new Date().toISOString()
  }));
  process.exitCode = 1;
});
