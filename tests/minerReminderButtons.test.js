'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const notification = require(path.join(root, 'utils/vipMiningCycleNotification'));
const botSource = fs.readFileSync(path.join(root, 'utils/bot.js'), 'utf8');
const webhookSource = fs.readFileSync(path.join(root, 'routes/telegramWebhook.js'), 'utf8');

const markup = notification.cycleReplyMarkup('fa', 'https://gramup.example/app');
assert.equal(markup.inline_keyboard.length, 2);
assert.equal(markup.inline_keyboard[0][0].text, '⛏ جمع کردن UP');
assert.equal(markup.inline_keyboard[0][0].web_app.url, 'https://gramup.example/app');
assert.equal(markup.inline_keyboard[1][0].text, '🔕 خاموش کردن یادآوریها');
assert.equal(markup.inline_keyboard[1][0].callback_data, notification.MINER_REMINDER_MUTE_CALLBACK_DATA);

const english = notification.cycleReplyMarkup('en', 'https://gramup.example/app');
assert.equal(english.inline_keyboard[0][0].text, '⛏ Claim UP');
assert.equal(english.inline_keyboard[1][0].text, '🔕 Mute reminders');

assert.match(botSource, /editMessageReplyMarkup\(chatId, messageId, replyMarkup\)/);
assert.match(webhookSource, /botReminderEnabled: false/);
assert.match(webhookSource, /MINER_REMINDER_MUTE_CALLBACK_DATA/);
assert.match(webhookSource, /editMessageReplyMarkup\(chatId, callbackQuery\.message\.message_id/);

console.log('PASS — miner reminder uses localized two-row keyboard and disables reminders idempotently');
