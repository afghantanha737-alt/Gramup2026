'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const expectedLabels = {
  fa: 'موجودی UP',
  ps: 'د UP موجودي',
  en: 'Available UP'
};

const context = {
  window: { state: { language: 'fa' } },
  state: {
    language: 'fa', user: null, points: 123.45, gramBalance: 0.807,
    invitedCount: 2, totalEarnedPoints: 456.78, level: null
  },
  profileView: 'menu',
  THEME_REGISTRY: {},
  getTelegramUser: () => ({}),
  getInitials: () => 'A',
  escapeHTML: value => String(value ?? ''),
  formatPoints: value => String(value),
  formatNumber: value => String(value),
  tokenAmount: value => String(value)
};
vm.createContext(context);

const i18n = fs.readFileSync(path.join(root, 'public/js/i18n.js'), 'utf8');
vm.runInContext(`${i18n}\nglobalThis.__translations = TRANSLATIONS;`, context);
const app = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
const renderStart = app.indexOf('function renderProfileMenu() {');
const renderEnd = app.indexOf('\nfunction renderProfileAbout()', renderStart);
assert.ok(renderStart >= 0 && renderEnd > renderStart, 'Profile menu renderer must be present');
vm.runInContext(app.slice(renderStart, renderEnd), context);

for (const [language, expectedLabel] of Object.entries(expectedLabels)) {
  context.state.language = language;
  context.window.state.language = language;
  const html = vm.runInContext('renderProfileMenu()', context);
  const stats = html.match(/<section class="profilePulseGrid"[\s\S]*?<\/section>/)?.[0] || '';
  assert.ok(stats.includes(`<strong>123.45</strong><span>${expectedLabel}</span>`),
    `rendered Profile stats must contain ${expectedLabel} directly below the UP figure in ${language}`);
  assert.ok(!stats.includes('Translation unavailable.'),
    `rendered Profile stats must not show the generic missing-translation text in ${language}`);
}

context.state.language = 'en';
context.window.state.language = 'en';
context.__translations.en.wallet_points_card_title = '';
let html = vm.runInContext('renderProfileMenu()', context);
let stats = html.match(/<section class="profilePulseGrid"[\s\S]*?<\/section>/)?.[0] || '';
assert.ok(stats.includes('<strong>123.45</strong><span>Available UP</span>'),
  'blank locale values must use the Profile label fallback');

delete context.__translations.en.wallet_points_card_title;
html = vm.runInContext('renderProfileMenu()', context);
stats = html.match(/<section class="profilePulseGrid"[\s\S]*?<\/section>/)?.[0] || '';
assert.ok(stats.includes('<strong>123.45</strong><span>Available UP</span>'),
  'missing locale keys must use the Profile label fallback');

const indexHtml = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
for (const asset of ['i18n.js', 'app.js', 'maintenanceGate.js', 'readModelCache.js', 'walletConnect.js']) {
  assert.ok(indexHtml.includes(`/js/${asset}?v=up_v9_20261104_2`), `${asset} must use the new cache-busting version`);
}
assert.ok(indexHtml.includes('/css/style.css?v=up_v9_20261104_2'), 'main CSS must use the new asset version');
assert.ok(indexHtml.includes('/css/theme-selector.css?v=up_v9_20261104_2'), 'theme CSS must use the new asset version');

console.log('PASS — Profile stats render translated UP labels beneath the figure in all locales, use fallback on missing/blank keys, and reference cache-busted assets');
