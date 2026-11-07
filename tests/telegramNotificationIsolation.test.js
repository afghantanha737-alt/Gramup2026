'use strict';
const assert = require('assert');
process.env.BOT_TOKEN = 'telegram-isolation-test-token-not-real';
const { safelySendTelegram } = require('../utils/telegramNotification');
const { bot, withTelegramDeliveryDeadline } = require('../utils/bot');
const { runDailyCheckinNotificationSweep } = require('../utils/dailyCheckinNotification');
const { sendNotificationOnce, enqueuePendingNotification } = require('../utils/notificationDelivery');
(async () => {
  const logs = [];
  const logger = { warn: data => logs.push(data) };
  assert.strictEqual(await safelySendTelegram(() => { throw new Error('private-token-and-message'); }, { logger }), false);
  assert.strictEqual(await safelySendTelegram(async () => { throw new Error('network failure'); }, { logger }), false);
  assert.strictEqual(await safelySendTelegram(async () => true), true);
  assert.strictEqual(await safelySendTelegram(async () => false), false);
  assert.strictEqual(await safelySendTelegram(() => { throw Error('failed'); }, { logger: { warn() { throw Error('logger failed'); } } }), false);
  assert.ok(!JSON.stringify(logs).includes('private-token-and-message'));
  let signal;
  await assert.rejects(withTelegramDeliveryDeadline(s => { signal = s; return new Promise(() => {}); }, 5));
  assert.strictEqual(signal.aborted, true, 'a hung notification transport is aborted');
  assert.strictEqual(await withTelegramDeliveryDeadline(async () => 'ok', 5), 'ok');

  const originalFetch = global.fetch;
  try {
    const requests = [];
    global.fetch = async (url, request) => {
      requests.push({ url, request });
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1, status: 'member' } }) };
    };
    await bot.sendMessage('11', 'test');
    await bot.sendPhoto('11', Buffer.from('image'));
    await bot.copyMessage('11', '12', 1);
    await bot.answerCallbackQuery('callback');
    await bot.getChatMember('chat', '11');
    assert.ok(requests.slice(0, 4).every(item => item.request.signal instanceof AbortSignal));
    assert.strictEqual(requests[4].request.signal, undefined, 'membership query behavior is not changed by notification deadlines');
    global.fetch = async () => ({ ok: true, status: 200, json: async () => { throw Error('malformed JSON'); } });
    await assert.rejects(bot.sendMessage('11', 'test'), /Telegram API sendMessage failed/);
  } finally { global.fetch = originalFetch; }

  const now = new Date('2026-10-30T04:00:00.000Z');
  const users = [1, 2, 3].map(n => ({ _id: `u${n}`, telegramId: String(n), streak: 0 }));
  const attempts = [];
  const notifyUser = async id => { attempts.push(id); if (id === '1') throw Error('Telegram unavailable'); return true; };
  const User = { find: () => ({ lean: async () => users }), updateOne: async () => ({ modifiedCount: 1 }) };
  const daily = await runDailyCheckinNotificationSweep(now, { User, notifyUser, hourUtc: 4 });
  assert.strictEqual(daily.sent, 2); assert.strictEqual(daily.failed, 1);
  assert.strictEqual(attempts.length, 3, 'one failed daily message cannot abort the batch');
  attempts.length = 0;
  // Required transactional persistence must still fail closed; softening
  // provider failures must never fabricate a durably stored outbox status.
  const offline = { findOneAndUpdate: async () => { throw Error('outbox unavailable'); } };
  const payload = { eventKey: 'test-event', type: 'referral_initial', user: 'u1', telegramId: '1', text: 'test' };
  await assert.rejects(sendNotificationOnce(payload, { NotificationDelivery: offline }), /outbox unavailable/);
  await assert.rejects(enqueuePendingNotification(payload, { NotificationDelivery: offline }), /outbox unavailable/);
  console.log('PASS — Telegram sync/rejected/timeout/malformed-response errors are isolated; daily notifications continue and outbox/lock safety remains fail-closed');
})().catch(error => { console.error(error); process.exitCode = 1; });
