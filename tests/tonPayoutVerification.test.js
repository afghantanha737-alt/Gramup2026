'use strict';
const assert = require('assert');
const { Address } = require('@ton/ton');
const { verifyTonTransaction } = require('../utils/tonVerify');

const expectedRaw = `0:${'1'.repeat(64)}`;
const expectedAddress = Address.parseRaw(expectedRaw).toString({ urlSafe: true, bounceable: true });
const collidingRaw = `0:${'2'.repeat(52)}${'1'.repeat(12)}`;
const txHash = 'a'.repeat(64);
const makeFetch = destination => async () => ({
  ok: true,
  status: 200,
  json: async () => ({ transactions: [{
    account: '0:' + '3'.repeat(64),
    description: { compute_ph: { success: true }, action: { success: true } },
    out_msgs: [{ destination, value: '1000000000' }]
  }] })
});
const makeAbortedFetch = destination => async () => ({
  ok: true,
  status: 200,
  json: async () => ({ transactions: [{
    account: '0:' + '3'.repeat(64),
    description: { aborted: true, compute_ph: { success: true }, action: { success: true } },
    out_msgs: [{ destination, value: '1000000000' }]
  }] })
});

(async () => {
  const valid = await verifyTonTransaction({ txHash, expectedAddress, expectedAmount: 1, token: 'TON', fetchImpl: makeFetch(expectedRaw) });
  assert.strictEqual(valid.ok, true, 'raw and user-friendly forms of the same exact TON address must match');
  const collision = await verifyTonTransaction({ txHash, expectedAddress, expectedAmount: 1, token: 'TON', fetchImpl: makeFetch(collidingRaw) });
  assert.strictEqual(collision.ok, false, 'a destination sharing only a suffix must not pass address verification');
  const aborted = await verifyTonTransaction({ txHash, expectedAddress, expectedAmount: 1, token: 'TON', fetchImpl: makeAbortedFetch(expectedRaw) });
  assert.strictEqual(aborted.ok, false, 'an explicitly aborted transaction must never be accepted as a payout');
  console.log('PASS — TON payout verification rejects address collisions and explicitly aborted transactions');
})().catch(error => { console.error(error); process.exitCode = 1; });
