'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
  EXCHANGE_ASSETS,
  normalizeExchangeAsset,
  normalizeLocalizedNumericString,
  parseExchangeAmount,
  floorExchangeAmount,
  exchangeAmountFromUp,
  exchangeAmountToUp,
  exchangeRateSnapshot,
  upToGramRate,
  exchangeUpToGram,
  exchangeGramToUp
} = require('../utils/exchangeAmounts');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const i18nSource = fs.readFileSync(path.join(root, 'public/js/i18n.js'), 'utf8');
const helperStart = appSource.indexOf('function normalizeLocalizedExchangeAmount(value) {');
const helperEnd = appSource.indexOf('\nfunction setExchangePair(', helperStart);
assert.notStrictEqual(helperStart, -1, 'frontend localized amount helper exists');
assert.ok(helperEnd > helperStart, 'frontend localized amount helper block is bounded');
const browserHelpers = { UP_PER_USDT: 10000 };
vm.runInNewContext(`${appSource.slice(helperStart, helperEnd)}\nglobalThis.testHelpers = { normalizeLocalizedExchangeAmount, parseLocalizedExchangeAmount, calculateUpToGramClient, calculateGramToUpClient };`, browserHelpers);

const normalizeClient = browserHelpers.testHelpers.normalizeLocalizedExchangeAmount;
const parseClient = browserHelpers.testHelpers.parseLocalizedExchangeAmount;
const upToGramClient = browserHelpers.testHelpers.calculateUpToGramClient;
const gramToUpClient = browserHelpers.testHelpers.calculateGramToUpClient;
assert.strictEqual(normalizeClient('۲٫۰۳۲۱۲۵۰۰۰'), '2.032125000');
assert.strictEqual(parseClient('۲٫۰۳۲۱۲۵۰۰۰'), 2.032125);
assert.strictEqual(upToGramRate(0.02), 0.005);
assert.strictEqual(exchangeUpToGram(1000, 0.02), 5);
assert.strictEqual(upToGramClient(1000, 0.02), 5, 'the UI preview uses the same fixed-UP/USD and live-GRAM/USD calculation');
assert.strictEqual(exchangeGramToUp(1, 0.959424), 9594);
assert.strictEqual(gramToUpClient(1, 0.959424), 9594, 'the UI uses the live inverse rate, not the legacy 10000-UP setting');
assert.strictEqual(exchangeUpToGram(10000, 0.959424), 1.042292041);
assert.strictEqual(floorExchangeAmount(1.23456789, 'USDT'), 1.234567, 'live swap output is floored to avoid over-crediting');
assert.strictEqual(normalizeClient('۲,۰۳۲۱۲۵'), '2.032125');
assert.strictEqual(normalizeClient('٢٬٠٣٢٫١٢'), '2032.12');
assert.strictEqual(normalizeClient('2,032.12'), '2032.12');
assert.strictEqual(normalizeClient('2٫03x'), null);
assert.match(appSource, /body: \{ from: exchangeFromAsset, to: exchangeToAsset, amount: normalizedAmount \}/, 'frontend sends an ASCII-decimal amount string');
assert.match(indexSource, /id="exchangePoints" type="text" inputmode="decimal"/, 'mobile Swap input preserves locale-specific decimal digits');
for (const code of ['INVALID_DIRECTION', 'INVALID_RATE', 'INVALID_AMOUNT', 'EXCHANGE_AMOUNT_TOO_SMALL', 'EXCHANGE_INSUFFICIENT_BALANCE', 'EXCHANGE_TEMPORARILY_UNAVAILABLE', 'EXCHANGE_ACCOUNTING_FAILED']) {
  const row = i18nSource.match(new RegExp(`${code}: \\{[^\\n]+`))?.[0] || '';
  assert.ok(row.includes('fa:') && row.includes('ps:') && row.includes('en:'), `${code} has fa/ps/en messages`);
}

