'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const adminRoute = fs.readFileSync(path.join(root, 'routes', 'admin.js'), 'utf8');
const adminUi = fs.readFileSync(path.join(root, 'public', 'admin.html'), 'utf8');

const statusRoute = adminRoute.slice(
  adminRoute.indexOf("router.get('/daily-reminder/status'"),
  adminRoute.indexOf("router.get('/daily-reminder/last-run'")
);
const settingsRoute = adminRoute.slice(
  adminRoute.indexOf("router.put('/settings'"),
  adminRoute.indexOf("/**\n * POST /api/admin/daily-reminder/test")
);
const dailySettingsUi = adminUi.slice(
  adminUi.indexOf('<b>دیلی چک‌این و پیام روزانه</b>'),
  adminUi.indexOf('<label>حداقل پوینت برای برداشت</label>')
);
const reminderFunctionsUi = adminUi.slice(
  adminUi.indexOf('function renderReminderStatus(s)'),
  adminUi.indexOf('function renderReferralRates()')
);

assert.match(statusRoute, /automaticCreditEnabled:\s*false/);
assert.match(statusRoute, /rewardMode:\s*'manual_claim'/);
assert.doesNotMatch(statusRoute, /automaticCreditEnabled:\s*settings\.dailyAutoCheckinEnabled/);

assert.match(settingsRoute, /body\.dailyAutoCheckinEnabled === true/);
assert.match(settingsRoute, /code:\s*'DAILY_MANUAL_CLAIM_ONLY'/);
assert.match(settingsRoute, /changes\.dailyAutoCheckinEnabled = body\.dailyAutoCheckinEnabled/);
assert.match(settingsRoute, /if \(body\.dailyAutoCheckinEnabled === true\)[\s\S]*?return res\.status\(400\)/);

assert.match(dailySettingsUi, /فقط با Claim دستی/);
assert.match(dailySettingsUi, /ورود به حساب یا زمان‌بندی هیچ پاداشی را خودکار پرداخت نمی‌کند/);
assert.doesNotMatch(dailySettingsUi, /setAutoCheckinEnabled/);
assert.doesNotMatch(adminUi, /dailyAutoCheckinEnabled/);
assert.doesNotMatch(reminderFunctionsUi, /dailyAutoCheckin/);

for (const id of ['setReminderEnabled', 'setReminderTz', 'setReminderLocalHour', 'setReminderLocalMinute', 'setReminderAudience', 'setReminderMessage']) {
  assert.match(dailySettingsUi, new RegExp(`id="${id}"`), `${id} reminder control remains available`);
}
assert.match(adminUi, /s\.dailyReminderLocalHour \?\? 7/);
assert.match(adminUi, /s\.dailyReminderLocalMinute \?\? 0/);
assert.match(adminUi, /s\.dailyReminderAudience \|\| "all"/);

console.log('PASS — daily admin is manual-claim-only, legacy false writes remain compatible, and reminder controls stay intact');
