'use strict';
const assert = require('assert');
const { Address } = require('@ton/ton');
const { verifyTonTransaction } = require('../utils/tonVerify');
const { USDT_MASTER_ADDRESS } = require('../utils/tonUsdt');

const expectedRaw = `0:${'1'.repeat(64)}`;
const expectedAddress = Address.parseRaw(expectedRaw).toString({ urlSafe: true, bounceable: true });
const collidingRaw = `0:${'2'.repeat(52)}${'1'.repeat(12)}`;
const txHash = 'a'.repeat(64);
const recipientJettonWallet = Address.parseRaw(`0:${'4'.repeat(64)}`).toString({ urlSafe: true, bounceable: true });
const usdtAmount = '129900';
const makeFetch = destination => async () => ({
  ok: true,
  status: 200,
  json: async () => ({ transactions: [{
    account: '0:' + '3'.repeat(64),
    mc_block_seqno: 100,
    description: { compute_ph: { success: true }, action: { success: true } },
    out_msgs: [{ destination, value: '1000000000' }]
  }] })
});
const makeAbortedFetch = destination => async () => ({
  ok: true,
  status: 200,
  json: async () => ({ transactions: [{
    account: '0:' + '3'.repeat(64),
    mc_block_seqno: 100,
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
  const usdtPayout = await verifyTonTransaction({ txHash, expectedAddress, expectedAmount: 0.1299, token: 'USDT', fetchImpl: async url => {
    const text = String(url);
    if (text.includes('/api/v3/jetton/wallets')) return {
      ok: true,
      status: 200,
      json: async () => ({ jetton_wallets: [{ address: recipientJettonWallet, owner: expectedAddress, jetton: USDT_MASTER_ADDRESS }] })
    };
    if (text.includes('/api/v3/jetton/transfers')) return {
      ok: true,
      status: 200,
      json: async () => ({ jetton_transfers: [{ transaction_hash: txHash, jetton_master: USDT_MASTER_ADDRESS, source: expectedRaw, destination: recipientJettonWallet, amount: usdtAmount, transaction_aborted: false }] })
    };
    if (text.includes('/api/v3/transactions')) return {
      ok: true,
      status: 200,
      json: async () => ({ transactions: [{ hash: txHash, mc_block_seqno: 100, description: { compute_ph: { success: true }, action: { success: true } }, in_msg: { bounced: false } }] })
    };
    throw new Error(`unexpected USDT verifier path: ${text}`);
  } });
  assert.strictEqual(usdtPayout.ok, true, 'USDT payout destination may be the recipient Jetton Wallet, not the owner address');
  console.log('PASS — TON payout verification rejects address collisions and explicitly aborted transactions');
})().catch(error => { console.error(error); process.exitCode = 1; });
