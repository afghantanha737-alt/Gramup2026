'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));
let state = { withdrawal: { _id: 'w1', user: 'u1', status: 'pending', cryptoAmount: 2 }, user: { _id: 'u1', gramBalance: 3 }, ledger: [] };
let failLedger = false;
const cached = new Map();
function mock(relative, exports) {
  const filename = require.resolve(path.join(root, relative));
  cached.set(filename, require.cache[filename]);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
mock('models/Withdrawal', {
  findById: () => ({ session: async () => clone(state.withdrawal) }),
  findOneAndUpdate: async (filter, update) => {
    if (state.withdrawal.status !== filter.status) return null;
    Object.assign(state.withdrawal, update.$set);
    return clone(state.withdrawal);
  }
});
mock('models/User', { findByIdAndUpdate: async (id, update) => {
  state.user.gramBalance += update.$inc.gramBalance;
  return clone(state.user);
} });
mock('utils/ledger', { recordLedgerRequired: async entry => {
  if (failLedger) throw new Error('ledger offline');
  if (state.ledger.some(row => row.sourceId === entry.sourceId)) return { created: false };
  state.ledger.push({ sourceId: entry.sourceId, amount: entry.amount });
  return { created: true };
} });
mock('utils/mongoTransaction', { withMongoTransaction: async work => {
  const before = clone(state);
  try { return await work({ testSession: true }); }
  catch (error) { state = before; throw error; }
} });
mock('utils/adminLog', { recordAdminLogRequired: async () => ({}) });
const { transitionWithdrawalWithRefund } = require('../utils/withdrawalFinance');

(async () => {
  const args = { withdrawalId: 'w1', targetStatus: 'cancelled', allowedStatuses: ['pending'] };
  await transitionWithdrawalWithRefund(args);
  assert.strictEqual(state.user.gramBalance, 5);
  assert.strictEqual(state.ledger.length, 1);
  await assert.rejects(transitionWithdrawalWithRefund(args), error => error.code === 'WITHDRAWAL_NOT_REFUNDABLE');
  assert.strictEqual(state.user.gramBalance, 5);
  state.withdrawal.status = 'pending'; // Simulates an orphan ledger against a legacy/stale status.
  await assert.rejects(transitionWithdrawalWithRefund(args), error => error.code === 'WITHDRAWAL_REFUND_DUPLICATE');
  assert.strictEqual(state.user.gramBalance, 5, 'duplicate ledger must roll back the additional balance increment');
  assert.strictEqual(state.withdrawal.status, 'pending');
  state.ledger = [];
  failLedger = true;
  await assert.rejects(transitionWithdrawalWithRefund(args), /ledger offline/);
  assert.strictEqual(state.user.gramBalance, 5);
  assert.strictEqual(state.withdrawal.status, 'pending');
  const admin = fs.readFileSync(path.join(root, 'routes/admin.js'), 'utf8');
  const catalog = admin.slice(admin.indexOf("router.put('/vip/plans'"), admin.indexOf("router.get('/vip/reserve'"));
  const funding = admin.slice(admin.indexOf("router.post('/vip/reserve/fund'"), admin.indexOf("router.get('/vip/reserve/dashboard'"));
  assert.match(catalog, /withMongoTransaction\(async session/);
  assert.match(catalog, /ordered: true, session/);
  assert.match(catalog, /recordAdminLogRequired/);
  assert.match(funding, /recordAdminLogRequired/);
  assert.match(funding, /}, session\)/);
  console.log('PASS — withdrawal duplicate refund and ledger-error rollback (mocked transaction); catalog/Reserve mandatory atomic audit contracts');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  for (const [filename, previous] of cached) {
    if (previous) require.cache[filename] = previous; else delete require.cache[filename];
  }
});
