'use strict';

const assert = require('assert');
const express = require('express');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const userId = new mongoose.Types.ObjectId();
const user = {
  _id: userId,
  telegramId: 'up-balance-test-user',
  firstName: 'UP Test',
  points: 1750,
  gramBalance: 4.25,
  streak: 3,
  totalCheckins: 8,
  lastCheckIn: null,
  language: 'en'
};
const createdAt = new Date('2026-10-01T12:00:00.000Z');
const ledgerRows = [{
  _id: new mongoose.Types.ObjectId(),
  user: userId,
  type: 'task',
  currency: 'points',
  amount: 50,
  balanceAfter: 1750,
  description: 'Task reward',
  createdAt
}];

function query(rows) {
  return {
    sort() { return this; },
    limit() { return this; },
    select() { return this; },
    lean: async () => rows
  };
}

const settingsPath = require.resolve('../models/Settings');
require.cache[settingsPath] = { id: settingsPath, filename: settingsPath, loaded: true, exports: {
  getGlobal: async () => ({ rate: 0.002, minWithdrawPoints: 1000, gramUsdPrice: 2 })
} };
const ledgerPath = require.resolve('../models/PointsLedger');
require.cache[ledgerPath] = { id: ledgerPath, filename: ledgerPath, loaded: true, exports: {
  aggregate: async () => [{ total: 1600 }],
  find: () => query(ledgerRows)
} };
const depositPath = require.resolve('../models/Deposit');
require.cache[depositPath] = { id: depositPath, filename: depositPath, loaded: true, exports: {
  find: () => query([])
} };
const authPath = require.resolve('../utils/unifiedAuth');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
  requireUnifiedAuth: () => (req, res, next) => { req.dbUser = user; next(); }
} };
const membershipPath = require.resolve('../utils/membership');
require.cache[membershipPath] = { id: membershipPath, filename: membershipPath, loaded: true, exports: {
  withMembership: middleware => middleware
} };
const securityPath = require.resolve('../utils/apiSecurity');
require.cache[securityPath] = { id: securityPath, filename: securityPath, loaded: true, exports: {
  sensitiveRateLimit: () => (req, res, next) => next()
} };
const ledgerUtilPath = require.resolve('../utils/ledger');
require.cache[ledgerUtilPath] = { id: ledgerUtilPath, filename: ledgerUtilPath, loaded: true, exports: {
  recordLedgerRequired: async () => ({ created: true })
} };

const User = require('../models/User');
const legacyDoc = new User({ telegramId: 'legacy-up-alias-test', referralCode: 'UPTEST', points: 1750, gramBalance: 4.25 });
assert.strictEqual(User.schema.path('points').options.alias, 'upBalance', 'existing persisted points path declares the UP alias');
assert.ok(User.schema.virtuals.upBalance, 'Mongoose exposes the alias as a virtual accessor');
assert.strictEqual(legacyDoc.upBalance, 1750, 'legacy stored points are exposed by the model as UP');
legacyDoc.upBalance = 1800;
assert.strictEqual(legacyDoc.points, 1800, 'writing the alias updates the same existing canonical balance');

const pointsRouter = require('../routes/points');
const app = express();
app.use('/api/points', pointsRouter);

(async () => {
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    let response = await fetch(`${base}/api/points/me`);
    assert.strictEqual(response.status, 200);
    let body = await response.json();
    assert.strictEqual(body.upBalance, 1750, 'main status API exposes current legacy points as UP');
    assert.strictEqual(body.points, 1750, 'legacy API field remains available');
    assert.strictEqual(body.gramBalance, 4.25, 'existing GRAM balance remains unchanged');
    assert.deepStrictEqual(body.balances, { UP: 1750, GRAM: 4.25 });

    response = await fetch(`${base}/api/points/history`);
    assert.strictEqual(response.status, 200);
    body = await response.json();
    assert.strictEqual(body.upBalance, 1750, 'history response includes current UP balance');
    assert.strictEqual(body.history.length, 1);
    assert.strictEqual(body.history[0].currency, 'points', 'stored ledger currency is preserved for compatibility');
    assert.strictEqual(body.history[0].tokenSymbol, 'UP', 'ledger point entry is labelled with the public UP ticker');
    assert.strictEqual(body.history[0].upAmount, 50);
    assert.strictEqual(body.history[0].upBalanceAfter, 1750);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }

  const appJs = fs.readFileSync(path.join(repo, 'public/js/app.js'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(repo, 'public/index.html'), 'utf8');
  const css = fs.readFileSync(path.join(repo, 'public/css/style.css'), 'utf8');
  const i18n = fs.readFileSync(path.join(repo, 'public/js/i18n.js'), 'utf8');
  assert.match(appJs, /headerUpBalanceValue/);
  assert.match(appJs, /formatPoints\(state\.points\).*UP/s);
  assert.match(appJs, /function upBalanceFromResponse\(response, fallback = state\.points\)[\s\S]*?response\?\.upBalance \?\? response\?\.points/);
  assert.match(appJs, /state\.points = upBalanceFromResponse\(data\);/);
  assert.match(appJs, /tbLabel.*wallet_points_card_title[\s\S]*?class="upTokenMark"[\s\S]*?formatPoints\(state\.points\)/);
  assert.match(appJs, /class="walletOverviewValue"[\s\S]*?class="upTokenMark upTokenMarkWallet"[\s\S]*?formatPoints\(state\.points\)[\s\S]*?UP/);
  assert.match(appJs, /const unit = item\.tokenSymbol \|\| \(item\.currency === "gram" \? "GRAM" : t\("points_unit"\)\);/);
  assert.match(indexHtml, /id="headerUpBalance"/);
  assert.match(css, /\.upTokenMark\s*\{/);
  for (const locale of ['fa', 'ps', 'en']) {
    const section = i18n.split(`  ${locale}: {`)[1].split(locale === 'en' ? '\n};' : `\n  ${locale === 'fa' ? 'ps' : 'en'}: {`)[0];
    assert.match(section, /points_unit:\s*"UP"/);
    assert.match(section, /wallet_points_card_title:/);
  }

  console.log('PASS — legacy balance maps one-to-one to UP; status/history APIs, GRAM balance, ledger history, and UI labels are compatible');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
