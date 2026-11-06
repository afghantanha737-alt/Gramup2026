'use strict';

const assert = require('assert');
const PointsLedger = require('../models/PointsLedger');
const Transaction = require('../models/Transaction');
const { recordLedger } = require('../utils/ledger');
const { appendTransaction, hashTransaction } = require('../utils/transactionJournal');
const { hashIdempotencyRequest } = require('../utils/idempotency');

const session = { id: 'offline-session' };
const ledgerRows = new Map();
const transactionRows = new Map();
let failJournal = false;

function duplicateError() {
  const error = new Error('duplicate');
  error.code = 11000;
  return error;
}

function matches(row, filter) {
  if (!row) return false;
  if (filter.sourceId && row.sourceId !== filter.sourceId) return false;
  if (filter.transactionId && row.transactionId !== filter.transactionId) return false;
  if (filter.$or && !filter.$or.some(term => matches(row, term))) return false;
  if (filter.user && String(row.user) !== String(filter.user)) return false;
  if (filter.currency && row.currency !== filter.currency) return false;
  return true;
}

function query(value) {
  return { session() { return this; }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } };
}

function FakePointsLedger(payload) {
  Object.assign(this, payload, { _id: `ledger-${ledgerRows.size + 1}` });
}
FakePointsLedger.prototype.save = async function save() {
  if ([...ledgerRows.values()].some(row => row.sourceId === this.sourceId || row.transactionId === this.transactionId)) throw duplicateError();
  ledgerRows.set(this.sourceId, this);
  return this;
};
FakePointsLedger.findOne = filter => query([...ledgerRows.values()].find(row => matches(row, filter)) || null);

function FakeTransaction(payload) {
  Object.assign(this, payload, { _id: `transaction-${transactionRows.size + 1}` });
}
FakeTransaction.prototype.save = async function save() {
  if (failJournal) throw new Error('journal unavailable');
  if ([...transactionRows.values()].some(row => (
    String(row.user) === String(this.user)
    && row.currency === this.currency
    && (row.sourceId === this.sourceId || row.transactionId === this.transactionId)
  ))) throw duplicateError();
  transactionRows.set(this.sourceId, this);
  return this;
};
FakeTransaction.findOne = filter => query([...transactionRows.values()].find(row => matches(row, filter)) || null);

(async () => {
  const ledgerTypes = PointsLedger.schema.path('type').enumValues;
  assert(ledgerTypes.includes('referral_welcome'));
  assert(ledgerTypes.includes('mining_claim'));
  assert(Transaction.schema.indexes().some(([keys, options]) => keys.user === 1 && keys.currency === 1 && keys.sourceId === 1 && options.unique === true));
  assert(Transaction.schema.indexes().some(([keys, options]) => keys.user === 1 && keys.currency === 1 && keys.transactionId === 1 && options.unique === true));

  const first = await recordLedger({
    PointsLedgerModel: FakePointsLedger,
    TransactionModel: FakeTransaction,
    user: 'user-1',
    type: 'task',
    currency: 'points',
    amount: 25,
    balanceAfter: 125,
    description: 'offline task',
    sourceId: 'task:offline:1',
    transactionId: 'task-tx-offline-1',
    session
  });
  assert.strictEqual(first.created, true);
  assert.strictEqual(first.journaled, true);
  assert.strictEqual(transactionRows.size, 1, 'every new ledger row has one journal row');
  const journal = transactionRows.get('task:offline:1');
  assert.strictEqual(journal.amount, 25);
  assert.strictEqual(journal.balanceBefore, 100);
  assert.strictEqual(journal.balanceAfter, 125);
  assert.strictEqual(journal.status, 'posted');
  assert.strictEqual(journal.integrityHash, hashTransaction({
    user: 'user-1', currency: 'points', sourceId: 'task:offline:1', transactionId: 'task-tx-offline-1',
    type: 'task', status: 'posted', amount: 25, balanceBefore: 100, balanceAfter: 125,
    description: 'offline task', referralLevel: null, sourceUserId: null, recipientUserId: null,
    commissionRatePercent: null, earningTransactionId: ''
  }));

  const duplicate = await recordLedger({
    PointsLedgerModel: FakePointsLedger,
    TransactionModel: FakeTransaction,
    user: 'user-1', type: 'task', currency: 'points', amount: 25, balanceAfter: 125,
    sourceId: 'task:offline:1', transactionId: 'task-tx-offline-1', session
  });
  assert.strictEqual(duplicate.created, false);
  assert.strictEqual(duplicate.duplicate, true);
  assert.strictEqual(transactionRows.size, 1, 'replay does not append or double-credit');

  failJournal = true;
  await assert.rejects(recordLedger({
    PointsLedgerModel: FakePointsLedger,
    TransactionModel: FakeTransaction,
    user: 'user-1', type: 'checkin', currency: 'points', amount: 5, balanceAfter: 130,
    sourceId: 'checkin:offline:1', transactionId: 'checkin-tx-offline-1', session
  }), /journal unavailable/);
  assert.strictEqual(transactionRows.has('checkin:offline:1'), false);
  // A real withMongoTransaction rolls the preceding PointsLedger insert back;
  // this adapter emulates that rollback explicitly for the offline assertion.
  ledgerRows.delete('checkin:offline:1');
  failJournal = false;

  await assert.rejects(appendTransaction({
    Transaction: FakeTransaction,
    user: 'user-1', type: 'task', currency: 'points', amount: 99,
    balanceAfter: 199, sourceId: 'task:offline:1', transactionId: 'different-tx', session
  }), error => error.code === 'TRANSACTION_JOURNAL_CONFLICT');

  assert.notStrictEqual(
    hashIdempotencyRequest('withdraw', { at: new Date('2026-01-01T00:00:00Z') }),
    hashIdempotencyRequest('withdraw', { at: new Date('2026-01-02T00:00:00Z') }),
    'different dates must not share a request fingerprint'
  );
  assert.notStrictEqual(
    hashIdempotencyRequest('withdraw', {}),
    hashIdempotencyRequest('withdraw', { amount: undefined }),
    'omitted and explicitly undefined fields must not share a fingerprint'
  );

  console.log('PASS — append-only Transaction journal, same-session mirror, duplicate replay guard, rollback signaling, and idempotency fingerprints');
})().catch(error => { console.error(error); process.exitCode = 1; });
