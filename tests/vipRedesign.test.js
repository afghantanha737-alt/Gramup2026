'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/css/style.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');

assert.match(app, /function vipLiveUnclaimed\(subscription, now = Date\.now\(\) \+ Number\(state\.vipServerOffsetMs \|\| 0\)\)/);
assert.match(app, /estimatedUnclaimedPoints/);
assert.match(app, /dailyMiningRatePoints/);
assert.match(app, /data-vip-unclaimed-total/);
assert.match(app, /data-vip-live-days=/);
assert.match(app, /vip_claim_wallet/);
assert.match(app, /vip_settlement_ready/);
assert.match(app, /plan\.totalReceivedPoints/);
const heroStart = app.indexOf('<section class="vipHero vipMiningHero"');
const heroEnd = app.indexOf('</section>', heroStart);
const heroMarkup = app.slice(heroStart, heroEnd);
assert.ok(heroMarkup.indexOf('vipBalanceValue') < heroMarkup.indexOf('vipHeroPlanList'), 'plans follow the live unclaimed balance inside the hero');
assert.ok(heroMarkup.indexOf('vipHeroPlanList') < heroMarkup.indexOf('data-vip-claim-all'), 'Claim immediately follows the compact plan list');
assert.match(app, /class="vipHeroPlanRow"/);
assert.match(app, /class="vipHeroPlanProgress"/);
assert.match(app, /data-vip-progress=/);
assert.match(app, /function vipPlanProgressPercent\(/);
assert.match(app, /class="vipHeroLogo"/);
assert.match(app, /data-vip-live-rate=/);
assert.match(app, /data-vip-live-days=/);
assert.doesNotMatch(app, /vipHeroKicker|vipBalanceLabel|vipHeroMetrics/);
assert.doesNotMatch(app, /vipRunningSection|vipActivePlanRow|data-vip-live-sub=/);
assert.match(app, /onclick="claimAllVipRewards\(\)"/);
assert.match(app, /onclick="purchaseVipPlan\(\$\{planNumber\}\)"/);
assert.match(app, /setVipPlanCategory\('starter'\)/);
assert.match(app, /class="vipPlanAccent"/);
assert.match(app, /class="vipPlanInlineMeta"/);
assert.doesNotMatch(app, /vipPlanFact--cost|vipPlanFact--daily/);
assert.match(app, /class="vipPlanButton/);
assert.match(app, /vipPastPlans/);
assert.match(app, /vip_points_per_day/);
assert.match(css, /\.vipRedesign \.vipPlanCard \{ position: relative; display: grid; grid-template-columns: 1fr/);
assert.match(css, /\.vipRedesign \.vipPlanTabs \{ display: grid; grid-template-columns: repeat\(3/);
assert.match(css, /@media \(max-width: 380px\)/);
assert.match(css, /vipMinerCoin/);
assert.match(css, /vip-orbit-pulse/);
assert.match(css, /vipHeroPlanRow/);
assert.doesNotMatch(css, /vipActivePlanRow/);
const heroRowStyle = css.match(/\.vipRedesign \.vipHeroPlanRow \{([^}]*)\}/)?.[1] || '';
assert.match(heroRowStyle, /padding: 0/);
assert.match(heroRowStyle, /border: 0/);
assert.match(heroRowStyle, /background: transparent/);
assert.match(css, /\.vipRedesign \.vipHeroClaimButton \{[^}]*width: 100%/);
assert.match(css, /\.vipRedesign \.vipHeroPlanProgress \{[^}]*height: 3px/);
assert.match(html, /style\.css\?v=up_v16_20261105_1/);

const window = { state: { language: 'fa' } };
vm.runInNewContext(fs.readFileSync(path.join(root, 'public/js/i18n.js'), 'utf8'), { window });
const keys = [
  'vip_unclaimed_earnings', 'vip_daily_earnings', 'vip_active_plans_heading',
  'vip_no_active_plans', 'vip_no_claimable_rewards', 'vip_plan_daily_label', 'vip_points_per_day',
  'vip_cloud_miner', 'vip_mining_live', 'vip_settlement_ready', 'vip_claim_wallet',
  'vip_live_estimate_note', 'vip_activate', 'vip_payout_breakdown_note'
];
for (const language of ['fa', 'ps', 'en']) {
  window.state.language = language;
  for (const key of keys) {
    const value = window.t(key);
    assert.ok(value && value !== 'Translation unavailable.', `${key} must resolve in ${language}`);
  }
}

console.log('ALL PASS — Cloud Mining dashboard renders backend-sourced totals and localizes live-miner labels');
