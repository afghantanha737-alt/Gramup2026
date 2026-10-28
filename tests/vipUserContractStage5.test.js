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
assert.match(points, /dailyPrincipalPoints/);
assert.match(points, /dailyRewardPoints/);
assert.match(app, /vip_plan_daily_profit_label/);
assert.match(app, /vip_principal_daily/);
assert.match(app, /vip_reward_daily/);
assert.strictEqual((i18n.match(/vip_principal_daily:/g) || []).length, 3);
assert.strictEqual((i18n.match(/vip_reward_daily:/g) || []).length, 3);
assert.strictEqual((i18n.match(/vip_plan_daily_profit_label:/g) || []).length, 3);
console.log('PASS — VIP UI contract exposes separate daily principal and reward values');
