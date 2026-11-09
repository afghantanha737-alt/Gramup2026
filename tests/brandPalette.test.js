'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'public/css/style.css'), 'utf8');
const themeCss = fs.readFileSync(path.join(root, 'public/css/theme-selector.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');

assert.match(css, /--brand-accent:\s*#35d7c8/,
  'dark mode must use the Gramup cyan/teal accent');
assert.match(css, /html\[data-theme="light"\]\s*\{[^}]*--brand-accent:\s*#0f766e/,
  'light mode must use an accessible darker cyan/teal accent');
assert.match(css, /--primary:\s*var\(--brand-accent\)/,
  'the shared primary token must resolve to the single brand accent');
assert.match(css, /--product-brand:\s*var\(--brand-accent-text\)/,
  'product controls must use the same accent family');
assert.match(themeCss, /--primary:\s*var\(--brand-accent\)/,
  'the later-loaded theme selector must not restore a separate purple primary');
assert.match(themeCss, /html\[data-theme="light"\] body \{\s*color: var\(--text\)(?: !important)?;\s*background-color: var\(--bg\)(?: !important)?;/,
  'light mode must provide a readable body color and actual light background');
assert.match(css, /\.brandName span,[\s\S]*?\.vipHeroBrand strong span \{ color: inherit !important; \}/,
  'the split Gram/up wordmark must display in one uniform color');

const statsStart = app.indexOf('<div class="tbStats">');
const statsEnd = app.indexOf('\n    </div>', statsStart);
assert.ok(statsStart >= 0 && statsEnd > statsStart, 'Home progress stats markup must exist');
const homeStats = app.slice(statsStart, statsEnd);
assert.strictEqual((homeStats.match(/class="tbStatIcon"/g) || []).length, 3,
  'Home earned, invite, and task cards must use the same icon class');
assert.doesNotMatch(homeStats, /tbIconMint|tbIconOrange|tbIconPurple|tbColGreen|tbColOrange|tbColPurple/,
  'Home progress cards must not carry per-card accent colors');
assert.match(css, /\.tbStatIcon, \.tbIconMint, \.tbIconOrange, \.tbIconPurple \{[\s\S]*?background: var\(--brand-accent-soft\)/,
  'all Home stat icons must share the brand accent treatment');
assert.match(css, /\.auroraQuickDeposit \.auroraQuickIcon,[\s\S]*?\.auroraQuickReferral \.auroraQuickIcon \{[\s\S]*?color: var\(--brand-accent-text\)/,
  'all Home quick-action icons must share the same accent');
assert.match(css, /\.tbStatLabel, \.tbColGreen, \.tbColOrange, \.tbColPurple \{ color: var\(--text-soft\); \}/,
  'Home labels must use one legible neutral text color');
assert.match(css, /html\[data-theme="light"\] \.tbStat \{\s*color: var\(--text\);[\s\S]*?background: #ffffff;/,
  'light-mode Home stats must switch to a high-contrast light card');
assert.match(css, /html\[data-theme="light"\] \.bottomNav button\.active \.tabLabel \{\s*color: var\(--brand-accent\) !important;/,
  'the selected tab label must remain legible and use the light-theme accent');

assert.match(css, /\.vipRedesign \.vipPlanCard \.vipPlanButton--primary \{\s*color: var\(--brand-accent-ink\);\s*background: var\(--tb-grad\)/,
  'Mine plan purchase buttons must use the unified primary accent');
assert.match(css, /\.vipRedesign \.vipPlanCard--bronze::before,[\s\S]*?\.vipRedesign \.vipPlanCard--ultimate::before \{ background: linear-gradient\(180deg, var\(--brand-accent-strong\), var\(--brand-accent\)\); \}/,
  'Mine plan tiers must share the same accent strip rather than random tier colors');
assert.match(css, /\.vipRedesign \.vipTierTab\[aria-selected="true"\][\s\S]*?background: var\(--brand-accent-soft\)/,
  'selected Mine category tabs must use the brand accent');
assert.match(app, /class="mineConsole"/, 'Mine must render the Gramup mining console');
assert.match(app, /class="mineCounter"/, 'Mine must render a live earnings counter');
assert.match(app, /class="mineProgressTrack"/, 'Mine must render the cycle progress track');
assert.match(app, /class="mineMetrics"/, 'Mine must render the speed and tier metrics');
assert.match(app, /class="mineSessionCard"/, 'Mine must render active boosts and session history');
assert.match(css, /\.mineConsole \{[^}]*background:radial-gradient\(circle at 92% 2%,rgba\(34,211,238/, 
  'the Mine dashboard surface must use Gramup cyan/neon branding');
assert.match(css, /\.mineProgressTrack span \{[^}]*background:linear-gradient\(90deg,#22d3ee/, 
  'Mine progress must use cyan, violet and gold dashboard accents');

assert.ok(html.includes('css/style.css?v=ad_ui_v3_20261109'), 'style.css must use the current dashboard cache version');
assert.ok(html.includes('css/theme-selector.css?v=up_v36_vip_signature_20261107'), 'theme-selector.css must use the Silver theme cache version');
for (const [asset, version] of Object.entries({
  maintenanceGate: '20261006-maintenance',
  readModelCache: '20261030-read-model-1',
  walletConnect: 'ad_ui_v3_20261109'
})) {
  assert.ok(html.includes(`js/${asset}.js?v=${version}`), `${asset} must use its current cache version`);
}
assert.ok(html.includes('js/i18n.js?v=vip0_free_miner_20261109'), 'i18n.js must use the VIP0 locale cache version');
assert.ok(html.includes('js/app.js?v=vip0_free_miner_20261109'), 'app.js must use the VIP0 UI cache version');
assert.doesNotMatch(html, /gamification\.js|spinCelebration\.js/, 'unbuilt Lucky Spin scripts must remain unloaded');

console.log('PASS — unified cyan/teal brand palette covers shared controls, Home stats, Mine plan tiers, and cache-busted assets');
