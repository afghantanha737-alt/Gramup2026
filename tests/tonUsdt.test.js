'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Cell, Address } = require('@ton/core');
const {
  USDT_MASTER_ADDRESS,
  JETTON_TRANSFER_OPCODE,
  UP_PER_USDT,
  TONCENTER_V2_BASE,
  TONAPI_BASE,
  usdtToBaseUnits,
  baseUnitsToUsdt,
  usdtToUp,
  upToUsdt,
  buildUsdtTransferBody,
  getUsdtJettonWallet,
  findUsdtTransfer
} = require('../utils/tonUsdt');
const { normalizeTonAddress } = require('../utils/tonNativeDepositVerify');

const owner = Address.parseRaw(`0:${'1'.repeat(64)}`).toString({ urlSafe: true, bounceable: true });
const sender = Address.parseRaw(`0:${'2'.repeat(64)}`).toString({ urlSafe: true, bounceable: true });
const jettonWallet = Address.parseRaw(`0:${'3'.repeat(64)}`).toString({ urlSafe: true, bounceable: true });
const txHash = 'a'.repeat(64);
const amountRaw = '1250000';
const reference = 'GRAMUP:USDT:TEST-REFERENCE';

assert.equal(usdtToBaseUnits('1'), 1000000n);
assert.equal(usdtToBaseUnits('1.250001'), 1250001n);
assert.equal(usdtToBaseUnits('1.0000001'), null, 'more than six decimals must be rejected');
assert.equal(usdtToBaseUnits('0'), null);
assert.equal(baseUnitsToUsdt('1250000'), 1.25);
assert.equal(usdtToUp('1'), UP_PER_USDT);
assert.equal(upToUsdt(UP_PER_USDT), 1);
assert.equal(usdtToUp('0.0001'), 1);
assert.equal(usdtToUp('0.00001'), 0);

const body = Cell.fromBoc(Buffer.from(buildUsdtTransferBody({
  destination: owner,
  responseDestination: owner,
  amountRaw,
  forwardPayload: beginComment(reference)
} ), 'base64'))[0].beginParse();
assert.equal(body.loadUint(32), JETTON_TRANSFER_OPCODE);
body.loadUintBig(64);
assert.equal(body.loadCoins().toString(), amountRaw);
assert.equal(body.loadAddress().toString({ urlSafe: true, bounceable: true }), owner);
assert.equal(body.loadAddress().toString({ urlSafe: true, bounceable: true }), owner, 'response destination remains the connected wallet');

const pointsRoute = fs.readFileSync(path.join(__dirname, '..', 'routes/points.js'), 'utf8');
assert.ok(pointsRoute.includes('address: connectJettonWallet'), 'TON Connect message address uses canonical user-friendly Jetton wallet format');
assert.ok(!pointsRoute.includes('address: senderJettonWallet'), 'raw Jetton wallet address is never exposed to TON Connect');
assert.ok(pointsRoute.includes('toTonConnectAddress(senderJettonWallet)'), 'Jetton wallet is parsed and formatted before message construction');

function beginComment(text) {
  const { beginCell } = require('@ton/core');
  return beginCell().storeUint(0, 32).storeStringTail(text).endCell();
}

function makeFetch({ master = USDT_MASTER_ADDRESS, destination = owner, source = sender, amount = amountRaw, aborted = false, final = true, bounced = false } = {}) {
  return async (url) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/jetton/transfers')) return {
      ok: true,
      json: async () => ({ jetton_transfers: [{
        transaction_hash: txHash,
        jetton_master: master,
        source,
        destination,
        amount,
        decoded_forward_payload: reference,
        transaction_aborted: aborted,
        transaction_now: 1700000000
      }] })
    };
    if (path.endsWith('/transactions')) return {
      ok: true,
      json: async () => ({ transactions: [{
        hash: txHash,
        mc_block_seqno: final ? 100 : 0,
        description: { aborted, compute_ph: { success: true }, action: { success: true } },
        in_msg: { bounced }
      }] })
    };
    throw new Error(`unexpected path ${path}`);
  };
}