assert.strictEqual(normalizeLocalizedNumericString('۲٫۰۳۲۱۲۵۰۰۰'), '2.032125000');
assert.strictEqual(normalizeLocalizedNumericString('۲,۰۳۲۱۲۵'), '2.032125');
assert.strictEqual(normalizeLocalizedNumericString('٢٬٠٣٢٫١٢'), '2032.12');
assert.strictEqual(normalizeLocalizedNumericString('2٫03x'), null);
assert.strictEqual(parseExchangeAmount('۲٫۰۳۲۱۲۵۰۰۰', 'GRAM'), 2.032125);
assert.strictEqual(parseExchangeAmount('۲٫۰۳۲۱۲۵۰۰۰', 'UP'), 2);
assert.ok(Number.isNaN(parseExchangeAmount({ amount: 2 }, 'GRAM')));
assert.strictEqual(normalizeExchangeAsset(' gram '), 'GRAM');
assert.deepStrictEqual(
  ['UP', 'GRAM', 'USDT'].map(asset => [asset, EXCHANGE_ASSETS[asset].balanceField, EXCHANGE_ASSETS[asset].currency]),
  [['UP', 'points', 'points'], ['GRAM', 'gramBalance', 'gram'], ['USDT', 'usdtBalance', 'usdt']]
);

const gramPerUp = 0.0001;
const amountInGram = parseExchangeAmount('۲٫۰۳۲۱۲۵۰۰۰', 'GRAM');
const upFromGram = exchangeAmountToUp(amountInGram, 'GRAM', gramPerUp);
assert.strictEqual(upFromGram, 20321);
assert.strictEqual(exchangeAmountFromUp(upFromGram, 'GRAM', gramPerUp), 2.0321);
assert.strictEqual(exchangeAmountFromUp(upFromGram, 'UP', gramPerUp), 20321);
assert.strictEqual(exchangeAmountFromUp(upFromGram, 'USDT', gramPerUp), 2.0321);
const halfGramUp = exchangeAmountToUp(0.5, 'GRAM', gramPerUp);
assert.strictEqual(halfGramUp, 5000);
assert.strictEqual(exchangeAmountFromUp(halfGramUp, 'USDT', gramPerUp), 0.5);
const rates = exchangeRateSnapshot(gramPerUp);
assert.strictEqual(rates.gramToUp, 10000);
assert.strictEqual(rates.gramToUsdt, 1);

// Exercise the real route handler with transaction/ledger adapters so pair
// selection, balance paths, currency tags, and failure responses are covered.
process.env.BOT_TOKEN = '';
const idempotency = require('../utils/idempotency');
const ledger = require('../utils/ledger');
const Settings = require('../models/Settings');
const User = require('../models/User');
const PointsLedger = require('../models/PointsLedger');
const Transaction = require('../models/Transaction');
const originals = {
  executeIdempotently: idempotency.executeIdempotently,
  recordLedgerRequired: ledger.recordLedgerRequired,
  getGlobal: Settings.getGlobal,
  findOneAndUpdate: User.findOneAndUpdate
};
let account;
let ledgerRows = [];
let failLedger = false;
let transactionsUnavailable = false;
let failSettings = false;
idempotency.executeIdempotently = async ({ execute }) => {
  if (transactionsUnavailable) throw Object.assign(new Error('transactions disabled'), { code: 'TRANSACTIONS_UNAVAILABLE' });
  const before = { ...account };
  const ledgerStart = ledgerRows.length;
  try {
    const result = await execute({ mockSession: true });
    return { status: 200, body: result.body };
  } catch (error) {
    account = before;
    ledgerRows.length = ledgerStart;
    throw error;
  }
};
ledger.recordLedgerRequired = async row => {
  if (failLedger) throw Object.assign(new Error('journal unavailable'), { code: 'TRANSACTION_JOURNAL_UNAVAILABLE' });
  ledgerRows.push({ ...row });
  return { created: true };
};
Settings.getGlobal = async () => {
  if (failSettings) throw new Error('settings store unavailable');
  return { rate: gramPerUp };
};
User.findOneAndUpdate = async (filter, update) => {
  const balanceField = Object.keys(update.$inc || {})[0];
  if (filter[balanceField]?.$gte != null && account[balanceField] < filter[balanceField].$gte) return null;
  for (const [field, change] of Object.entries(update.$inc || {})) account[field] += change;
  return { ...account };
};

