'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const bundle = fs.readFileSync(path.join(root, 'public/js/readModelCache.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
// Execute the actual top-level integration, not the CommonJS test factory.
const startup = app.slice(0, app.indexOf('/* ================= DOM HELPERS'));
function storage() {
  const data = new Map();
  return { get length() { return data.size; }, key: n => [...data.keys()][n] || null,
    getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key) };
}
function environment() {
  const context = { localStorage: storage(), sessionStorage: storage(), console, TextEncoder,
    document: { addEventListener() {} } };
  context.window = context;
  return vm.createContext(context);
}
const browser = environment();
vm.runInContext(bundle, browser, { filename: 'readModelCache.browser.js' });
assert.strictEqual(typeof browser.GramupReadModelCache, 'object', 'browser export is an instance, unlike CommonJS export');
assert.doesNotThrow(() => vm.runInContext(startup, browser, { filename: 'app.startup.js' }));
assert.strictEqual(browser.gramupReadModelCache, browser.GramupReadModelCache);
assert.strictEqual(browser.gramupReadModelCache.ttlMs, 120000);
assert.strictEqual(browser.gramupReadModelCache.activate('qa-user'), true);
assert.strictEqual(browser.gramupReadModelCache.write('qa-user', { profile: { points: 5 }, tasks: {} }), true);
assert.strictEqual(browser.gramupReadModelCache.read('qa-user').profile.points, 5);
assert.strictEqual(browser.state.initialized, false, 'cache initialization never bypasses auth or financial gates');
assert.strictEqual(browser.state.financialDataConfirmed, false);
assert.strictEqual(browser.state.membershipDataConfirmed, false);
for (const badExport of [undefined, {}, 'bad-module']) {
  const fallback = environment();
  fallback.GramupReadModelCache = badExport;
  assert.doesNotThrow(() => vm.runInContext(startup, fallback));
  assert.strictEqual(fallback.gramupReadModelCache, null, 'optional absent/malformed cache cannot prevent boot registration');
}
console.log('PASS — actual browser cache export integrates with app startup; absent cache is nonfatal and auth/membership/financial gates remain closed');
