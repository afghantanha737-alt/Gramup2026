'use strict';
const assert = require('assert');
process.env.BOT_TOKEN = '';
const Settings = require('../models/Settings');
const points = require('../routes/points');
const tasks = require('../routes/tasks');
const User = require('../models/User');
const originalSettings = Settings.getGlobal;
const originalUpdate = User.findOneAndUpdate;
let mutations = 0;
Settings.getGlobal = async () => ({ rate: 0.0001, minWithdrawPoints: 1000 });
User.findOneAndUpdate = async () => { mutations += 1; throw new Error('An invalid request must not mutate the account'); };
function handler(router, path) {
  const layer = router.stack.find(row => row.route?.path === path && row.route.methods.post);
  assert.ok(layer, path);
  return layer.route.stack.at(-1).handle;
}
async function call(run, body, params = {}) {
  const req = { body, params, dbUser: { _id: 'qa', points: 0 }, get: () => '' };
  const result = { status: 200 };
  const res = { status(code) { result.status = code; return this; }, json(payload) { result.body = payload; return this; } };
  let forwarded;
  await run(req, res, error => { forwarded = error; });
  if (forwarded) throw forwarded;
  return result;
}
(async () => {
  // These handler tests isolate input validation; authentication has its own tests.
  let response = await call(handler(points, '/exchange'), { direction: 'fake', amount: 1 });
  assert.strictEqual(response.status, 400);
  assert.strictEqual(response.body.code, 'INVALID_DIRECTION');
  for (const amount of [[1], {}, 1e100, -2, 0]) {
    response = await call(handler(points, '/exchange'), { direction: 'points_to_gram', amount });
    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.code, 'INVALID_AMOUNT');
  }
  response = await call(handler(points, '/withdraw'), { gram: [10], address: 'test-address' });
  assert.strictEqual(response.status, 400);
  response = await call(handler(points, '/vip/purchase'), { planNumber: [1] });
  assert.strictEqual(response.body.code, 'VIP_PLAN_INVALID');
  response = await call(handler(tasks, '/:id/claim'), {}, { id: 'not-an-object-id' });
  assert.strictEqual(response.status, 404);
  assert.strictEqual(response.body.code, 'TASK_NOT_FOUND');
  assert.strictEqual(mutations, 0);
  console.log('PASS — invalid task IDs, fake exchange directions, arrays/objects and unsafe financial amounts rejected without balance writes (isolated handlers)');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  Settings.getGlobal = originalSettings;
  User.findOneAndUpdate = originalUpdate;
});