function routeHandler(router, routePath) {
  const layer = router.stack.find(item => item.route?.path === routePath && item.route.methods.post);
  assert.ok(layer, `POST ${routePath} is registered`);
  return layer.route.stack.at(-1).handle;
}
async function request(handler, body) {
  const output = { status: 200 };
  const req = { body, dbUser: { ...account }, get: () => 'qa-swap-key-0001' };
  const res = {
    status(code) { output.status = code; return this; },
    json(payload) { output.body = payload; return this; }
  };
  let forwarded;
  await handler(req, res, error => { forwarded = error; });
  if (forwarded) throw forwarded;
  return output;
}

let originalGetLiveRates;
(async () => {
  const stonFi = require('../routes/stonFi');
  originalGetLiveRates = stonFi.getLiveRates;
  let liveGramUsd = 0.959424;
  let liveUsdtUsd = 0.999053;
  let failLiveRates = false;
  stonFi.getLiveRates = async () => {
    if (failLiveRates) throw new Error('STON.fi unavailable');
    return {
      source: 'STON.fi market API', updatedAt: '2026-11-26T00:00:00.000Z', gramUsdt: liveGramUsd / liveUsdtUsd,
      usdtGram: liveUsdtUsd / liveGramUsd,
      assets: {
        GRAM: { address: 'native-gram-test-asset', symbol: 'GRAM', decimals: 9, priceUsd: liveGramUsd },
        USDT: { address: 'usdt-test-asset', symbol: 'USDT', decimals: 6, priceUsd: liveUsdtUsd }
      }
    };
  };
  const pointsRouter = require('../routes/points');
  const exchange = routeHandler(pointsRouter, '/exchange');

  account = { _id: 'swap-user', points: 0, gramBalance: 3, usdtBalance: 0 };
  ledgerRows = [];
  let response = await request(exchange, { from: 'GRAM', to: 'UP', amount: '۲٫۰۳۲۱۲۵۰۰۰' });
  assert.strictEqual(response.status, 200);
  assert.strictEqual(response.body.from, 'GRAM');
  assert.strictEqual(response.body.to, 'UP');
  const expectedLiveUp = exchangeGramToUp(2.032125, liveGramUsd);
  assert.strictEqual(response.body.upAmount, expectedLiveUp);
  assert.strictEqual(response.body.receivedAmount, expectedLiveUp);
  assert.strictEqual(response.body.rates.upUsd, 0.0001);
  assert.strictEqual(response.body.rates.gramUsd, liveGramUsd);
  assert.strictEqual(account.points, expectedLiveUp);
  assert.strictEqual(account.gramBalance, 3 - 2.032125, 'the full requested GRAM is debited, with only whole UP output rounded down');
  assert.deepStrictEqual(ledgerRows.map(row => [row.asset, row.currency, row.amount]), [
    ['GRAM', 'gram', -2.032125], ['UP', 'points', expectedLiveUp]
  ]);
  assert.strictEqual(exchangeGramToUp(1, liveGramUsd), 9594, '1 GRAM at $0.959424 yields 9594 whole UP, not 10000');

  account = { _id: 'swap-user', points: 0, gramBalance: 1, usdtBalance: 0 };
  ledgerRows = [];
  response = await request(exchange, { from: 'GRAM', to: 'UP', amount: '1' });
  assert.strictEqual(response.status, 200);
  assert.strictEqual(response.body.receivedAmount, 9594, 'the live route reproduces the exact one-GRAM screenshot case');
  assert.strictEqual(account.gramBalance, 0);
  assert.strictEqual(account.points, 9594);

  account = { _id: 'swap-user', points: 0, gramBalance: 2, usdtBalance: 0 };
  ledgerRows = [];
  response = await request(exchange, { from: 'GRAM', to: 'USDT', amount: '۰٫۵' });
  assert.strictEqual(response.status, 200);
  const expectedLiveUsdt = floorExchangeAmount(0.5 * response.body.rates.gramUsdt, 'USDT');
  assert.strictEqual(response.body.receivedAmount, expectedLiveUsdt);
  assert.strictEqual(account.gramBalance, 1.5);
  assert.strictEqual(account.usdtBalance, expectedLiveUsdt);
  assert.deepStrictEqual(ledgerRows.map(row => [row.asset, row.currency]), [['GRAM', 'gram'], ['USDT', 'usdt']]);

  account = { _id: 'swap-user', points: 0, gramBalance: 0, usdtBalance: 2 };
  ledgerRows = [];
  response = await request(exchange, { from: 'USDT', to: 'GRAM', amount: '1' });
  assert.strictEqual(response.status, 200);
  const expectedGramFromUsdt = floorExchangeAmount(liveUsdtUsd / liveGramUsd, 'GRAM');
  assert.strictEqual(response.body.receivedAmount, expectedGramFromUsdt);
  assert.strictEqual(account.usdtBalance, 1);
  assert.strictEqual(account.gramBalance, expectedGramFromUsdt);
  assert.strictEqual(response.body.rates.source, 'STON.fi market API');

  account = { _id: 'swap-user', points: 20000, gramBalance: 0, usdtBalance: 0 };
  ledgerRows = [];
  response = await request(exchange, { from: 'UP', to: 'GRAM', amount: '10000' });
  assert.strictEqual(response.status, 200);
  assert.strictEqual(response.body.receivedAmount, 1.042292041, '10000 UP is $1.00 and buys GRAM at the live $0.959424 price');
  assert.strictEqual(response.body.rates.upUsd, 0.0001);
  assert.strictEqual(response.body.rates.gramUsd, liveGramUsd);
  assert.ok(Math.abs(response.body.rates.upToGram - (0.0001 / liveGramUsd)) < 1e-15);
  assert.strictEqual(account.points, 10000);
  assert.strictEqual(account.gramBalance, 1.042292041);
  assert.deepStrictEqual(ledgerRows.map(row => [row.asset, row.currency, row.amount]), [
    ['UP', 'points', -10000], ['GRAM', 'gram', 1.042292041]
  ]);

  account = { _id: 'swap-user', points: 0, gramBalance: 0, usdtBalance: 2 };
  ledgerRows = [];
  response = await request(exchange, { from: 'USDT', to: 'UP', amount: '1' });
  assert.strictEqual(response.status, 200);
  assert.strictEqual(response.body.receivedAmount, 10000);
  assert.strictEqual(response.body.rates.upUsd, 0.0001);
  assert.strictEqual(account.usdtBalance, 1);
  assert.strictEqual(account.points, 10000);

  account = { _id: 'swap-user', points: 20000, gramBalance: 0, usdtBalance: 0 };
  ledgerRows = [];
  response = await request(exchange, { from: 'UP', to: 'USDT', amount: '10000' });
  assert.strictEqual(response.status, 200);
  assert.strictEqual(response.body.receivedAmount, 1);
  assert.strictEqual(response.body.rates.upToUsdt, 0.0001);
  assert.strictEqual(account.points, 10000);
  assert.strictEqual(account.usdtBalance, 1);

  account = { _id: 'swap-user', points: 10000, gramBalance: 0, usdtBalance: 0 };
  ledgerRows = [];
  failLiveRates = true;
  response = await request(exchange, { from: 'UP', to: 'GRAM', amount: '10000' });
  failLiveRates = false;
  assert.strictEqual(response.status, 503, 'UP-to-GRAM refuses to use a stale configured rate when STON.fi is unavailable');
  assert.strictEqual(response.body.code, 'STON_RATES_UNAVAILABLE');
  assert.strictEqual(account.points, 10000);
  assert.strictEqual(account.gramBalance, 0);
  assert.strictEqual(ledgerRows.length, 0);

  account = { _id: 'swap-user', points: 0, gramBalance: 1, usdtBalance: 0 };
  ledgerRows = [];
  failLiveRates = true;
  response = await request(exchange, { from: 'GRAM', to: 'UP', amount: '1' });
  failLiveRates = false;
  assert.strictEqual(response.status, 503, 'GRAM-to-UP also rejects the legacy rate when STON.fi is unavailable');
  assert.strictEqual(response.body.code, 'STON_RATES_UNAVAILABLE');
  assert.strictEqual(account.gramBalance, 1);
  assert.strictEqual(account.points, 0);
  assert.strictEqual(ledgerRows.length, 0);

  account = { _id: 'swap-user', points: 0, gramBalance: 0.1, usdtBalance: 0 };
  ledgerRows = [];
  response = await request(exchange, { from: 'GRAM', to: 'UP', amount: '2.0' });
  assert.strictEqual(response.status, 400);
  assert.strictEqual(response.body.code, 'EXCHANGE_INSUFFICIENT_BALANCE');
  assert.strictEqual(account.gramBalance, 0.1);
  assert.strictEqual(ledgerRows.length, 0);

  account = { _id: 'swap-user', points: 0, gramBalance: 3, usdtBalance: 0 };
  ledgerRows = [];
  failLedger = true;
  response = await request(exchange, { from: 'GRAM', to: 'UP', amount: '0.5' });
  failLedger = false;
  assert.strictEqual(response.status, 500);
  assert.strictEqual(response.body.code, 'EXCHANGE_ACCOUNTING_FAILED');
  assert.strictEqual(account.gramBalance, 3, 'the transaction adapter rolls back balance changes if ledger persistence fails');
  assert.strictEqual(account.points, 0);

  transactionsUnavailable = true;
  response = await request(exchange, { from: 'GRAM', to: 'UP', amount: '0.5' });
  transactionsUnavailable = false;
  assert.strictEqual(response.status, 503);
  assert.strictEqual(response.body.code, 'EXCHANGE_TEMPORARILY_UNAVAILABLE');

  transactionsUnavailable = false;
  failSettings = true;
  account = { _id: 'swap-user', points: 10000, gramBalance: 0, usdtBalance: 0 };
  response = await request(exchange, { from: 'UP', to: 'USDT', amount: '1000' });
  failSettings = false;
  assert.strictEqual(response.status, 200, 'fixed UP/USDT valuation does not depend on the obsolete settings.rate');
  assert.strictEqual(response.body.receivedAmount, 0.1);

  for (const currency of ['gram', 'points', 'usdt']) {
    assert.ok(PointsLedger.schema.path('currency').enumValues.includes(currency), `PointsLedger accepts ${currency}`);
    assert.ok(Transaction.schema.path('currency').enumValues.includes(currency), `Transaction journal accepts ${currency}`);
  }
  for (const asset of ['GRAM', 'UP', 'USDT']) {
    assert.ok(PointsLedger.schema.path('asset').enumValues.includes(asset), `PointsLedger accepts asset ${asset}`);
    assert.ok(Transaction.schema.path('asset').enumValues.includes(asset), `Transaction journal accepts asset ${asset}`);
  }
  console.log('PASS — all six swap directions use live GRAM pricing or fixed UP/USDT parity, including reciprocal math, ledger debits, and fail-closed rates');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  if (originalGetLiveRates) require('../routes/stonFi').getLiveRates = originalGetLiveRates;
  idempotency.executeIdempotently = originals.executeIdempotently;
  ledger.recordLedgerRequired = originals.recordLedgerRequired;
  Settings.getGlobal = originals.getGlobal;
  User.findOneAndUpdate = originals.findOneAndUpdate;
});
