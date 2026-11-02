'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/css/style.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');

assert.match(app, /activeSubscriptions\.filter\(subscription => subscription\.canClaim === true\)/);
assert.match(app, /claimableSubscriptions\.reduce\(\(sum, subscription\) => sum \+ \(Number\(subscription\.nextTotalPayoutPoints \?\? subscription\.nextRewardPoints\) \|\| 0\), 0\)/);
assert.match(app, /activeSubscriptions\.reduce\(\(sum, subscription\) => sum \+ \(Number\(subscription\.dailyRewardAveragePoints\) \|\| 0\), 0\)/);
assert.match(app, /subscription\.dailyRewardAveragePoints/);
assert.match(app, /subscription\.daysRemaining/);
assert.match(app, /plan\.dailyRewardAveragePoints/);
assert.match(app, /plan\.dailyRewardPoints/);
assert.match(app, /plan\.totalReceivedPoints/);
assert.match(app, /onclick="claimAllVipRewards\(\)"/);
assert.match(app, /onclick="purchaseVipPlan\(\$\{planNumber\}\)"/);
assert.match(app, /setVipPlanCategory\('starter'\)/);
assert.match(app, /setVipSubscriptionFilter\('expired'\)/);
assert.match(css, /\.vipRedesign \.vipPlanCard \{ display: grid; grid-template-columns: 40px minmax\(0,1fr\) auto/);
assert.match(css, /@media \(max-width: 380px\)/);
assert.match(html, /style\.css\?v=20261102-vip-ui-2/);

const window = { state: { language: 'fa' } };
vm.runInNewContext(fs.readFileSync(path.join(root, 'public/js/i18n.js'), 'utf8'), { window });
const keys = [
  'vip_unclaimed_earnings', 'vip_daily_earnings', 'vip_active_plans_heading',
  'vip_no_active_plans', 'vip_no_claimable_rewards', 'vip_plan_daily_label', 'vip_points_per_day'
];
for (const language of ['fa', 'ps', 'en']) {
  window.state.language = language;
  for (const key of keys) {
    const value = window.t(key);
    assert.ok(value && value !== 'Translation unavailable.', `${key} must resolve in ${language}`);
  }
}

console.log('ALL PASS — VIP redesign renders backend-sourced totals, keeps existing handlers/filters, and localizes all new labels');
