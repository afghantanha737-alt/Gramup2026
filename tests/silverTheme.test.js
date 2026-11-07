'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
const i18n = fs.readFileSync(path.join(root, 'public/js/i18n.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/css/theme-selector.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');

assert.match(app, /silver: Object\.freeze\(\{ labelKey: "theme_silver"/);
assert.match(app, /localStorage\.getItem\(THEME_PERSIST_KEY\) \|\| localStorage\.getItem\(THEME_KEY\)/);
assert.match(app, /const THEME_PERSIST_KEY = "gramup_theme"/);
assert.match(app, /localStorage\.setItem\(THEME_PERSIST_KEY, selected\)/);
assert.match(app, /localStorage\.setItem\(THEME_KEY, selected\)/);
assert.match(html, /localStorage\.getItem\('gramup_theme'\) \|\| localStorage\.getItem\('miniAppTheme'\)/);
assert.match(html, /\['midnight', 'aurora', 'light', 'silver'\]\.includes\(cssTheme\)/);
for (const label of ['نقره‌ای متالیک', 'سپین زر فلزي', 'Silver Metallic']) assert.ok(i18n.includes(label), `missing translation: ${label}`);
for (const selector of [
  'html[data-theme="silver"] body',
  'html[data-theme="silver"] #appHeader',
  'html[data-theme="silver"] .bottomNav',
  'html[data-theme="silver"] #content .mineConsole',
  'html[data-theme="silver"] #content .dailyCheckDay',
  'html[data-theme="silver"] .vipRedesign .vipMiningHero',
  'html[data-theme="silver"] .vipMiningProgressTrack',
  'html[data-theme="silver"] .referralDashboard .rf-hero',
  'html[data-theme="silver"] :is(.profileHeaderCard',
  'html[data-theme="silver"] :is(input, textarea, select'
]) assert.ok(css.includes(selector), `Silver CSS must cover ${selector}`);
assert.doesNotMatch(`${app}\n${html}`, /luckySpinPage|spinWheel|data-tab=["']spin/i,
  'Lucky Spin UI must remain out of scope until its separate module is built');
assert.match(css, /--bg: #d9dfe5/);
assert.match(css, /--text: #0f172a/);
assert.match(css, /background: linear-gradient\(145deg, rgba\(250,251,252/);
assert.match(html, /theme-selector\.css\?v=up_v34_vip_miner_progress_20261107/);
assert.match(html, /i18n\.js\?v=up_v35_vip_miner_progress_20261107/);
assert.match(html, /app\.js\?v=up_v35_vip_miner_progress_20261107/);

console.log('PASS — Silver Metallic theme is selectable, persisted across reloads, localized, and styled across key app sections');
