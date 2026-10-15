'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { VIP_ACTIVATION_REWARDS, vipActivationTaskDefinition } = require('../utils/vipActivationTasks');

// The legacy task helper remains available for old records, but is no longer
// invoked by user-facing routes after the VIP -> Mining Hub transition.
assert.deepStrictEqual(Object.keys(VIP_ACTIVATION_REWARDS).map(Number), [1,2,3,4,5,6,7,8,9,10]);
assert.deepStrictEqual(Object.values(VIP_ACTIVATION_REWARDS), [50,100,175,250,350,475,625,800,1000,1250]);
for (let plan = 1; plan <= 10; plan += 1) {
  const task = vipActivationTaskDefinition(plan);
  assert.strictEqual(task.taskKind, 'vip_activation');
  assert.strictEqual(task.vipPlanNumber, plan);
  assert.strictEqual(task.reward, VIP_ACTIVATION_REWARDS[plan]);
  assert.strictEqual(task.isActive, true);
}

const root = path.join(__dirname, '..');
const pointsRoute = fs.readFileSync(path.join(root, 'routes/points.js'), 'utf8');
const taskModel = fs.readFileSync(path.join(root, 'models/Task.js'), 'utf8');
const miningRoute = fs.readFileSync(path.join(root, 'routes/mining.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');

assert.match(pointsRoute, /code: 'VIP_REMOVED'/, 'new VIP purchases/claims must be retired');
assert.doesNotMatch(pointsRoute, /vipActivationTaskDefinition\(/, 'legacy task helper must not create new user tasks');
assert.match(taskModel, /vip_activation/, 'legacy task schema remains readable for historical records');
assert.match(miningRoute, /router\.get\('\/status'/);
assert.match(miningRoute, /router\.post\('\/claim'/);
assert.match(miningRoute, /router\.post\('\/upgrade'/);
assert.match(indexHtml, /data-tab="mining"/);
assert.match(app, /function renderMiningTab\(\)/);
assert.match(app, /\/api\/mining\/claim/);
console.log('ALL PASS — legacy VIP activation task compatibility and Mining Hub replacement contract');