(async () => {
  const fallbackWallet = await getUsdtJettonWallet(owner, {
    apiKey: 'test-key',
    fetchImpl: async (url) => {
      const text = String(url);
      if (text.includes('/api/v3/jetton/wallets')) return { ok: false, status: 403, json: async () => ({}) };
      assert.ok(text.startsWith(`${TONAPI_BASE}/accounts/`), 'USDT wallet lookup falls back to TONAPI only after TON Center rejection');
      return { ok: true, json: async () => ({ balances: [{
        wallet_address: { address: jettonWallet },
        jetton: { address: USDT_MASTER_ADDRESS },
        balance: amountRaw
      }] }) };
    }
  });
  assert.equal(fallbackWallet, normalizeTonAddress(jettonWallet), 'official TON USDT Jetton wallet is resolved through fallback');

  const valid = await findUsdtTransfer({ txHash, ownerAddress: owner, sourceAddress: sender, destinationAddress: owner, amountRaw, reference }, { fetchImpl: makeFetch() });
  assert.equal(valid.status, 'verified');
  const abbreviated = await findUsdtTransfer({ txHash: txHash.slice(0, 40), ownerAddress: owner, sourceAddress: sender, destinationAddress: owner, amountRaw, reference }, { fetchImpl: makeFetch() });
  assert.equal(abbreviated.status, 'verified', 'shortened 40-character USDT hash prefixes must resolve');
  assert.equal(abbreviated.txHash, txHash, 'verification must return the canonical full hash');
  for (const [label, options] of [
    ['fake master', { master: Address.parseRaw(`0:${'4'.repeat(64)}`).toString({ urlSafe: true, bounceable: true }) }],
    ['wrong destination', { destination: sender }],
    ['wrong amount', { amount: '1250001' }],
    ['wrong sender', { source: owner }],
    ['aborted transfer', { aborted: true }]
  ]) {
    const result = await findUsdtTransfer({ txHash, ownerAddress: owner, sourceAddress: sender, destinationAddress: owner, amountRaw, reference }, { fetchImpl: makeFetch(options) });
    assert.notEqual(result.status, 'verified', `${label} must be rejected`);
  }
  const pending = await findUsdtTransfer({ txHash, ownerAddress: owner, sourceAddress: sender, destinationAddress: owner, amountRaw, reference }, { fetchImpl: makeFetch({ final: false }) });
  assert.equal(pending.status, 'pending', 'non-final transactions must remain pending');
  const bounced = await findUsdtTransfer({ txHash, ownerAddress: owner, sourceAddress: sender, destinationAddress: owner, amountRaw, reference }, { fetchImpl: makeFetch({ bounced: true }) });
  assert.equal(bounced.status, 'pending', 'bounced transactions must not verify');

  const fallbackTransfer = await findUsdtTransfer({ txHash, ownerAddress: owner, sourceAddress: sender, destinationAddress: owner, amountRaw, reference }, {
    fetchImpl: async url => {
      const text = String(url);
      if (text.includes('/api/v3/jetton/transfers')) return { ok: false, status: 403, json: async () => ({}) };
      if (text.includes('/accounts/') && text.includes('/events')) return {
        ok: true,
        json: async () => ({ events: [{ event_id: txHash, actions: [{ type: 'JettonTransfer', JettonTransfer: { jetton: { address: USDT_MASTER_ADDRESS }, sender, recipient: owner, amount: amountRaw, forward_payload: reference } }] }] })
      };
      if (text.includes('/api/v3/transactions')) return { ok: true, json: async () => ({ transactions: [{ hash: txHash, mc_block_seqno: 100, description: { aborted: false, compute_ph: { success: true }, action: { success: true } }, in_msg: { bounced: false } }] }) };
      throw new Error(`unexpected fallback path ${text}`);
    }
  });
  assert.equal(fallbackTransfer.status, 'verified', 'TONAPI v2 Jetton events verify when TonCenter v3 is rate-limited');

  const v2Finality = await findUsdtTransfer({ txHash, ownerAddress: owner, sourceAddress: sender, destinationAddress: owner, amountRaw, reference }, {
    fetchImpl: async url => {
      const text = String(url);
      if (text.includes('/api/v3/jetton/transfers')) return { ok: true, json: async () => ({ jetton_transfers: [{ transaction_hash: txHash, jetton_master: USDT_MASTER_ADDRESS, source: sender, destination: owner, amount: amountRaw, decoded_forward_payload: reference, transaction_aborted: false }] }) };
      if (text.includes('/api/v3/transactions')) return { ok: false, status: 403, json: async () => ({}) };
      if (text.startsWith(`${TONCENTER_V2_BASE}/getTransactions`)) return { ok: true, json: async () => ({ ok: true, result: [{ transaction_id: { hash: txHash }, utime: 1700000000 }] }) };
      throw new Error(`unexpected v2 finality path ${text}`);
    }
  });
  assert.equal(v2Finality.status, 'verified', 'TonCenter v2 account history supplies finality when v3 hash lookup is limited');
  console.log('PASS — exact TON USDT conversions, Jetton payloads, strict validation, and finality checks');
})().catch(error => { console.error(error); process.exitCode = 1; });
