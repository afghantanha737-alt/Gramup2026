'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const i18nSource = fs.readFileSync(path.join(root, 'public/js/i18n.js'), 'utf8');
const context = { window: { state: { language: 'en' } } };
vm.createContext(context);
vm.runInContext(`${i18nSource}\nglobalThis.__translations = TRANSLATIONS; globalThis.__translate = t;`, context);
const translations = context.__translations;
const locales = ['fa', 'ps', 'en'];
const referenceKeys = Object.keys(translations.en).sort();

for (const locale of locales) {
  assert.deepStrictEqual(Object.keys(translations[locale]).sort(), referenceKeys,
    `${locale} must have exactly the same translation keys as English`);
  for (const [key, value] of Object.entries(translations[locale])) {
    assert.strictEqual(typeof value, 'string', `${locale}.${key} must be a string`);
    assert.ok(value.trim(), `${locale}.${key} must not be blank`);
    const placeholders = [...value.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map(match => match[1]).sort();
    const referencePlaceholders = [...translations.en[key].matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map(match => match[1]).sort();
    assert.deepStrictEqual(placeholders, referencePlaceholders,
      `${locale}.${key} must preserve English interpolation placeholders`);
  }
}

const uiFiles = [
  'public/index.html',
  'public/js/app.js',
  'public/js/gamification.js',
  'public/js/walletConnect.js'
];
const uiKeys = new Set();
const keyPatterns = [
  /\bdata-i18n(?:-(?:html|ph|aria))?=["']([^"']+)["']/g,
  /\bt\(\s*["']([^"']+)["']/g
];
for (const relativePath of uiFiles) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  for (const pattern of keyPatterns) {
    for (const match of source.matchAll(pattern)) uiKeys.add(match[1]);
  }
}
for (const key of uiKeys) {
  for (const locale of locales) {
    assert.ok(Object.hasOwn(translations[locale], key),
      `Main UI references missing translation ${locale}.${key}`);
  }
}

// This label covers both GRAM and USDT deposit history rows.
for (const locale of locales) {
  assert.doesNotMatch(translations[locale].history_type_deposit, /\b(?:USDT|GRAM)\b/i,
    `${locale} deposit history type must stay asset-neutral`);
  assert.ok(translations[locale].task_submission_rejected.trim(),
    `${locale} must explain a rejected proof submission`);
}

// The runtime passes {source, points}; every locale must consume both values.
for (const locale of locales) {
  context.window.state.language = locale;
  const rendered = context.__translate('referral_history_source_earned', { source: 'Task', points: '5' });
  assert.ok(rendered.includes('Task') && rendered.includes('5'),
    `${locale} referral history must render its source and earned amount`);
  assert.doesNotMatch(rendered, /\{[^{}]+\}/,
    `${locale} referral history must not leak an unresolved placeholder`);
}

console.log(`PASS — ${locales.length} locales, ${referenceKeys.length} catalog keys, ${uiKeys.size} UI references, placeholders, deposit and review copy`);
