'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  activeTelegramUserFilter,
  filterActiveTelegramRecipients,
  isValidTelegramUserId
} = require('../utils/bot');

assert.equal(isValidTelegramUserId('708528472'), true);
assert.equal(isValidTelegramUserId('4503599627370495'), true, 'Telegram user IDs up to the documented 52-bit range remain valid');
for (const invalid of ['', null, undefined, ' 1001 ', '0', '-123', '1.5', 'not-a-chat', '4503599627370496', '9007199254740992']) {
  assert.equal(isValidTelegramUserId(invalid), false, `invalid chat id should be rejected: ${String(invalid)}`);
}

const filter = activeTelegramUserFilter();
assert.deepEqual(filter.telegramId, { $exists: true, $nin: [null, ''] }, 'the query preserves legacy numeric-ID rows for safe string validation');
assert.ok(filter.$and.some(clause => clause.$or?.some(branch => branch.telegramBlockedAt === null)));
assert.ok(filter.$and.some(clause => clause.$or?.some(branch => branch.isBanned === false)));

const candidates = [
  { telegramId: '1001' }, // legacy record without optional flags remains eligible
  { telegramId: '1002', isBanned: false, telegramBlockedAt: null },
  { telegramId: 1005 }, // legacy numeric storage is normalized and validated
  { telegramId: '' },
  { telegramId: 'garbage' },
  { telegramId: ' 1006 ' },
  { telegramId: '1003', telegramBlockedAt: new Date() },
  { telegramId: '1004', isBanned: true },
  { telegramId: '4503599627370496' }
];
assert.deepEqual(filterActiveTelegramRecipients(candidates), candidates.slice(0, 3));

const webhook = fs.readFileSync('routes/telegramWebhook.js', 'utf8');
const botSource = fs.readFileSync('utils/bot.js', 'utf8');
assert.ok(webhook.includes('broadcastCopyToActiveUsers(User, pending.fromChatId, pending.messageId)'),
  'Telegram bot broadcast confirmation must delegate delivery to the shared copy-broadcast helper');
assert.ok(botSource.includes("User.find(activeTelegramUserFilter(), 'telegramId isBanned telegramBlockedAt').lean()"),
  'copy broadcasts must query active recipients with optional legacy flags available for validation');
assert.ok(botSource.includes('const users = filterActiveTelegramRecipients(candidates);'),
  'copy broadcasts must validate each stored Telegram ID before sending');
assert.ok(botSource.includes('const retryAfterMs = getTelegramRetryAfterMs(error);'),
  'copy broadcasts must retry a Telegram FloodWait once');
assert.ok(botSource.includes('if (isTelegramDeliveryBlocked(error)) await markTelegramBlocked(telegramId);'),
  'blocked or chat-not-found recipients must be marked to prevent repeated failures');

console.log('PASS — bot broadcasts select valid, active Telegram user IDs and skip blocked recipients');
