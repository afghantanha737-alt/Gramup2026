'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const window = { state: { language: 'fa' } };
vm.runInNewContext(fs.readFileSync(path.join(root, 'public/js/i18n.js'), 'utf8'), { window });

for (const language of ['fa', 'ps', 'en']) {
  window.state.language = language;
  const label = window.t('wallet_points_card_title');
  assert.ok(label && label !== 'Translation unavailable.', `Profile UP balance label must resolve in ${language}`);
}

const app = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/css/style.css'), 'utf8');
const statsMarkup = app.match(/<section class="profilePulseGrid"[\s\S]*?<\/section>/)?.[0] || '';
assert.match(statsMarkup, /<strong>\$\{tokenAmount\(state\.points\)\}<\/strong><span>\$\{t\("wallet_points_card_title"\)\}<\/span>/,
  'the localized UP balance label must sit immediately below its figure');
assert.match(css, /\.profilePulseGrid span \{[^}]*display: block/,
  'the Profile stats label must render as a separate line below the amount');

console.log('PASS — Profile UP balance label resolves in Dari, Pashto, and English and renders beneath its figure');
