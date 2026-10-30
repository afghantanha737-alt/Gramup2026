'use strict';
const assert = require('assert');
const fs = require('fs');
const { runDailySchedule } = require('../utils/dailySchedule');
const { applyDailyPolicyV3, DAILY_POLICY_SETTINGS } = require('../utils/dailyPolicy');
const { targetUtcTime } = require('../utils/timezones');
const { kabulReminderTarget, reminderMessageFor } = require('../utils/dailyReminder');
const SettingsModel = require('../models/Settings');
const NotificationDelivery = require('../models/NotificationDelivery');

(async () => {
  const now = new Date('2026-10-30T02:30:00Z');
  assert.deepStrictEqual(targetUtcTime(7, 0, 'Asia/Kabul', now), { hour: 2, minute: 30 });
  assert.deepStrictEqual(targetUtcTime(8, 15, 'Asia/Kabul', now), { hour: 3, minute: 45 });
  assert.deepStrictEqual(targetUtcTime(0, 0, 'UTC', now), { hour: 0, minute: 0 });
  assert.strictEqual(kabulReminderTarget(now).toISOString(), now.toISOString());
  assert.match(reminderMessageFor({}, 'en', 2, new Date('2026-10-29T01:00Z'), now), /9/);
  assert.match(reminderMessageFor({}, 'en', 2, new Date('2026-10-30T01:00Z'), now), /7/);
  assert.strictEqual(SettingsModel.schema.path('dailyAutoCheckinEnabled').defaultValue, true);
  assert.ok(NotificationDelivery.schema.path('type').enumValues.includes('daily_checkin'));
  assert.ok(NotificationDelivery.schema.path('text'));

  let savedVersion = 2, autoEnabled = false, policyWrites = 0;
  const PolicySettings = {
    getGlobal: async () => ({}),
    updateOne: async (filter, update) => {
      assert.strictEqual(filter.key, 'global');
      if (savedVersion >= filter.$or[0].dailyReminderPolicyVersion.$lt) return { modifiedCount: 0 };
      savedVersion = update.$set.dailyReminderPolicyVersion;
      autoEnabled = update.$set.dailyAutoCheckinEnabled;
      policyWrites += 1;
      return { modifiedCount: 1 };
    }
  };
  await applyDailyPolicyV3(PolicySettings);
  assert.strictEqual(policyWrites, 1);
  assert.strictEqual(autoEnabled, true);
  autoEnabled = false; // An administrator subsequently turns automatic credits off.
  await applyDailyPolicyV3(PolicySettings);
  assert.strictEqual(autoEnabled, false, 'startup must preserve an administrator opt-out');
  assert.strictEqual(policyWrites, 1);
  assert.strictEqual(DAILY_POLICY_SETTINGS.dailyReminderHourUtc, 2);
  assert.strictEqual(DAILY_POLICY_SETTINGS.dailyReminderMinuteUtc, 30);

  const updates = [];
  let autoCalls = 0, reminderCalls = 0;
  const Settings = {
    getGlobal: async () => ({ dailyAutoCheckinEnabled: true, dailyReminderEnabled: true }),
    updateOne: async (filter, update) => { updates.push({ filter, update }); }
  };
  const dependencies = {
    Settings,
    runDailyAutoCheckinSweep: async () => {
      autoCalls += 1;
      return { credited: 2, pointsCredited: 12, notificationsSent: 2, notificationsFailed: 0, failed: 0, errors: [] };
    },
    runDailyReminderSweep: async () => { reminderCalls += 1; return { sent: 1 }; }
  };
  await runDailySchedule(now, dependencies);
  assert.strictEqual(autoCalls, 1);
  assert.strictEqual(reminderCalls, 0, 'auto and reminder-only must never run together');
  assert.strictEqual(updates[0].update.$set.dailyAutoCheckinLastCreditedPoints, 12);
  Settings.getGlobal = async () => ({ dailyAutoCheckinEnabled: false, dailyReminderEnabled: true });
  await runDailySchedule(now, dependencies);
  assert.strictEqual(reminderCalls, 1);
  assert.strictEqual(autoCalls, 1);
  Settings.getGlobal = async () => ({ dailyAutoCheckinEnabled: true });
  await assert.rejects(runDailySchedule(now, { ...dependencies,
    runDailyAutoCheckinSweep: async () => { throw new Error('simulated failure'); }
  }), /simulated failure/);
  assert.strictEqual(updates.at(-1).update.$set.dailyReminderLastStatus, 'error');

  const server = fs.readFileSync('server.js', 'utf8');
  const cron = fs.readFileSync('scripts/daily-reminder-cron.js', 'utf8');
  const route = fs.readFileSync('routes/points.js', 'utf8');
  assert.match(server, /runDailySchedule\(new Date\(\)\)/);
  assert.match(server, /runReferralNotificationRetrySweep/);
  assert.match(cron, /30 2 \* \* \*/);
  assert.match(cron, /verifyMongoTransactionCapability/);
  assert.match(route, /claimDailyCheckin\(req\.dbUser\._id/);
  console.log('PASS — schedule dispatcher, 07:00 Kabul minute precision, one-time policy, admin opt-out, schema and shared claim integration (offline)');
})().catch(error => { console.error(error); process.exitCode = 1; });
