'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { getNativeGramBalance } = require('../utils/tonNativeDepositVerify');

const address = '0:2222222222222222222222222222222222222222222222222222222222222222';

(async () => {
  const requests = [];
  const result = await getNativeGramBalance(address, {
    apiKey: 'test-key',
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), headers: init.headers });
      return { ok: true, json: async () => ({ accounts: [{ address, balance: '2500000000' }] }) };
    }
  });
  assert.deepStrictEqual(result, {
    status: 'ok',
    address,
    balanceRaw: '2500000000',
    balance: 2.5
  });
  assert.strictEqual(requests.length, 1);
  assert.match(requests[0].url, /\/accountStates\?/);
  assert.match(requests[0].url, /include_boc=false/);
  assert.strictEqual(requests[0].headers['X-API-Key'], 'test-key');

  const zero = await getNativeGramBalance(address, {
    apiKey: 'test-key',
    fetchImpl: async () => ({ ok: true, json: async () => ({ accounts: [{ address, balance: '0' }] }) })
  });
  assert.strictEqual(zero.balance, 0);
  const invalid = await getNativeGramBalance('invalid', { fetchImpl: async () => { throw new Error('must not call provider'); } });
  assert.deepStrictEqual(invalid, { status: 'mismatch', code: 'INVALID_WALLET_ADDRESS' });

  const root = path.join(__dirname, '..');
  const route = fs.readFileSync(path.join(root, 'routes/points.js'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'public/css/style.css'), 'utf8');
  const i18n = fs.readFileSync(path.join(root, 'public/js/i18n.js'), 'utf8');
  assert.match(route, /router\.get\('\/wallet\/chain-balance'/);
  assert.match(route, /getNativeGramBalance\(address\)/);
  assert.match(app, /\/api\/points\/wallet\/chain-balance/);
  assert.match(app, /walletChainBalanceValue/);
  assert.match(styles, /\.walletChainBalance/);
  for (const key of ['wallet_chain_balance_title', 'wallet_chain_balance_refresh', 'wallet_chain_balance_unavailable']) {
    assert.ok(i18n.includes(`${key}:`), `missing translation ${key}`);
  }
  console.log('ALL PASS — on-chain Wallet balance read-only contract');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
