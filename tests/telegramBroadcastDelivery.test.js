'use strict';

const assert = require('node:assert/strict');
process.env.BOT_TOKEN = 'broadcast-test-token';

const UserPath = require.resolve('../models/User');
const blockedUpdates = [];
require.cache[UserPath] = {
  id: UserPath,
  filename: UserPath,
  loaded: true,
  exports: {
    updateOne: async (filter, update) => {
      blockedUpdates.push({ filter, update });
      return { modifiedCount: 1 };
    }
  }
};

const {
  bot,
  broadcastToActiveUsers,
  buildWebAppReplyMarkup,
  getTelegramRetryAfterMs
} = require('../utils/bot');

(async () => {
  const markup = buildWebAppReplyMarkup('Open Gramup 🚀', 'https://gramup.example/app');
  assert.deepEqual(markup, {
    inline_keyboard: [[{ text: 'Open Gramup 🚀', web_app: { url: 'https://gramup.example/app' } }]]
  });
  assert.equal(buildWebAppReplyMarkup('', 'https://gramup.example/app'), null);
  assert.throws(() => buildWebAppReplyMarkup('Open Gramup', 'http://gramup.example/app'), /HTTPS/);
  assert.throws(() => buildWebAppReplyMarkup('x'.repeat(65), 'https://gramup.example/app'), /64 characters/);
  assert.equal(getTelegramRetryAfterMs({ response: { statusCode: 429, body: { parameters: { retry_after: 2 } } } }), 2000);
  assert.equal(getTelegramRetryAfterMs({ response: { statusCode: 500, body: {} }, message: 'Internal error' }), null);

  const recipients = [
    { telegramId: '101', language: 'en' },
    { telegramId: '102', language: 'en' },
    { telegramId: '103', language: 'en' },
    { telegramId: '104', language: 'en' }
  ];
  const attempts = [];
  const delays = [];
  let rateLimitAttempts = 0;
  bot.sendMessage = async (telegramId, text, options) => {
    const id = String(telegramId);
    attempts.push({ id, text, options });
    if (id === '102' && rateLimitAttempts++ === 0) {
      const error = new Error('Too Many Requests: retry after 0.05');
      error.response = { statusCode: 429, body: { error_code: 429, parameters: { retry_after: 0.05 } } };
      throw error;
    }
    if (id === '103') {
      const error = new Error('Forbidden: bot was blocked by the user');
      error.response = { statusCode: 403, body: { error_code: 403 } };
      throw error;
    }
    if (id === '104') {
      const error = new Error('Telegram API unavailable');
      error.response = { statusCode: 500, body: { error_code: 500 } };
      throw error;
    }
    return { message_id: attempts.length };
  };

  const summary = await broadcastToActiveUsers({
    find: async () => recipients,
    updateOne: async (filter, update) => {
      blockedUpdates.push({ filter, update });
      return { modifiedCount: 1 };
    }
  }, 'Broadcast text', {
    recipients,
    replyMarkup: markup,
    sleepFn: async milliseconds => { delays.push(milliseconds); }
  });

  assert.deepEqual(summary, { sent: 2, failed: 1, blocked: 1, total: 4, processed: 4 });
  assert.deepEqual([...new Set(attempts.map(item => item.id))].sort(), ['101', '102', '103', '104']);
  assert.equal(attempts.filter(item => item.id === '102').length, 2, 'the FloodWait recipient is retried instead of skipped');
  assert.ok(attempts.every(item => item.options.reply_markup.inline_keyboard[0][0].web_app.url === 'https://gramup.example/app'));
  assert.ok(delays.filter(value => value === 50).length >= 3, 'the worker paces recipients at no more than 20 messages per second');
  assert.ok(blockedUpdates.some(item => item.filter.telegramId === '103' && item.update.$set.telegramBlockedAt instanceof Date));

  let photoCall;
  bot.sendPhoto = async (telegramId, image, options) => { photoCall = { telegramId, image, options }; };
  const photoSummary = await broadcastToActiveUsers({}, 'Photo broadcast', {
    recipients: [{ telegramId: '105' }],
    imageBuffer: Buffer.from('test-image'),
    replyMarkup: markup,
    intervalMs: 0,
    sleepFn: async () => {}
  });
  assert.equal(photoSummary.sent, 1);
  assert.equal(String(photoCall.telegramId), '105');
  assert.equal(photoCall.options.caption, 'Photo broadcast');
  assert.deepEqual(photoCall.options.reply_markup, markup);

  console.log('PASS — Telegram broadcasts pace deliveries, retry FloodWait, mark blocked recipients, report outcomes, and attach WebApp buttons');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
