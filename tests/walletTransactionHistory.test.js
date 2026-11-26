'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
const i18n = fs.readFileSync(path.join(root, 'public/js/i18n.js'), 'utf8');
const points = fs.readFileSync(path.join(root, 'routes/points.js'), 'utf8');
assert.match(app, /function transactionTimeLabel\(dateString\)/);
assert.match(app, /diffMs < 24 \* 60 \* 60 \* 1000/);
assert.match(app, /history_time_minutes_ago/);
assert.match(app, /history_time_hours_ago/);
assert.match(app, /return formatExactDateTime\(dateString\)/);
assert.match(app, /const WALLET_HISTORY_FALLBACKS/);
assert.match(app, /function walletHistoryText\(key, vars = \{\}\)/);
assert.match(app, /translation unavailable\|ترجمهٔ\? این متن در دسترس نیست\|ژباړه شتون نه لري/);
assert.match(app, /onclick="openPublicPayments\(\)"[\s\S]*?wallet_view_all_button/);
assert.match(app, /function openPublicPayments\(\)[\s\S]*?window\.location\.assign\(publicProofUrl\(\)\)/);
assert.match(app, /url\.searchParams\.set\("lang", language\)/);
assert.match(app, /transactionTimeLabel\(item\.createdAt\)/);
assert.match(app, /transactionTimeLabel\(item\.date\)/);
const privateHistoryRoute = points.slice(points.indexOf("router.get('/withdrawals'"), points.indexOf("// Native GRAM deposits", points.indexOf("router.get('/withdrawals'")));
assert.match(privateHistoryRoute, /\.limit\(5\)/, 'Mini App private history must show five records');
const publicHistoryRoute = points.slice(points.indexOf("router.get('/public-history'"), points.indexOf("router.get('/public-history'") + 1200);
assert.doesNotMatch(publicHistoryRoute, /\.limit\(\s*5\s*\)/, 'public history must remain unlimited');
for (const key of ['wallet_view_all_button', 'history_time_just_now', 'history_time_minutes_ago', 'history_time_hours_ago']) {
  assert.strictEqual((i18n.match(new RegExp(`${key}:`, 'g')) || []).length, 3, `${key} must exist in all locales`);
}
console.log('PASS — Wallet View All and localized transaction time formatting');
