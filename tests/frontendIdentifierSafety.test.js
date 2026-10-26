'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');

for (const marker of [
  'findByData(selector, key, value)',
  'closest?.("[data-verify]")',
  'closest?.("[data-upload-screenshot]")',
  'closest?.("[data-latest-post-check]")',
  'closest?.("[data-referral-claim]")',
  'closest?.("[data-vip-claim]")',
  'closest?.("[data-withdrawal-id]")'
]) assert.ok(app.includes(marker), `expected delegated safe handler: ${marker}`);

assert.ok(app.includes('data-screenshot-task="${escapeHTML(task._id)}"'));
assert.ok(app.includes('data-upload-screenshot="${escapeHTML(task._id)}"'));
assert.ok(app.includes('data-withdrawal-id="${escapeHTML(item._id)}"'));
assert.ok(app.includes('data-vip-claim="${escapeHTML(subscription.id)}"'));
assert.ok(!app.includes('onclick="verifyTelegramTask(\'${task._id}'));
assert.ok(!app.includes('onchange="submitScreenshotTask(\'${task._id}'));
assert.ok(!app.includes('onclick="openWithdrawalDetail(\'${item._id}'));
assert.ok(!app.includes('onclick="claimVipReward(\'${escapeHTML(subscription.id)}'));

const languageOptions = [...html.matchAll(/<button\b[^>]*class="langOption"[^>]*>/g)];
assert.strictEqual(languageOptions.length, 3, 'all three language options must be native buttons');
assert.ok(languageOptions.every(match => /type="button"/.test(match[0])));
console.log('PASS — API-backed identifiers use escaped data attributes and delegated handlers; language choices are native buttons');
