'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/css/style.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');

// Existing VIP settlement mechanics remain available to the backend/UI helpers.
assert.match(app, /function vipLiveUnclaimed\(subscription, now = Date\.now\(\) \+ Number\(state\.vipServerOffsetMs \|\| 0\)\)/);
assert.match(app, /estimatedUnclaimedPoints/);
assert.match(app, /dailyMiningRatePoints/);
assert.match(app, /function vipPlanProgressPercent\(/);
assert.match(app, /claimAllVipRewards/);

// Mine is now the primary console: no plan-card store is rendered on the page.
assert.match(app, /function renderMiningPanel\(\)/);
assert.match(app, /class="mineConsole"/);
assert.match(app, /data-mine-earned/);
assert.match(app, /data-mine-progress/);
assert.match(app, /data-mine-countdown/);
assert.match(app, /class="mineMetrics"/);
assert.match(app, /class="mineSessionCard"/);
assert.match(app, /onclick="claimMining\(\)"/);
assert.match(app, /buyStarsProduct\('hash_boost_7d'\)/);
assert.doesNotMatch(app, /phase3StarsShop/);
assert.doesNotMatch(app, /<section class="vipCatalog"/);
assert.match(css, /\.mineConsole/);
assert.match(css, /\.mineProgressTrack/);
assert.match(css, /\.mineSessionCard/);
assert.match(css, /html\[data-theme="silver"\] \.mineConsole/);
assert.match(html, /up_v28_20261106_3/);
console.log('ALL PASS — Mine console, live counter, claim/boost wiring, session summary and Silver theme contract');
