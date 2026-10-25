'use strict';
/** node tests/dailyReminder.test.js — منطق زمان‌بندی یادآوری ورود روزانه و متن‌های چندزبانه‌ی ربات */
const assert = require('assert');
const { shouldRunNow, utcDayKey, streakAtRiskMessageFor, reminderMessageFor, kabulDayStart } = require('../utils/dailyReminder');
const { botText } = require('../utils/botMessages');

// ---- shouldRunNow
assert.strictEqual(shouldRunNow({ dailyReminderEnabled: false, dailyReminderHourUtc: 15 }, new Date('2026-01-01T15:05:00Z')), false, 'خاموش یعنی هرگز اجرا نشود');
assert.strictEqual(shouldRunNow({ dailyReminderEnabled: true, dailyReminderHourUtc: 2, dailyReminderMinuteUtc: 30 }, new Date('2026-01-01T02:30:00Z')), true, '۷ صبح کابل برابر ۰۲:۳۰ UTC است');
assert.strictEqual(shouldRunNow({ dailyReminderEnabled: true, dailyReminderHourUtc: 2, dailyReminderMinuteUtc: 30 }, new Date('2026-01-01T02:29:00Z')), false, 'یک دقیقه قبل از ساعت هنوز نه');
assert.strictEqual(shouldRunNow({ dailyReminderEnabled: true, dailyReminderHourUtc: 2, dailyReminderMinuteUtc: 30 }, new Date('2026-01-01T02:31:00Z')), false, 'یک دقیقه بعد دیگر نه');
assert.strictEqual(shouldRunNow({ dailyReminderEnabled: true, dailyReminderHourUtc: 0, dailyReminderMinuteUtc: 0 }, new Date('2026-01-01T00:00:00Z')), true, 'ساعت صفر UTC هم باید کار کند');
console.log('PASS  shouldRunNow: فقط داخل ساعت تنظیم‌شده و وقتی فعال است');

// ---- utcDayKey: باید برای هر لحظه در یک روز UTC یکسان و برای روز بعد متفاوت باشد
const dayA1 = utcDayKey(new Date('2026-03-10T00:00:00Z'));
const dayA2 = utcDayKey(new Date('2026-03-10T23:59:59Z'));
const dayB = utcDayKey(new Date('2026-03-11T00:00:00Z'));
assert.strictEqual(dayA1, dayA2);
assert.strictEqual(dayB, dayA1 + 1);
console.log('PASS  utcDayKey: کل یک روز UTC یک کلید، روز بعد کلید متفاوت');

// ---- botText: هر سه زبان برای هر پیام موجود است و مقادیر را درست جای می‌گذارد
for (const lang of ['fa', 'ps', 'en']) {
  assert.ok(botText('welcome', lang, 'Ali').includes('Ali'), `welcome/${lang}`);
  assert.ok(botText('taskNew', lang, 'Task X', 50, '').includes('Task X'), `taskNew/${lang}`);
  assert.ok(botText('taskNew', lang, 'Task X', 50, 'Acme').includes('Acme'), `taskNew sponsored/${lang}`);
  assert.ok(botText('withdrawalApproved', lang, 1.5, 'GRAM', 'abc123').includes('abc123'), `withdrawalApproved/${lang}`);
  assert.ok(botText('withdrawalRejected', lang, 'too fast').includes('too fast'), `withdrawalRejected/${lang}`);
  assert.ok(botText('referralBonus', lang, 'Sara', 50, 200).includes('Sara'), `referralBonus/${lang}`);
  assert.ok(botText('dailyReminder', lang).length > 5, `dailyReminder/${lang}`);
  assert.ok(botText('leaderboardReward', lang, 1, 500, '2026-09-28').includes('500'), `leaderboardReward/${lang}`);
}
console.log('PASS  botText: هر ۶ پیام در هر ۳ زبان موجود است و متغیرها را درست جا می‌گذارد');

// زبان ناشناخته باید به فارسی برگردد (fallback)، نه خطا بدهد
assert.strictEqual(botText('withdrawalRejected', 'xx', ''), botText('withdrawalRejected', 'fa', ''));
assert.strictEqual(botText('withdrawalRejected', undefined, ''), botText('withdrawalRejected', 'fa', ''));
console.log('PASS  botText: زبان نامعتبر/خالی به فارسی برمی‌گردد، نه کرش می‌کند');

assert.ok(streakAtRiskMessageFor('fa').includes('استریک'));
assert.ok(streakAtRiskMessageFor('en').includes('streak'));
console.log('PASS  streakAtRiskMessageFor: پیام خطر استریک برای زبان‌ها');

const personalized = reminderMessageFor({ dailyReminderMessage: '' }, 'fa', 2, new Date('2026-01-01T02:00:00Z'), new Date('2026-01-02T02:30:00Z'));
assert.match(personalized, /روز 3/);
assert.match(personalized, /9 پوینت/);
assert.ok(kabulDayStart(new Date('2026-01-02T02:30:00Z')) < new Date('2026-01-02T02:30:00Z'));
console.log('PASS  reminderMessageFor: روز چرخه و پاداش بر اساس استریک شخصی‌سازی می‌شود');

console.log('ALL PASS');
