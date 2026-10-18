'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const WeeklyLeaderboardAward = require('../models/WeeklyLeaderboardAward');
const {
  parseWeekKey,
  previousClosedWeek,
  POSITIVE_TYPES
} = require('../utils/weeklyLeaderboardSettlement');

const parsed = parseWeekKey('2026-09-28');
assert(parsed);
assert.strictEqual(parsed.start.toISOString(), '2026-09-28T00:00:00.000Z');
assert.strictEqual(parsed.end.toISOString(), '2026-10-05T00:00:00.000Z');
assert.strictEqual(parseWeekKey('2026-09-30'), null);
assert.strictEqual(parseWeekKey('not-a-week'), null);

const closed = previousClosedWeek(new Date('2026-10-07T12:00:00Z'));
assert.strictEqual(closed.key, '2026-09-28');
assert.strictEqual(closed.end.toISOString(), '2026-10-05T00:00:00.000Z');

assert.deepStrictEqual(POSITIVE_TYPES, ['task', 'checkin', 'spin', 'referral_bonus']);

const awardPaths = WeeklyLeaderboardAward.schema.paths;
assert(awardPaths.weekKey && awardPaths.rank && awardPaths.status);
assert(awardPaths.processingAt && awardPaths.finalizedAt && awardPaths.attempts);
assert.strictEqual(WeeklyLeaderboardAward.schema.indexes().some(([fields, options]) => (
  fields.weekKey === 1 && fields.rank === 1 && options.unique === true
)), true);

const adminSource = fs.readFileSync(path.join(__dirname, '..', 'routes/admin.js'), 'utf8');
assert.ok(adminSource.includes("code: 'FORCE_SETTLEMENT_DISABLED'"), 'production must reject forced settlement');
assert.ok(adminSource.includes('forceRequested && !isTestEnvironment()'), 'force settlement must be test-only');

console.log('ALL PASS — weekly settlement contract and UTC windows');
