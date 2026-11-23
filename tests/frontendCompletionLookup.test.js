'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
const start = source.indexOf('function buildCompletionLookup(completions) {');
const end = source.indexOf('\nfunction renderHome()', start);
assert.ok(start >= 0 && end > start, 'completion lookup helper remains directly testable');

const context = { state: { completions: [] }, Map, Array, String };
vm.runInNewContext(
  `${source.slice(start, end)}\nglobalThis.buildCompletionLookup = buildCompletionLookup;`,
  context
);

const rejected = {
  task: 'manual-task',
  status: 'rejected',
  adminNote: 'Please submit clearer proof.'
};
const cooldown = {
  task: 'latest-post-task',
  status: 'approved',
  nextAvailableAt: '2026-11-24T00:00:00.000Z',
  recurringClaimCount: 3
};
const rows = [
  { task: 'duplicate-task', status: 'pending' },
  { task: 'duplicate-task', status: 'approved' },
  rejected,
  cooldown
];
let lookup = context.buildCompletionLookup(rows);
assert.strictEqual(lookup.get('duplicate-task').status, 'pending', 'duplicate rows preserve Array.find first-match semantics');
assert.strictEqual(lookup.get('manual-task').adminNote, rejected.adminNote, 'rejection details remain available to the UI');
assert.strictEqual(lookup.get('latest-post-task').nextAvailableAt, cooldown.nextAvailableAt, 'cooldown metadata remains available to the UI');
assert.strictEqual(lookup.get('missing-task'), undefined);

lookup = context.buildCompletionLookup([
  { task: 'duplicate-task', status: 'approved' },
  null,
  { task: 'new-task', status: 'pending' }
]);
assert.strictEqual(lookup.get('duplicate-task').status, 'approved', 'new read-model arrays produce current statuses');
assert.strictEqual(lookup.get('new-task').status, 'pending');
assert.strictEqual(lookup.size, 2, 'malformed null rows do not break rendering');

console.log('ALL PASS — frontend task completion lookup semantics');
