'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const expectedLabels = {
  fa: 'موجودی قابل استفاده',
  ps: 'د کارولو وړ بیلانس',
  en: 'Available Balance'
};
const expectedEarnedLabels = {
  fa: 'کسب‌شده',
  ps: 'ترلاسه شوي',
  en: 'EARNED'
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
  const leftCard = stats.match(/<div><strong>123\.45[\s\S]*?<\/div>/)?.[0] || '';
  assert.ok(leftCard.includes(`<strong>123.45</strong><small class="profilePulseUnit">UP</small><span>${expectedLabel}</span>`),
    `rendered balance card must show its amount, one UP unit, then ${expectedLabel} in ${language}`);
  assert.strictEqual((leftCard.match(/>UP</g) || []).length, 1,
    `balance label must not repeat UP in ${language}`);
  assert.ok(stats.includes(`<strong>456.78</strong><small class="profilePulseUnit">UP</small><span>${expectedEarnedLabels[language]}</span>`),
    `earned card must follow the same amount / UP / label order in ${language}`);
  assert.ok(!stats.includes('Translation unavailable.'),
    `rendered Profile stats must not show generic missing-translation text in ${language}`);
}

context.state.language = 'en';
context.window.state.language = 'en';
context.__translations.en.wallet_points_card_title = '';
let html = vm.runInContext('renderProfileMenu()', context);
let stats = html.match(/<section class="profilePulseGrid"[\s\S]*?<\/section>/)?.[0] || '';
assert.ok(stats.includes('<strong>123.45</strong><small class="profilePulseUnit">UP</small><span>Available Balance</span>'),
  'blank locale values must use the clean balance-label fallback');

delete context.__translations.en.wallet_points_card_title;
html = vm.runInContext('renderProfileMenu()', context);
stats = html.match(/<section class="profilePulseGrid"[\s\S]*?<\/section>/)?.[0] || '';
assert.ok(stats.includes('<strong>123.45</strong><small class="profilePulseUnit">UP</small><span>Available Balance</span>'),
  'missing locale keys must use the clean balance-label fallback');

const css = fs.readFileSync(path.join(root, 'public/css/style.css'), 'utf8');
assert.match(css, /\.profileOverviewCard\s*\{[^}]*display:\s*grid/,
  'profile header must reserve a distinct grid column for the balance');
assert.match(css, /\.profileBalanceMini\s*\{[^}]*position:\s*static/,
  'profile balance must not float over the Gold rank badge');
assert.match(css, /@media \(max-width: 420px\) \{[\s\S]*?\.profileBalanceMini \{[^}]*grid-column: 1 \/ -1/,
  'narrow screens must place the balance on its own row');
assert.match(css, /\.profilePulseGrid \.profilePulseUnit\s*\{[^}]*display:\s*block/,
  'UP must render as its own line in the stats cards');

const indexHtml = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
for (const asset of ['i18n.js', 'app.js', 'maintenanceGate.js', 'readModelCache.js', 'walletConnect.js']) {
  assert.ok(indexHtml.includes(`/js/${asset}?v=up_v9_20261104_3`), `${asset} must use the latest cache-busting version`);
}
assert.ok(indexHtml.includes('/css/style.css?v=up_v9_20261104_3'), 'main CSS must use the latest asset version');
assert.ok(indexHtml.includes('/css/theme-selector.css?v=up_v9_20261104_3'), 'theme CSS must use the latest asset version');

console.log('PASS — Profile balance renders amount / UP / translated available-balance label; earned card is symmetric and header balance is reserved without overlap');
