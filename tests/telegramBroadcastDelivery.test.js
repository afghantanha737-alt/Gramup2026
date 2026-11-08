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
  buildBroadcastButtonReplyMarkup,
  sanitizeTelegramHtml,
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
  const fallbackMarkup = buildBroadcastButtonReplyMarkup('Open Gramup 🚀', '', 'https://gramup.example/app');
  assert.deepEqual(fallbackMarkup, markup, 'an empty custom URL falls back to the default WebApp button');
  const customTelegramMarkup = buildBroadcastButtonReplyMarkup('Open Bot', 'https://t.me/gramup_bot', '');
  assert.deepEqual(customTelegramMarkup, {
    inline_keyboard: [[{ text: 'Open Bot', url: 'https://t.me/gramup_bot' }]]
  });
  const customWebMarkup = buildBroadcastButtonReplyMarkup('Visit Site', 'https://campaign.example/path', '');
  assert.deepEqual(customWebMarkup, {
    inline_keyboard: [[{ text: 'Visit Site', url: 'https://campaign.example/path' }]]
  });
  assert.throws(() => buildBroadcastButtonReplyMarkup('Unsafe', 'javascript:alert(1)', 'https://gramup.example/app'), /HTTP\(S\)/);
  assert.throws(() => buildBroadcastButtonReplyMarkup('Open Bot', 'http://t.me/gramup_bot', 'https://gramup.example/app'), /HTTPS/);
  const formattedText = sanitizeTelegramHtml('Hello <b>bold</b> & <i>italic</i> <code>1 < 2</code> <a href="https://example.com?q=1&x=2">link</a> <tg-spoiler>hidden</tg-spoiler>');
  assert.equal(formattedText, 'Hello <b>bold</b> &amp; <i>italic</i> <code>1 &lt; 2</code> <a href="https://example.com/?q=1&amp;x=2">link</a> &lt;tg-spoiler&gt;hidden&lt;/tg-spoiler&gt;');
  assert.equal(sanitizeTelegramHtml('<b>bold'), '<b>bold</b>', 'unclosed formatting tags are closed safely');
  assert.equal(sanitizeTelegramHtml('<a href="javascript:alert(1)">bad</a>'), '&lt;a href="javascript:alert(1)"&gt;bad&lt;/a&gt;');
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
  }, formattedText, {
    recipients,
    replyMarkup: markup,
    sendOptions: { parse_mode: 'HTML' },
    sleepFn: async milliseconds => { delays.push(milliseconds); }
  });

  assert.deepEqual(summary, { sent: 2, failed: 1, blocked: 1, total: 4, processed: 4 });
  assert.deepEqual([...new Set(attempts.map(item => item.id))].sort(), ['101', '102', '103', '104']);
  assert.equal(attempts.filter(item => item.id === '102').length, 2, 'the FloodWait recipient is retried instead of skipped');
  assert.ok(attempts.every(item => item.options.reply_markup.inline_keyboard[0][0].web_app.url === 'https://gramup.example/app'));
  assert.ok(attempts.every(item => item.text === formattedText && item.options.parse_mode === 'HTML'));
  assert.ok(delays.filter(value => value === 50).length >= 3, 'the worker paces recipients at no more than 20 messages per second');
  assert.ok(blockedUpdates.some(item => item.filter.telegramId === '103' && item.update.$set.telegramBlockedAt instanceof Date));

  const progress = [];
  await broadcastToActiveUsers({ find: async () => recipients }, formattedText, {
    recipients,
    intervalMs: 0,
    progressEvery: 2,
    onProgress: async value => progress.push(value.processed),
    sleepFn: async () => {}
  });
  assert.deepEqual(progress, [2, 4], 'progress checkpoints honor the configured interval and include the final recipient');

  let customTextCall;
  bot.sendMessage = async (telegramId, text, options) => { customTextCall = { telegramId, text, options }; };
  const customTextSummary = await broadcastToActiveUsers({}, formattedText, {
    recipients: [{ telegramId: '106' }],
    replyMarkup: customTelegramMarkup,
    sendOptions: { parse_mode: 'HTML' },
    intervalMs: 0,
    sleepFn: async () => {}
  });
  assert.equal(customTextSummary.sent, 1);
  assert.deepEqual(customTextCall.options.reply_markup, customTelegramMarkup);
  assert.equal(customTextCall.options.parse_mode, 'HTML');

  let photoCall;
  bot.sendPhoto = async (telegramId, image, options) => { photoCall = { telegramId, image, options }; };
  const photoSummary = await broadcastToActiveUsers({}, formattedText, {
    recipients: [{ telegramId: '105' }],
    imageBuffer: Buffer.from('test-image'),
    replyMarkup: markup,
    sendOptions: { parse_mode: 'HTML' },
    intervalMs: 0,
    sleepFn: async () => {}
  });
  assert.equal(photoSummary.sent, 1);
  assert.equal(String(photoCall.telegramId), '105');
  assert.equal(photoCall.options.caption, formattedText);
  assert.deepEqual(photoCall.options.reply_markup, markup);
  assert.equal(photoCall.options.parse_mode, 'HTML');

  let customPhotoCall;
  bot.sendPhoto = async (telegramId, image, options) => { customPhotoCall = { telegramId, image, options }; };
  const customPhotoSummary = await broadcastToActiveUsers({}, formattedText, {
    recipients: [{ telegramId: '107' }],
    imageBuffer: Buffer.from('test-image'),
    replyMarkup: customWebMarkup,
    sendOptions: { parse_mode: 'HTML' },
    intervalMs: 0,
    sleepFn: async () => {}
  });
  assert.equal(customPhotoSummary.sent, 1);
  assert.deepEqual(customPhotoCall.options.reply_markup, customWebMarkup);
  assert.equal(customPhotoCall.options.parse_mode, 'HTML');

  console.log('PASS — Telegram broadcasts pace deliveries, retry FloodWait, mark blocked recipients, report outcomes, and attach custom URL/WebApp buttons to text and photos');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
