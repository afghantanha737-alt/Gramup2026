'use strict';
const assert = require('assert');
const fs = require('fs');
const { runDailySchedule } = require('../utils/dailySchedule');
const { applyDailyManualPolicy, applyDailyPolicyV3, DAILY_POLICY_SETTINGS } = require('../utils/dailyPolicy');
const { targetUtcTime } = require('../utils/timezones');
const { kabulReminderTarget, reminderMessageFor } = require('../utils/dailyReminder');
const SettingsModel = require('../models/Settings');
const NotificationDelivery = require('../models/NotificationDelivery');

(async () => {
  const now = new Date('2026-10-30T02:30:00Z');
  assert.deepStrictEqual(targetUtcTime(7, 0, 'Asia/Kabul', now), { hour: 2, minute: 30 });
  assert.deepStrictEqual(targetUtcTime(8, 15, 'Asia/Kabul', now), { hour: 3, minute: 45 });
  assert.strictEqual(kabulReminderTarget(now).toISOString(), now.toISOString());
  assert.match(reminderMessageFor({}, 'en', 2, new Date('2026-10-29T01:00Z'), now), /9/);
  assert.match(reminderMessageFor({}, 'en', 2, new Date('2026-10-30T01:00Z'), now), /7/);
  assert.strictEqual(SettingsModel.schema.path('dailyAutoCheckinEnabled').defaultValue, false);
  assert.strictEqual(SettingsModel.schema.path('dailyReminderPolicyVersion').defaultValue, 4);
  assert.ok(NotificationDelivery.schema.path('type').enumValues.includes('daily_checkin'));

  let stored = { dailyReminderPolicyVersion: 3, dailyAutoCheckinEnabled: true,
    dailyReminderEnabled: false, dailyReminderHourUtc: 2, dailyReminderMinuteUtc: 30,
    dailyReminderMessage: 'custom reminder', dailyReminderAudience: 'active' };
  let policyWrites = 0;
  const PolicySettings = {
    getGlobal: async () => ({}),
    updateOne: async (filter, update) => {
      assert.strictEqual(filter.key, 'global');
      assert.deepStrictEqual(Object.keys(update.$set).sort(), ['dailyAutoCheckinEnabled', 'dailyReminderPolicyVersion']);
      if (stored.dailyReminderPolicyVersion >= 4 && stored.dailyAutoCheckinEnabled === false) return { modifiedCount: 0 };
      Object.assign(stored, update.$set); policyWrites += 1;
      return { modifiedCount: 1 };
    }
  };
  const before = { ...stored };
  await applyDailyManualPolicy(PolicySettings);
  assert.strictEqual(stored.dailyAutoCheckinEnabled, false);
  assert.strictEqual(stored.dailyReminderPolicyVersion, 4);
  for (const key of Object.keys(before).filter(key => !key.startsWith('dailyAuto') && key !== 'dailyReminderPolicyVersion')) {
    assert.strictEqual(stored[key], before[key], 'migration must preserve reminder preference: ' + key);
  }
  await applyDailyPolicyV3(PolicySettings); // An older import must not restore auto credit.
  assert.strictEqual(policyWrites, 1);
  assert.strictEqual(DAILY_POLICY_SETTINGS.dailyAutoCheckinEnabled, false);

  let autoCalls = 0, reminderCalls = 0;
  const Settings = { getGlobal: async () => ({ dailyAutoCheckinEnabled: true, dailyReminderEnabled: true,
    dailyReminderHourUtc: 2, dailyReminderMinuteUtc: 30 }) };
  const dependencies = {
    Settings,
    runDailyAutoCheckinSweep: async () => { autoCalls += 1; throw new Error('automatic credit forbidden'); },
    runDailyReminderSweep: async () => { reminderCalls += 1; return { sent: 1 }; }
  };
  for (const time of ['2026-10-30T02:29Z', '2026-10-30T02:30Z', '2026-10-30T10:00Z', '2026-10-31T02:30Z']) {
    await runDailySchedule(new Date(time), dependencies);
  }
  assert.strictEqual(autoCalls, 0, 'scheduler must ignore a stale true credit flag');
  assert.strictEqual(reminderCalls, 4);
  const server = fs.readFileSync('server.js', 'utf8');
  const cron = fs.readFileSync('scripts/daily-reminder-cron.js', 'utf8');
  const route = fs.readFileSync('routes/points.js', 'utf8');
  assert.match(server, /applyDailyManualPolicy\(Settings\)/);
  assert.match(server, /runDailySchedule\(new Date\(\)\)/);
  assert.match(cron, /applyDailyManualPolicy\(\)/);
  assert.match(cron, /30 2 \* \* \*/);
  assert.match(route, /claimDailyCheckin\(req\.dbUser\._id/);
  for (const name of ['routes/auth.js', 'routes/mobileAuth.js', 'utils/unifiedAuth.js']) {
    assert.doesNotMatch(fs.readFileSync(name, 'utf8'), /claimDailyCheckin|runDailyAutoCheckin|\/api\/points\/checkin/,
      name + ' must never claim a daily reward on login');
  }
  const app = fs.readFileSync('public/js/app.js', 'utf8');
  const dailyHandler = app.slice(app.indexOf('async function doCheckIn()'), app.indexOf('window.doCheckIn = doCheckIn'));
  assert.match(dailyHandler, /api\("\/api\/points\/checkin", \{ method: "POST" \}\)/);
  const restOfApp = app.replace(dailyHandler, '');
  assert.doesNotMatch(restOfApp, /api\("\/api\/points\/checkin"/, 'login and read-model refresh must not post a claim');
  console.log('PASS — manual-only daily policy, preserved reminders, no scheduled credit despite stale true setting, shared authenticated Claim (offline)');
})().catch(error => { console.error(error); process.exitCode = 1; });
