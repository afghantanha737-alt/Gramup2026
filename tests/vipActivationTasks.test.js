'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { VIP_ACTIVATION_REWARDS, vipActivationTaskDefinition } = require('../utils/vipActivationTasks');

assert.deepStrictEqual(Object.keys(VIP_ACTIVATION_REWARDS).map(Number), [1,2,3,4,5,6,7,8,9,10]);
assert.deepStrictEqual(Object.values(VIP_ACTIVATION_REWARDS), [50,100,175,250,350,475,625,800,1000,1250]);
for (let plan = 1; plan <= 10; plan += 1) {
  const task = vipActivationTaskDefinition(plan);
  assert.strictEqual(task.taskKind, 'vip_activation');
  assert.strictEqual(task.vipPlanNumber, plan);
  assert.strictEqual(task.reward, VIP_ACTIVATION_REWARDS[plan]);
  assert.strictEqual(task.isActive, true);
}
const pointsRoute = fs.readFileSync(path.join(__dirname, '../routes/points.js'), 'utf8');
assert.match(pointsRoute, /TaskCompletion/);
assert.match(pointsRoute, /vip-task:\$\{vipTask\._id\}:user:\$\{user\._id\}/);
assert.match(pointsRoute, /reviewedBy: 'vip-purchase-system'/);
assert.match(pointsRoute, /taskLedger\.created/);
const taskModel = fs.readFileSync(path.join(__dirname, '../models/Task.js'), 'utf8');
assert.match(taskModel, /vip_activation/);
console.log('ALL PASS — VIP activation tasks');
