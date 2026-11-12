'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'public/css/style.css'), 'utf8');
const themeCss = fs.readFileSync(path.join(root, 'public/css/theme-selector.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');

assert.match(css, /--primary:\s*#8b5cf6/,
  'dark mode must use the current Gramup purple primary');
assert.match(css, /html\[data-theme="light"\]\s*\{[^}]*--primary:\s*#7c3aed/,
  'light mode must use the current accessible purple primary');
assert.match(themeCss, /html\[data-theme="silver"\]\s*\{[\s\S]*?--primary:\s*#0f766e/,
  'the Silver theme must use its current teal primary');
assert.match(themeCss, /html\[data-theme="light"\] body \{[\s\S]*?radial-gradient\([^;]+\),[\s\S]*?var\(--bg\);\s*\}/,
  'light mode must provide an actual light background');
assert.match(css, /\.brandName span \{ color: #7c3aed; \}/,
  'the Gram/up wordmark must use the current brand color');
assert.match(css, /\.vipHeroBrand strong span \{ color: #c4b5fd; \}/,
  'the Mine hero wordmark must use the current light accent');

const statsStart = app.indexOf('<div class="tbStats">');
const statsEnd = app.indexOf('\n    <section class="auroraTaskPreview">', statsStart);
assert.ok(statsStart >= 0 && statsEnd > statsStart, 'Home progress stats markup must exist');
const homeStats = app.slice(statsStart, statsEnd);
assert.strictEqual((homeStats.match(/class="tbStatIcon(?:\s|\")/g) || []).length, 3,
  'Home earned, invite, and task cards must use the shared icon base class');
assert.match(homeStats, /tbIconMint/);
assert.match(homeStats, /tbIconOrange/);
assert.match(homeStats, /tbIconPurple/);
assert.match(css, /\.tbIconMint \{ background: #d1fae5;/,
  'Home earned icon must use the current mint treatment');
assert.match(css, /\.auroraQuickDeposit \.auroraQuickIcon \{ background: linear-gradient\(135deg, #00d2ff, #2f80ed\); \}/,
  'Home deposit action must use the current blue treatment');
assert.match(css, /\.tbColGreen \{ color: #059669; \} \.tbColOrange \{ color: #d97706; \} \.tbColPurple \{ color: #7c3aed; \}/,
  'Home labels must use the current readable semantic colors');
assert.match(css, /\.tbStat \{ background: var\(--tb-card\);[\s\S]*?box-shadow: var\(--tb-card-shadow\); \}/,
  'Home stats must use the current shared card surface');
assert.match(css, /html\[data-theme="light"\] \.bottomNav button\.active \{ color: #5a4bdd; \}/,
  'the selected light-theme tab must remain legible');

assert.match(css, /#content \.vipRedesign \.vipPlanButton--primary\{[^}]*background:linear-gradient\(110deg,#78f0dc,#36d6c4 58%,#20b9ad\)/,
  'Mine plan purchase buttons must use the current teal gradient');
assert.match(css, /\.vipRedesign \.vipPlanCard--bronze \.vipPlanButton--primary \{ background: linear-gradient\(135deg, #8c6239, #e0a96d\);/,
  'Mine bronze tier must use its current tier treatment');
assert.match(css, /#content \.vipRedesign \.vipTierTab\[aria-selected="true"\]\{[^}]*background:linear-gradient\(145deg,rgba\(45,212,191/,
  'selected Mine category tabs must use the current teal treatment');
assert.match(app, /class="mineConsole"/, 'Mine must render the Gramup mining console');
assert.match(app, /class="mineLiveAmount"/, 'Mine must render a live earnings counter');
assert.match(app, /class="mineProgressTrack"/, 'Mine must render the cycle progress track');
assert.match(app, /class="mineMetrics"/, 'Mine must render the speed and tier metrics');
assert.match(app, /class="mineSessionCard"/, 'Mine must render active boosts and session history');
assert.match(css, /\.mineConsole\{display:grid;gap:14px;min-width:0;\}/,
  'the Mine dashboard must use the current responsive console layout');
assert.match(css, /\.mineProgressFill\{[^}]*background:linear-gradient\(90deg,#14b8a6,#35d7c8 65%,#8be9df\)/,
  'Mine progress must use the current teal dashboard gradient');

assert.ok(html.includes('css/style.css?v=miners_display_v1_20261112'), 'style.css must use the current dashboard cache version');
assert.ok(html.includes('css/theme-selector.css?v=up_v36_vip_signature_20261107'), 'theme-selector.css must use the Silver theme cache version');
for (const [asset, version] of Object.entries({
  maintenanceGate: '20261006-maintenance',
  readModelCache: '20261030-read-model-1',
  walletConnect: 'ad_ui_v3_20261109'
})) {
  assert.ok(html.includes(`js/${asset}.js?v=${version}`), `${asset} must use its current cache version`);
}
assert.ok(html.includes('js/i18n.js?v=miners_display_v1_20261112'), 'i18n.js must use the VIP0 locale cache version');
assert.ok(html.includes('js/app.js?v=miners_display_v1_20261112'), 'app.js must use the VIP0 UI cache version');
assert.doesNotMatch(html, /gamification\.js|spinCelebration\.js/, 'unbuilt Lucky Spin scripts must remain unloaded');

console.log('PASS — unified cyan/teal brand palette covers shared controls, Home stats, Mine plan tiers, and cache-busted assets');
