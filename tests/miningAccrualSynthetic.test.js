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

const twoHoursAtBaseRate = getMiningState({
  miningLevel: 1,
  miningStorageLevel: 1,
  miningSavedPoints: 0,
  miningLastClaimAt: at('2026-10-31T22:00:00.000Z'),
}, now);
assert.equal(twoHoursAtBaseRate.accumulatedPoints, 40, 'mining accrues at the configured base rate');
assert.equal(twoHoursAtBaseRate.isStorageFull, false);

const legacyNoStart = getMiningState({
  miningLevel: 1,
  miningStorageLevel: 1,
  miningSavedPoints: 0,
  miningLastClaimAt: null,
  createdAt: at('2020-01-01T00:00:00.000Z')
}, now);
assert.equal(legacyNoStart.accumulatedPoints, 0, 'legacy users do not receive retroactive mining');
assert.equal(legacyNoStart.elapsedSeconds, 0, 'missing start anchor has zero mining elapsed time');
assert.equal(legacyNoStart.isStarted, false);

const alreadyStarted = getMiningState({
  miningLevel: 1,
  miningStorageLevel: 1,
  miningSavedPoints: 0,
  miningLastClaimAt: at('2026-10-31T23:00:00.000Z'),
  points: 73
}, now);
assert.equal(alreadyStarted.isStarted, true);
assert.equal(alreadyStarted.miningLastClaimAt, '2026-10-31T23:00:00.000Z');
assert.equal(alreadyStarted.userPoints, 73, 'mining state exposes the persisted UP balance without changing it');

const savedAndCapacity = getMiningState({
  miningLevel: 2,
  miningStorageLevel: 2,
  miningSavedPoints: 10,
  miningLastClaimAt: at('2026-10-31T23:00:00.000Z')
}, now);
assert.equal(savedAndCapacity.accumulatedPoints, 55);
assert.equal(savedAndCapacity.maxStoragePoints, 270);

console.log('PASS — synthetic Mining accrual, base rate, storage cap and legacy no-retroactive contract');
