'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');

for (const marker of [
  'findByData(selector, key, value)',
  'closest?.("[data-verify]")',
  'closest?.("[data-upload-screenshot]")',
  'closest?.("[data-latest-post-check]")',
  'closest?.("[data-referral-claim]")',
  'closest?.("[data-withdrawal-id]")'
]) assert.ok(app.includes(marker), `expected delegated safe handler: ${marker}`);

assert.ok(app.includes('data-screenshot-task="${escapeHTML(task._id)}"'));
assert.ok(app.includes('data-upload-screenshot="${escapeHTML(task._id)}"'));
assert.ok(app.includes('data-withdrawal-id="${escapeHTML(item._id)}"'));
assert.match(app, /async function claimVipMining\(\)/, 'the VIP wallet claim uses the shared mining endpoint');
assert.doesNotMatch(app, /data-vip-claim|claimVipReward\(/, 'scheduled subscription claim controls must be absent');
assert.ok(!app.includes('onclick="verifyTelegramTask(\'${task._id}'));
assert.ok(!app.includes('onchange="submitScreenshotTask(\'${task._id}'));
assert.ok(!app.includes('onclick="openWithdrawalDetail(\'${item._id}'));

const languageOptions = [...html.matchAll(/<button\b[^>]*class="langOption"[^>]*>/g)];
assert.equal(languageOptions.length, 3, 'all three language options must be native buttons');
assert.ok(languageOptions.every(match => /type="button"/.test(match[0])));
console.log('PASS — API-backed identifiers use escaped data attributes and delegated handlers; VIP uses the mining wallet claim');
