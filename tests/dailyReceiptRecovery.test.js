'use strict';
const assert = require('assert');
const { runDailyReceiptRetrySweep } = require('../utils/dailyReceiptRetry');
const { finalizeExhaustedNotifications } = require('../utils/notificationExhaustion');
const NotificationDelivery = require('../models/NotificationDelivery');
(async () => {
  const oldText = 'Today reward +9 points, cycle day 3';
  const rows = [
    { eventKey: 'daily-checkin:checkin:u1:20000', type: 'daily_checkin', user: 'u1', telegramId: '100', text: oldText },
    { eventKey: 'daily-checkin:checkin:banned:20000', type: 'daily_checkin', user: 'banned', telegramId: '101', text: 'must not send' }
  ];
  let sent = [], cleanupFilter;
  const Model = {
    updateMany: async (filter, update) => {
      cleanupFilter = filter;
      assert.strictEqual(update.$set.status, 'exhausted');
      assert.strictEqual(filter.type, 'daily_checkin');
      assert.ok(filter.$or[2].sendingAt.$lt, 'active sending leases must not be killed');
      return { modifiedCount: 1 };
    },
    find: filter => {
      assert.strictEqual(filter.type, 'daily_checkin');
      assert.strictEqual(filter.attempts.$lt, 5);
      return { sort() { return this; }, limit() { return this; }, lean: async () => rows };
    }
  };
  const User = { findById: id => ({ select() { return this; }, lean: async () => ({
    _id: id, telegramId: id === 'u1' ? '100' : '101', isBanned: id === 'banned'
  }) }) };
  const result = await runDailyReceiptRetrySweep({
    now: new Date('2026-10-31T02:30Z'), NotificationDelivery: Model, User,
    Settings: { getGlobal: async () => ({ dailyAutoCheckinEnabled: false, dailyReminderEnabled: true }) },
    sendNotificationOnce: async (payload, options) => {
      sent.push(payload);
      assert.strictEqual(options.maxAttempts, 5);
      assert.strictEqual(options.retryUnknown, true);
      return { status: 'sent' };
    }, sleep: async () => {}
  });
  assert.strictEqual(result.sent, 1);
  assert.strictEqual(result.skipped, 1);
  assert.strictEqual(result.exhausted, 1);
  assert.strictEqual(sent[0].text, oldText, 'old receipt must use the immutable old reward payload');
  assert.strictEqual(sent[0].eventKey, rows[0].eventKey);
  assert.strictEqual(cleanupFilter.attempts.$gte, 5);
  const disabled = await runDailyReceiptRetrySweep({ Settings: {
    getGlobal: async () => ({ dailyReminderEnabled: false })
  } });
  assert.strictEqual(disabled.skipped, 'messages_disabled');
  assert.ok(NotificationDelivery.schema.path('status').enumValues.includes('exhausted'));
  assert.ok(NotificationDelivery.schema.path('exhaustedAt'));
  const emptyAdapter = await finalizeExhaustedNotifications('daily_checkin', {}, new Date());
  assert.strictEqual(emptyAdapter.modifiedCount, 0);
  console.log('PASS — immutable prior-day daily receipt recovery, no credit calls, banned/message gates and terminal retry cleanup (mocked)');
})().catch(error => { console.error(error); process.exitCode = 1; });
