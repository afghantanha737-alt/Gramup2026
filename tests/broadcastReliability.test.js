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
assert.ok(source.includes('buildBroadcastButtonReplyMarkup(buttonText, buttonUrl, webAppUrl)'));
assert.ok(source.includes('process.env.MINI_APP_URL || process.env.APP_URL'));
assert.ok(source.includes('req.body.button_url || req.body.buttonUrl'));
assert.ok(source.includes('sanitizeTelegramHtml(rawText)'));
assert.ok(source.includes("sendOptions: { parse_mode: 'HTML' }"));
assert.ok(source.includes('blocked: job.blocked || 0'));

const adminHtml = fs.readFileSync(path.join(__dirname, '..', 'public/admin.html'), 'utf8');
assert.ok(adminHtml.includes('id="broadcastButtonText"'));
assert.ok(adminHtml.includes('id="button_url" name="button_url"'));
assert.ok(adminHtml.includes('formData.append("button_text", buttonText)'));
assert.ok(adminHtml.includes('formData.append("button_url", buttonUrl)'));
assert.ok(adminHtml.includes('formatBroadcastMessage(\'bold\')'));
assert.ok(adminHtml.includes('formatBroadcastMessage(\'italic\')'));
assert.ok(adminHtml.includes('formatBroadcastMessage(\'code\')'));
assert.ok(adminHtml.includes('formatBroadcastMessage(\'link\')'));
assert.ok(adminHtml.includes('job.blocked || 0'));

console.log('ALL PASS — durable Broadcast job status and delivery diagnostics contract');
