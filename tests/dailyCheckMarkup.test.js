'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/css/style.css'), 'utf8');
const index = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');

const rendererStart = app.indexOf('function renderDailyCheckinCard()');
const rendererEnd = app.indexOf('\nasync function doCheckIn()', rendererStart);
assert.ok(rendererStart >= 0 && rendererEnd > rendererStart, 'Daily Check renderer must exist');
const renderer = app.slice(rendererStart, rendererEnd);

assert.match(renderer, /const rewardLabel = `\+\$\{formatPoints\(reward\)\} UP`/);
assert.ok(renderer.includes('class="dailyCheckReward" aria-label="${rewardLabel}"'));
assert.ok(renderer.includes('<span>${rewardLabel}</span><img'));
assert.doesNotMatch(renderer, /aria-label="\+\$\{tokenAmount\(reward\)\} UP/);
for (const reward of [5, 7, 9, 11, 13, 14, 15]) {
  assert.match(renderer, new RegExp(`\\+\\$\\{formatPoints\\(reward\\)\\} UP`));
  assert.ok(renderer.includes('DAILY_CHECKIN_REWARDS'));
}

assert.match(css, /\.dailyCheckGrid\{display:grid;grid-template-columns:repeat\(7/);
assert.match(css, /\.dailyCheckDay\{[^}]*border-radius:16px/);
assert.match(css, /\.dailyCheckDay\.is-complete\{/);
assert.match(css, /\.dailyCheckDay\.is-current\{/);
assert.match(index, /style\.css\?v=up_v37_vip_history_20261107/);
assert.match(index, /i18n\.js\?v=up_v36_vip_history_20261107/);
assert.match(index, /app\.js\?v=up_v40_audit_perf_20261108/);

console.log('PASS — Daily Check rewards use plain +N UP labels, safe markup, seven-card layout, and fresh asset versions');
