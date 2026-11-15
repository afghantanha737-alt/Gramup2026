'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', 'public/js/app.js'), 'utf8');
assert.match(app, /function getReferralStartParam\(\)/);
assert.match(app, /initDataUnsafe\?\.start_param/);
assert.match(app, /params\.get\("startapp"\)/);
assert.match(app, /params\.get\("start"\)/, 'legacy query payload remains readable');
assert.match(app, /const ref = getReferralStartParam\(\)/);

const userPath = require.resolve('../models/User');
const created = [];
const userModel = {
  findOne: async () => null,
  create: async values => {
    const user = { _id: 'direct-user', createdAt: new Date(), ...values, save: async () => user };
    created.push(user);
    return user;
  }
};
require.cache[userPath] = { id: userPath, filename: userPath, loaded: true, exports: userModel };
const { getOrCreateUser } = require('../utils/telegramAuth');

(async () => {
  const user = await getOrCreateUser({ id: 900001, first_name: 'Direct', allows_write_to_pm: true }, '');
  assert.strictEqual(created.length, 1);
  assert.strictEqual(user.botReminderEnabled, true, 'new Mini App users default to bot reminders enabled');
  console.log('PASS — direct Mini App startapp is read client-side and new users default to bot reminders');
})().catch(error => { console.error(error); process.exitCode = 1; });
