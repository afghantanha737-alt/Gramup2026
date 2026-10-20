'use strict';
const assert = require('assert');
const userPath = require.resolve('../models/User');
let existingUser = null;
let findCount = 0;
const User = {
  findOne: async () => { findCount += 1; return findCount === 1 ? null : existingUser; },
  create: async () => {
    existingUser = { _id: 'user-42', telegramId: '42', createdAt: new Date(), username: '', firstName: '', lastName: '', photoUrl: '', isBanned: false, save: async () => {} };
    const error = new Error('duplicate telegramId'); error.code = 11000; throw error;
  }
};
require.cache[userPath] = { id: userPath, filename: userPath, loaded: true, exports: User };
const { getOrCreateUser } = require('../utils/telegramAuth');

(async () => {
  const user = await getOrCreateUser({ id: 42, first_name: 'First login' }, '', '127.0.0.1', 'test');
  assert.strictEqual(user, existingUser, 'duplicate-key request reloads the winner row');
  assert.strictEqual(user.firstName, 'First login', 'losing concurrent request still updates Telegram profile fields');
  console.log('PASS — concurrent Telegram first-login duplicate key recovers without spurious 500');
})().catch(error => { console.error(error); process.exitCode = 1; });
