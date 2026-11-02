'use strict';

const assert = require('node:assert/strict');
process.env.BOT_TOKEN = 'synthetic-test-token';
const { getMiningState } = require('../routes/mining');

const at = (iso) => new Date(iso);
const now = at('2026-11-01T00:00:00.000Z');

const oneHour = getMiningState({
  miningLevel: 1,
  miningStorageLevel: 1,
  miningSavedPoints: 0,
  miningLastClaimAt: at('2026-10-31T23:00:00.000Z'),
  points: 100
}, now);
assert.equal(oneHour.baseRatePerHour, 20);
assert.equal(oneHour.accumulatedPoints, 20);
assert.equal(oneHour.maxStoragePoints, 60);

const boostedThenNormal = getMiningState({
  miningLevel: 1,
  miningStorageLevel: 1,
  miningSavedPoints: 0,
  miningLastClaimAt: at('2026-10-31T22:00:00.000Z'),
  miningBoostExpiresAt: at('2026-10-31T23:00:00.000Z')
}, now);
assert.equal(boostedThenNormal.accumulatedPoints, 60, 'one boosted hour plus one normal hour is capped at 3h storage');
assert.equal(boostedThenNormal.isStorageFull, true);

const legacyNoStart = getMiningState({
  miningLevel: 1,
  miningStorageLevel: 1,
  miningSavedPoints: 0,
  miningLastClaimAt: null,
  createdAt: at('2020-01-01T00:00:00.000Z')
}, now);
assert.equal(legacyNoStart.accumulatedPoints, 0, 'legacy users do not receive retroactive mining');

const savedAndCapacity = getMiningState({
  miningLevel: 2,
  miningStorageLevel: 2,
  miningSavedPoints: 10,
  miningLastClaimAt: at('2026-10-31T23:00:00.000Z')
}, now);
assert.equal(savedAndCapacity.accumulatedPoints, 55);
assert.equal(savedAndCapacity.maxStoragePoints, 270);

console.log('PASS — synthetic Mining accrual, boost, storage cap and legacy no-retroactive contract');
