'use strict';
const assert = require('assert');
const { botText } = require('../utils/botMessages');

const registeredAt = new Date('2026-10-30T02:30:00.000Z');
const rates = [10, 5, 3, 1];
for (const language of ['fa', 'ps', 'en']) {
  const message = botText('referralInitial', language, '@new-user', 10, 1, 10, registeredAt, rates);
  assert.ok(message.includes('10'), `${language} must include the actual awarded amount`);
  assert.ok(message.includes('5'), `${language} must include the L2 rate`);
  assert.ok(message.includes('3'), `${language} must include the L3 rate`);
  assert.ok(message.includes('1'), `${language} must include the L4 rate`);
  assert.ok(message.length > 120, `${language} message should include full policy details`);
}

const english = botText('referralInitial', 'en', '@new-user', 10, 1, 10, registeredAt, rates);
assert.match(english, /exactly 10 points were added/);
assert.match(english, /L1 10%, L2 5%, L3 3%, L4 and deeper 1%/);
assert.match(english, /original earnings from approved tasks, daily check-ins, and leaderboard rewards/);
assert.match(english, /referral rewards\/commissions, spins, conversions, withdrawals, and admin adjustments are excluded/);
assert.doesNotMatch(english, /You will always receive/);

for (const language of ['fa', 'ps', 'en']) {
  const checkin = botText('dailyCheckinReady', language, 3, 9, 2);
  assert.ok(checkin.includes('3'), `${language} check-in message includes cycle day`);
  assert.ok(checkin.includes('9'), `${language} check-in message includes streak-derived points`);
  assert.ok(checkin.includes('2'), `${language} check-in message includes current streak`);
}

console.log('PASS — referral welcome states the paid 10 points, L1-L4 rates, eligible-income scope, and supports fa/ps/en');
