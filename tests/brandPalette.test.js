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
assert.match(app, /background:radial-gradient\(circle at 85% 0%,var\(--brand-accent-glow\),transparent 34%\)/,
  'the Mine dashboard surface must use the shared accent instead of purple');
assert.match(css, /\.appContent \.vipRedesign \.vipHero \{[\s\S]*?border-color: var\(--brand-accent-border\);\s*background: radial-gradient\(circle at 100% 0%, var\(--brand-accent-glow\)/,
  'the Mine hero must override the higher-specificity legacy purple gradient');
assert.match(app, /const planIconMarkup = '<svg[\s\S]*?stroke="currentColor"/,
  'Mine plan-card icons must inherit the unified accent instead of using yellow emoji');
assert.match(app, /class="vipPlanMark">\$\{planIconMarkup\}/,
  'Mine plan cards must render the accent-colored SVG icon');
assert.match(app, /const boltIcon = '<svg[\s\S]*?const diamondIcon = '<svg[\s\S]*?class="phase3StarsCard" onclick=/,
  'Mine Stars shop icons must be SVGs rather than platform-colored emoji');
assert.match(css, /\.vipRedesign \.vipPlanMark svg \{[^}]*color: inherit; stroke: currentColor;/,
  'Mine plan SVG icons must use the plan badge accent color');
assert.match(css, /\.appContent \.vipRedesign \.phase3VaultBar span \{ background: linear-gradient\(90deg, var\(--brand-accent-strong\), var\(--brand-accent\)\); \}/,
  'Mine vault progress must not introduce a separate violet accent');

assert.ok(html.includes('/css/style.css?v=up_v28_20261106_2'), 'style.css must use the winners ticker cache version');
assert.ok(html.includes('/css/theme-selector.css?v=up_v28_20261105_2'), 'theme-selector.css must use the fresh cache version');
for (const asset of ['maintenanceGate.js', 'readModelCache.js', 'walletConnect.js']) {
  assert.ok(html.includes(`/js/${asset}?v=up_v28_20261105_2`), `${asset} must use the fresh cache version`);
}
assert.ok(html.includes('/js/i18n.js?v=up_v28_20261106_2'), 'i18n.js must use the winners ticker cache version');
assert.ok(html.includes('/js/app.js?v=up_v28_20261106_2'), 'app.js must use the winners ticker cache version');
assert.ok(html.includes('/js/gamification.js?v=up_v28_20261106_1'), 'gamification.js must use the current Spinner feedback cache version');

console.log('PASS — unified cyan/teal brand palette covers shared controls, Home stats, Mine plan tiers, and cache-busted assets');
