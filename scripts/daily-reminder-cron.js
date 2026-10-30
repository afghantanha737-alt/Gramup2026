'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const { withDistributedJobLock } = require('../utils/distributedJobLock');
const { runDailySchedule } = require('../utils/dailySchedule');
const { verifyMongoTransactionCapability } = require('../utils/mongoTransaction');

async function main() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is not configured.');
  if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN is not configured.');

  await mongoose.connect(process.env.MONGO_URI);
  const startedAt = new Date();
  try {
    const capability = await verifyMongoTransactionCapability();
    if (!capability.supported) throw new Error('Daily auto credit requires MongoDB transactions.');
    for (const name of ['User', 'Settings', 'PointsLedger', 'NotificationDelivery', 'DistributedJobLock']) {
      await require(`../models/${name}`).init();
    }
    await require('../utils/dailyPolicy').applyDailyPolicyV3();
    const result = await withDistributedJobLock(
      'daily-reminder-sweep',
      () => runDailySchedule(startedAt)
    );
    const receiptRetry = await withDistributedJobLock('daily-receipt-retry',
      () => require('../utils/dailyReceiptRetry').runDailyReceiptRetrySweep());
    console.log(JSON.stringify({
      event: 'daily_reminder_cron_completed',
      schedule: '30 2 * * *',
      timezone: 'UTC',
      localTime: '07:00 Asia/Kabul',
      ...result,
      receiptRetry,
      at: new Date().toISOString()
    }));
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(error => {
  console.error(JSON.stringify({
    event: 'daily_reminder_cron_failed',
    schedule: '30 2 * * *',
    timezone: 'UTC',
    error: String(error?.message || error).slice(0, 500),
    at: new Date().toISOString()
  }));
  process.exitCode = 1;
});
