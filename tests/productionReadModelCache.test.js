'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const CacheFactory = require('../public/js/readModelCache.js');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const i18n = fs.readFileSync(path.join(root, 'public/js/i18n.js'), 'utf8');

function makeStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] || null; },
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); },
    dump() { return Object.fromEntries(values); }
  };
}

let now = 1_000_000;
const storage = makeStorage();
const sessionStorage = makeStorage();
const cache = CacheFactory({ storage, sessionStorage, ttlMs: 1_000, now: () => now });
const safeModel = {
  profile: { points: 42, gramBalance: 1.25, firstName: 'A', level: { badge: '🥇', name: 'Gold' } },
  tasks: {
    tasks: [{ _id: 'task-a', title: 'Task A', reward: 5, url: 'https://example.test' }],
    completions: [{ task: 'task-a', status: 'approved' }],
    latestPostStates: [],
    serverNow: now
  }
};

assert.strictEqual(cache.activate('100'), true);
assert.strictEqual(cache.write('100', safeModel), true);
assert.deepStrictEqual(cache.read('100').profile.points, 42);
assert.strictEqual(cache.read('200'), null, 'a different verified user cannot read user 100 cache');
const raw = storage.getItem(cache.keyFor('100'));
assert.ok(raw && !/initData|token|private.?key|secret/i.test(raw), 'cache contains no authentication material');

cache.activate('200');
assert.strictEqual(cache.read('100'), null, 'account switch invalidates the previous active user cache');
assert.strictEqual(cache.write('200', safeModel), true);
now += 1_001;
assert.strictEqual(cache.read('200'), null, 'expired read model is removed and never used');

cache.write('200', safeModel, now);
storage.setItem(cache.keyFor('200'), '{not valid json');
assert.strictEqual(cache.read('200'), null, 'corrupt cache is rejected and cleared');
assert.strictEqual(storage.getItem(cache.keyFor('200')), null);

cache.write('200', safeModel, now);
cache.deactivate();
assert.strictEqual(cache.read('200'), null, 'logout/deactivation clears all cached user data');

// Contract checks: auth precedes hydration; refresh is forced/background; mutations are guarded.
assert.ok(index.indexOf('js/readModelCache.js') < index.indexOf('js/app.js'), 'cache script loads before app');
assert.match(app, /await hydrateReadModelAfterAuth\(\)/);
assert.match(app, /void refreshReadModelInBackground\(\)/);
assert.match(app, /loadUserData\(\{ force: true \}\)/);
assert.match(app, /loadTasks\(\{ force: true \}\)/);
assert.match(app, /function invalidateReadModelCache\(\)/);
assert.match(app, /if \(error\?\.authFailure \|\| error\?\.status === 401 \|\| error\?\.status === 403\) invalidateReadModelCache\(\)/);
assert.match(app, /function readModelActionAllowed\(\)/);
assert.match(app, /#submitWithdraw/);
assert.match(app, /dataset\.readModelState/);
assert.match(index, /data-read-model-state="fresh"/);
assert.match(i18n, /read_model_refreshing:/);

console.log('PASS — production read-model cache isolation, expiry, corruption, logout, refresh, and DOM contracts');
