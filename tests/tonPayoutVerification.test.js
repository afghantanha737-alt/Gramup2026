'use strict';
const assert = require('assert');
const { Address } = require('@ton/ton');
const { verifyTonTransaction } = require('../utils/tonVerify');
const { USDT_MASTER_ADDRESS } = require('../utils/tonUsdt');

const expectedRaw = `0:${'1'.repeat(64)}`;
const expectedAddress = Address.parseRaw(expectedRaw).toString({ urlSafe: true, bounceable: true });
const collidingRaw = `0:${'2'.repeat(52)}${'1'.repeat(12)}`;
const txHash = 'a'.repeat(64);
const walletTxHash = 'd'.repeat(64);
const walletMessageHash = 'e'.repeat(64);
const recipientTxHash = 'b'.repeat(64);
const payoutTraceId = 'c'.repeat(64);
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

function makeTraceFetch(submittedHash, hashKind, { amount = usdtAmount, destination = recipientJettonWallet } = {}) {
  return async url => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/jetton/wallets')) return {
      ok: true,
      json: async () => ({ jetton_wallets: [{ address: recipientJettonWallet, owner: expectedAddress, jetton: USDT_MASTER_ADDRESS }] })
    };
    if (parsed.pathname.endsWith('/jetton/transfers')) return {
      ok: true,
      json: async () => ({ jetton_transfers: [{
        transaction_hash: recipientTxHash,
        trace_id: payoutTraceId,
        jetton_master: USDT_MASTER_ADDRESS,
        source: expectedRaw,
        destination,
        amount,
        transaction_aborted: false
      }] })
    };
    if (parsed.pathname.endsWith('/traces')) {
      if (parsed.searchParams.has('tx_hash')) {
        assert.equal(parsed.searchParams.get('tx_hash'), submittedHash);
        return { ok: true, json: async () => ({ traces: hashKind === 'transaction' ? [{ trace_id: payoutTraceId }] : [] }) };
      }
      if (parsed.searchParams.has('msg_hash')) {
        assert.equal(parsed.searchParams.get('msg_hash'), submittedHash);
        return { ok: true, json: async () => ({ traces: [{ trace_id: payoutTraceId }] }) };
      }
    }
    if (parsed.pathname.endsWith('/transactions')) {
      assert.equal(parsed.searchParams.get('hash'), recipientTxHash, 'finality is checked on the verified recipient-side transaction');
      return { ok: true, json: async () => ({ transactions: [{
        hash: recipientTxHash,
        mc_block_seqno: 100,
        description: { aborted: false, compute_ph: { success: true }, action: { success: true } },
        in_msg: { bounced: false }
      }] }) };
    }
    throw new Error(`unexpected trace payout path: ${parsed.pathname}`);
  };
}

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

  const rootTransactionPayout = await verifyTonTransaction({
    txHash: walletTxHash,
    expectedAddress,
    expectedAmount: 0.1299,
    token: 'USDT',
    fetchImpl: makeTraceFetch(walletTxHash, 'transaction')
  });
  assert.strictEqual(rootTransactionPayout.ok, true, 'a full wallet transaction hash resolves through the trace to the recipient Jetton Wallet credit');
  assert.strictEqual(rootTransactionPayout.raw.txHash, recipientTxHash, 'the verified recipient transaction is kept as the canonical hash');

  const messageHashPayout = await verifyTonTransaction({
    txHash: walletMessageHash,
    expectedAddress,
    expectedAmount: 0.1299,
    token: 'USDT',
    fetchImpl: makeTraceFetch(walletMessageHash, 'message')
  });
  assert.strictEqual(messageHashPayout.ok, true, 'a wallet-submitted message hash resolves through the message trace lookup');

  const wrongAmountTrace = await verifyTonTransaction({
    txHash: walletTxHash,
    expectedAddress,
    expectedAmount: 0.1299,
    token: 'USDT',
    fetchImpl: makeTraceFetch(walletTxHash, 'transaction', { amount: '129901' })
  });
  assert.strictEqual(wrongAmountTrace.ok, false, 'trace membership never bypasses exact USDT amount validation');

  console.log('PASS — GRAM and direct/trace-resolved USDT payout verification enforce exact destination and amount');
})().catch(error => { console.error(error); process.exitCode = 1; });
