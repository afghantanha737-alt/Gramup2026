'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const points = fs.readFileSync(path.join(root, 'routes/points.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
const i18n = fs.readFileSync(path.join(root, 'public/js/i18n.js'), 'utf8');

assert.match(points, /principalDailyPercent/);
assert.match(points, /rewardDailyPercent/);
assert.match(points, /dailyTotalPayoutPoints/);
assert.match(points, /totalReceivedPoints/);
assert.match(app, /vip_daily_total_label/);
assert.match(app, /vip_total_received_label/);
assert.doesNotMatch(app, /vip_principal_daily/);
assert.doesNotMatch(app, /vip_reward_daily/);
assert.strictEqual((i18n.match(/vip_daily_total_label:/g) || []).length, 3);
assert.strictEqual((i18n.match(/vip_total_received_label:/g) || []).length, 3);
console.log('PASS — VIP UI contract exposes consolidated daily and total received values');
