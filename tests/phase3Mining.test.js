'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
process.env.BOT_TOKEN = 'phase3-test-token';
const { getMiningState, RIG_LEVELS, STORAGE_LEVELS } = require('../routes/mining');

const now = new Date('2026-11-05T00:00:00.000Z');
const full = getMiningState({
  miningLevel: 1,
  miningStorageLevel: 6,
  miningSavedPoints: 0,
  miningLastClaimAt: new Date('2026-11-01T00:00:00.000Z'),
  points: 37
}, now);
assert.equal(full.maxStorageHours, 48);
assert.equal(full.maxStoragePoints, 960);
assert.equal(full.accumulatedPoints, 960);
assert.equal(full.isStorageFull, true);
assert.equal(full.upBalance, 37);
assert.equal(full.balance, 37);

const halted = getMiningState({
  miningLevel: 10,
  miningStorageLevel: 6,
  miningSavedPoints: 999999,
  miningLastClaimAt: new Date('2026-11-01T00:00:00.000Z')
}, now);
assert.equal(halted.accumulatedPoints, halted.maxStoragePoints, 'vault must cap unclaimed production');
assert.equal(RIG_LEVELS.length, 10);
assert.equal(RIG_LEVELS.at(-1).level, 10);
assert.equal(STORAGE_LEVELS.length, 6);
assert.equal(STORAGE_LEVELS.at(-1).maxHours, 48);

const source = fs.readFileSync(require.resolve('../routes/mining'), 'utf8');
assert.match(source, /executeIdempotently\(/);
assert.match(source, /type: 'mining_upgrade'/);
assert.match(source, /findOneAndUpdate\(optimisticUserFilter/);
assert.match(source, /IDEMPOTENCY_KEY_REQUIRED/);
assert.match(source, /miningSavedPoints: 0/);
assert.match(source, /newBalance: updated\.points/);
console.log('PASS — Phase 3 mining cap, 10 rig levels, 48-hour storage and atomic upgrade contracts');
