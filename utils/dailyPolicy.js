'use strict';

const DAILY_POLICY_VERSION = 3;
const DAILY_POLICY_SETTINGS = Object.freeze({
  dailyAutoCheckinEnabled: true,
  dailyReminderEnabled: true,
  dailyReminderHourUtc: 2,
  dailyReminderMinuteUtc: 30,
  dailyReminderTimezone: 'Asia/Kabul',
  dailyReminderLocalHour: 7,
  dailyReminderLocalMinute: 0,
  dailyReminderAudience: 'all',
  dailyReminderPolicyVersion: DAILY_POLICY_VERSION
});

// Query the stored version, not a hydrated Mongoose default: old documents
// without a version must migrate, while a later admin opt-out stays intact.
async function applyDailyPolicyV3(Settings = require('../models/Settings')) {
  await Settings.getGlobal();
  return Settings.updateOne({
    key: 'global',
    $or: [
      { dailyReminderPolicyVersion: { $lt: DAILY_POLICY_VERSION } },
      { dailyReminderPolicyVersion: { $exists: false } }
    ]
  }, { $set: { ...DAILY_POLICY_SETTINGS } });
}

module.exports = { DAILY_POLICY_VERSION, DAILY_POLICY_SETTINGS, applyDailyPolicyV3 };
