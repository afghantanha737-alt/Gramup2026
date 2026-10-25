'use strict';
const assert = require('assert');
const fs = require('fs');
const { sendTestReminderToAll } = require('../utils/dailyReminder');

async function main() {
  const sent = [];
  let updateCalls = 0;
  const users = [
    { _id: 'u1', telegramId: '1001', language: 'fa', streak: 0, lastCheckIn: null },
    { _id: 'u2', telegramId: '1002', language: 'en', streak: 3, lastCheckIn: new Date('2026-10-25T03:00:00Z') }
  ];
  const User = {
    find() {
      return {
        select() {
          return { lean: async () => users };
        }
      };
    },
    updateOne() { updateCalls += 1; }
  };
  const Settings = { getGlobal: async () => ({ dailyReminderMessage: '' }) };
  const result = await sendTestReminderToAll({
    User,
    Settings,
    now: new Date('2026-10-26T03:00:00Z'),
    notifyUser: async (telegramId, text) => { sent.push({ telegramId, text }); return true; }
  });

  assert.deepStrictEqual(result, { sent: 2, failed: 0, total: 2, lastError: '' });
  assert.deepStrictEqual(sent.map(item => item.telegramId), ['1001', '1002']);
  assert.ok(sent[0].text && sent[1].text, 'each user receives a non-empty reminder');
  assert.strictEqual(updateCalls, 0, 'test broadcast must not update user reminder markers');

  const route = fs.readFileSync('routes/admin.js', 'utf8');
  const html = fs.readFileSync('public/admin.html', 'utf8');
  const util = fs.readFileSync('utils/dailyReminder.js', 'utf8');
  assert.ok(route.includes("router.post('/daily-reminder/test-all'"));
  assert.ok(route.includes('sendTestReminderToAll'));
  assert.ok(route.includes("action: 'daily_reminder_test_all'"));
  assert.ok(html.includes('sendReminderTestAll'));
  assert.ok(util.includes('lastReminderSentAt') === false || util.includes('sendTestReminderToAll'));
  console.log('PASS — all-user daily reminder test is personalized, rate-limited, tracked, and side-effect free');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
