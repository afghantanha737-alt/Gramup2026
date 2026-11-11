'use strict';

const assert = require('assert');
const { anonymizeWinnerName, toRecentSpinWinner } = require('../utils/spinWinners');

assert.strictEqual(anonymizeWinnerName('Ali Rahimi'), 'A***');
assert.strictEqual(anonymizeWinnerName('سارا احمدی'), 'س***');
assert.strictEqual(anonymizeWinnerName(''), 'User ***');

const winner = toRecentSpinWinner({
  user: { _id: 'private-user-id', telegramId: '123456', username: 'privatehandle', firstName: 'Farhad', lastName: 'Sensitive' },
  description: 'Lucky Spin paid reward: up_100',
  amount: 100,
  currency: 'points'
});
assert.deepStrictEqual(winner, { name: 'F***', prizeId: 'up_100', amount: 100 });
assert.strictEqual(Object.hasOwn(winner, 'telegramId'), false);
assert.strictEqual(Object.hasOwn(winner, 'username'), false);
assert.strictEqual(Object.hasOwn(winner, '_id'), false);
assert.strictEqual(toRecentSpinWinner({ user: { firstName: 'Ali' }, description: 'unrecognized: custom_prize', amount: 5 }), null);
assert.strictEqual(toRecentSpinWinner({ user: { firstName: 'Ali' }, description: 'Lucky Spin: up_50', amount: 0 }), null);

console.log('PASS — recent spinner winners expose only masked initials and whitelisted prize data');
