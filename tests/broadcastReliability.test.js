'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const BroadcastJob = require('../models/BroadcastJob');

const fields = BroadcastJob.schema.paths;
for (const field of ['status', 'totalRecipients', 'sent', 'failed', 'blocked', 'startedAt', 'finishedAt', 'lastError']) {
  assert.ok(fields[field], `BroadcastJob must contain ${field}`);
}
assert.deepStrictEqual(fields.status.enumValues, ['running', 'completed', 'failed']);
assert.ok(BroadcastJob.schema.indexes().some(([index]) => index.createdAt === -1));

const source = fs.readFileSync(path.join(__dirname, '..', 'routes/admin.js'), 'utf8');
assert.ok(source.includes("router.get('/broadcast/:id'"));
assert.ok(source.includes('broadcastId: String(job._id)'));
assert.ok(source.includes("status: 'completed'"));
assert.ok(source.includes("status: 'failed'"));
assert.ok(source.includes('BroadcastJob.updateOne'));
assert.ok(source.includes('sanitizeTelegramHtml(rawText)'));
assert.ok(source.includes('buildBroadcastButtonsReplyMarkup(requestedButtons, webAppUrl)'));
assert.ok(source.includes("parse_mode: 'HTML'"));
assert.ok(source.includes('reply_markup: replyMarkup'));
assert.ok(source.includes('activeTelegramUserFilter()'));
assert.ok(source.includes('filterActiveTelegramRecipients(candidates)'));
assert.ok(source.includes('broadcastToActiveUsers(User, text, {'));
assert.ok(source.includes('progressEvery: 25'));
assert.ok(source.includes('blocked: job.blocked || 0'));
assert.ok(source.includes('blocked: summary.blocked'));

const botSource = fs.readFileSync(path.join(__dirname, '..', 'utils/bot.js'), 'utf8');
assert.ok(botSource.includes('function sanitizeTelegramHtml(value)'));
assert.ok(botSource.includes('function buildBroadcastButtonsReplyMarkup(buttons, webAppUrl)'));
assert.ok(botSource.includes('getTelegramRetryAfterMs(error)'));
assert.ok(botSource.includes('at most 8 inline buttons'));

console.log('ALL PASS — Admin broadcast uses validated, paced shared delivery with retry and blocked-recipient progress');
