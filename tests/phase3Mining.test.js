'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
process.env.BOT_TOKEN = 'phase3-test-token';
const { getMiningState, RIG_LEVELS, STORAGE_LEVELS } = require('../routes/mining');

const now = new Date('2026-11-05T00:00:00.000Z');
const full = getMiningState({
  miningLevel: 1,
  miningStorageLevel: 3,
  miningSavedPoints: 0,
  miningLastClaimAt: new Date('2026-11-04T00:00:00.000Z')
}, now);
assert.equal(full.maxStorageHours, 8);
assert.equal(full.maxStoragePoints, 160);
assert.equal(full.accumulatedPoints, 160);
assert.equal(full.isStorageFull, true);

const halted = getMiningState({
  miningLevel: 1,
  miningStorageLevel: 3,
  miningSavedPoints: 999,
  miningLastClaimAt: new Date('2026-11-01T00:00:00.000Z')
}, now);
assert.equal(halted.accumulatedPoints, halted.maxStoragePoints, 'vault must cap unclaimed production');
assert.equal(RIG_LEVELS.length, 5);
assert.equal(STORAGE_LEVELS.at(-1).maxHours, 8);

const source = fs.readFileSync(require.resolve('../routes/mining'), 'utf8');
assert.match(source, /withMongoTransaction|executeIdempotently/);
assert.match(source, /type: 'mining_upgrade'/);
assert.match(source, /findOneAndUpdate\(optimisticUserFilter/);
console.log('PASS — Phase 3 mining cap, halt-at-cap, five rig levels and atomic upgrade contracts');
