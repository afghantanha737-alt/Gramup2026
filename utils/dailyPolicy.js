'use strict';

const DAILY_POLICY_VERSION = 4;
const DAILY_POLICY_SETTINGS = Object.freeze({
  dailyAutoCheckinEnabled: false,
  dailyReminderPolicyVersion: DAILY_POLICY_VERSION
});

// Disable the former v3 credit flag on both existing and new installations.
// Do not touch reminder preferences, user balances, streaks or historical ledgers.
async function applyDailyManualPolicy(Settings = require('../models/Settings')) {
  await Settings.getGlobal();
  return Settings.updateOne({
    key: 'global',
    $or: [
      { dailyAutoCheckinEnabled: true },
      { dailyAutoCheckinEnabled: { $exists: false } },
      { dailyReminderPolicyVersion: { $lt: DAILY_POLICY_VERSION } },
      { dailyReminderPolicyVersion: { $exists: false } }
    ]
  }, { $set: { ...DAILY_POLICY_SETTINGS } });
}

module.exports = {
  DAILY_POLICY_VERSION, DAILY_POLICY_SETTINGS, applyDailyManualPolicy,
  // Compatibility for an old script import; it can no longer enable credits.
  applyDailyPolicyV3: applyDailyManualPolicy
};
