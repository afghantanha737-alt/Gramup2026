'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
const i18n = fs.readFileSync(path.join(root, 'public/js/i18n.js'), 'utf8');
assert.match(app, /function transactionTimeLabel\(dateString\)/);
assert.match(app, /diffMs < 24 \* 60 \* 60 \* 1000/);
assert.match(app, /history_time_minutes_ago/);
assert.match(app, /history_time_hours_ago/);
assert.match(app, /return formatExactDateTime\(dateString\)/);
assert.match(app, /onclick="openHistory\(\)"[\s\S]*?wallet_view_all_button/);
assert.match(app, /transactionTimeLabel\(item\.createdAt\)/);
assert.match(app, /transactionTimeLabel\(item\.date\)/);
for (const key of ['wallet_view_all_button', 'history_time_just_now', 'history_time_minutes_ago', 'history_time_hours_ago']) {
  assert.strictEqual((i18n.match(new RegExp(`${key}:`, 'g')) || []).length, 3, `${key} must exist in all locales`);
}
console.log('PASS — Wallet View All and localized transaction time formatting');
