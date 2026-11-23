'use strict';

function createBoundedTtlCache({ maxEntries, ttlMs, sweepEvery = 32, now = Date.now }) {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
    throw new TypeError('maxEntries must be a positive safe integer.');
  }
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new TypeError('ttlMs must be a positive finite number.');
  }
  if (!Number.isSafeInteger(sweepEvery) || sweepEvery < 1) {
    throw new TypeError('sweepEvery must be a positive safe integer.');
  }
  if (typeof now !== 'function') {
    throw new TypeError('now must be a function.');
  }

  const entries = new Map();
  let operationCount = 0;

  function sweepExpired(currentTime) {
    operationCount += 1;
    if (operationCount % sweepEvery !== 0) return;
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= currentTime) entries.delete(key);
    }
  }

  return {
    get(key) {
      const cacheKey = String(key);
      const currentTime = now();
      sweepExpired(currentTime);
      const entry = entries.get(cacheKey);
      if (!entry) return null;
      if (entry.expiresAt <= currentTime) {
        entries.delete(cacheKey);
        return null;
      }
      entries.delete(cacheKey);
      entries.set(cacheKey, entry);
      return entry.payload;
    },

    set(key, payload) {
      const cacheKey = String(key);
      const currentTime = now();
      sweepExpired(currentTime);
      if (entries.has(cacheKey)) {
        entries.delete(cacheKey);
      } else if (entries.size >= maxEntries) {
        const oldestKey = entries.keys().next().value;
        if (oldestKey !== undefined) entries.delete(oldestKey);
      }
      entries.set(cacheKey, { expiresAt: currentTime + ttlMs, payload });
      return payload;
    },

    delete(key) {
      return entries.delete(String(key));
    },

    clear() {
      entries.clear();
    },

    get size() {
      return entries.size;
    }
  };
}

module.exports = { createBoundedTtlCache };
