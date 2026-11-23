'use strict';

const assert = require('assert');
const { createBoundedTtlCache } = require('../utils/boundedTtlCache');

let clock = 1000;
const cache = createBoundedTtlCache({
  maxEntries: 2,
  ttlMs: 45_000,
  sweepEvery: 1,
  now: () => clock
});

const first = { success: true, user: 'first' };
assert.strictEqual(cache.set('first', first), first);
cache.set('second', { success: true, user: 'second' });
assert.strictEqual(cache.get('first'), first, 'a cache hit returns the original response object');
cache.set('third', { success: true, user: 'third' });
assert.strictEqual(cache.size, 2, 'cache size stays at its configured maximum');
assert.strictEqual(cache.get('second'), null, 'least-recently-used entry is evicted first');
assert.deepStrictEqual(cache.get('third'), { success: true, user: 'third' });

clock += 45_000;
assert.strictEqual(cache.get('first'), null, 'entries expire at their TTL boundary');
assert.strictEqual(cache.size, 0, 'opportunistic sweep removes other expired entries too');

cache.set('replace', { version: 1 });
cache.set('replace', { version: 2 });
assert.deepStrictEqual(cache.get('replace'), { version: 2 }, 'setting an existing key replaces its payload');
assert.strictEqual(cache.delete('replace'), true);
assert.strictEqual(cache.size, 0);

assert.throws(() => createBoundedTtlCache({ maxEntries: 0, ttlMs: 100 }), /maxEntries/);
assert.throws(() => createBoundedTtlCache({ maxEntries: 1, ttlMs: 0 }), /ttlMs/);

console.log('ALL PASS — bounded TTL/LRU response cache');
