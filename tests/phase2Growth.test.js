'use strict';
const assert = require('node:assert/strict');
const { calculateMiningCommissionAmount } = require('../utils/referralSystem');
const { parsePublicTelegramChannel } = require('../routes/squads');

// Synthetic claim base: only the referrers receive these separately calculated amounts.
const claim = 1234.567;
assert.equal(calculateMiningCommissionAmount(claim, 10), 123.45, 'Tier 1 receives 10%, rounded down to cents');
assert.equal(calculateMiningCommissionAmount(claim, 2.5), 30.86, 'Tier 2 receives 2.5%, rounded down to cents');
assert.equal(calculateMiningCommissionAmount(0, 10), 0);
assert.equal(calculateMiningCommissionAmount(-1, 10), 0);
assert.equal(calculateMiningCommissionAmount(100, NaN), 0);

assert.deepEqual(parsePublicTelegramChannel('@GramupSquad'), {
  username: 'gramupsquad', url: 'https://t.me/GramupSquad'
});
assert.deepEqual(parsePublicTelegramChannel('https://t.me/GramupSquad'), {
  username: 'gramupsquad', url: 'https://t.me/GramupSquad'
});
assert.equal(parsePublicTelegramChannel('https://example.com/GramupSquad'), null);
assert.equal(parsePublicTelegramChannel('https://t.me/GramupSquad/extra'), null);
assert.equal(parsePublicTelegramChannel('abc'), null);

console.log('PASS — Phase 2 synthetic Tier 1/Tier 2 commission arithmetic and Squad channel validation');
