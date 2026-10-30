'use strict';
// Explicit opt-in only; excluded from tests/*.test.js. Never accepts remote DSNs.
const assert = require('assert');
const mongoose = require('mongoose');
const uri = process.env.GRAMUP_QA_MONGO_URI || '';
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/gramup_qa(?:[?]|$)/.test(uri)) {
  throw new Error('Only an explicitly provided loopback gramup_qa database is permitted.');
}
process.env.BOT_TOKEN = '';
const User = require('../models/User');
const Ledger = require('../models/PointsLedger');
const Transaction = require('../models/Transaction');
const Settings = require('../models/Settings');
const { withMongoTransaction, verifyMongoTransactionCapability } = require('../utils/mongoTransaction');
const { claimDailyCheckin, runDailyAutoCheckinSweep } = require('../utils/dailyAutoCheckin');
const { recordLedgerRequired } = require('../utils/ledger');
const { executeIdempotently } = require('../utils/idempotency');
const { linkReferral } = require('../utils/referralSystem');
const output = [];
let httpServer;
async function qaUser(code, fields = {}) {
  return User.create({ telegramId: '990000' + code, referralCode: 'QA' + code, firstName: 'QA only', ...fields });
}
(async () => {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  assert.ok(hello.setName, 'real replica set required');
  for (const name of ['ReferralRelationship', 'NotificationDelivery', 'IdempotencyOperation']) require('../models/' + name);
  for (const name of mongoose.modelNames()) await mongoose.model(name).init();
  assert.strictEqual((await verifyMongoTransactionCapability()).supported, true);
  const user = await qaUser('101');
  await runDailyAutoCheckinSweep(new Date(), { settings: { dailyAutoCheckinEnabled: true } });
  assert.strictEqual((await User.findById(user._id)).points, 0);
  const claims = await Promise.all(Array.from({ length: 5 }, () => claimDailyCheckin(user._id)));
  assert.strictEqual(claims.filter(row => row.status === 'credited').length, 1);
  assert.strictEqual((await User.findById(user._id)).points, 5);
  assert.strictEqual(await Ledger.countDocuments({ user: user._id, type: 'checkin' }), 1);
  const journalCollection = mongoose.connection.db.collection('transactions');
  assert.strictEqual(await journalCollection.countDocuments({ type: 'checkin' }), 1);
  output.push('PASS — five concurrent manual daily claims produce one 5-point credit, one ledger row and one Transactions row');

  const operation = () => executeIdempotently({
    userId: user._id, scope: 'exchange_gram_to_points', key: 'qa-same-operation-001', body: { amount: 50 },
    execute: async session => {
      const updated = await User.findByIdAndUpdate(user._id, { $inc: { points: 50 } }, { new: true, session });
      const ledger = await recordLedgerRequired({ user: user._id, type: 'admin_adjust', currency: 'points', amount: 50,
        balanceAfter: updated.points, sourceId: 'qa-idempotency-credit-001', session });
      assert.strictEqual(ledger.created, true);
      return { body: { success: true, points: updated.points } };
    }
  });
  const operations = await Promise.all(Array.from({ length: 4 }, operation));
  assert.strictEqual(operations.filter(row => !row.replayed).length, 1);
  assert.strictEqual((await User.findById(user._id)).points, 55);
  assert.strictEqual(await journalCollection.countDocuments({ sourceId: 'qa-idempotency-credit-001' }), 1);
  output.push('PASS — concurrent same-key requests replay one committed balance mutation and one Transactions row');

  const rollbackUser = await qaUser('102');
  const originalCreate = Transaction.create;
  const originalSave = Transaction.prototype.save;
  try {
    Transaction.create = async () => { throw new Error('QA injected journal failure'); };
    Transaction.prototype.save = async () => { throw new Error('QA injected journal failure'); };
    await assert.rejects(claimDailyCheckin(rollbackUser._id), /QA injected journal failure/);
  } finally { Transaction.create = originalCreate; Transaction.prototype.save = originalSave; }
  assert.strictEqual((await User.findById(rollbackUser._id)).points, 0);
  assert.strictEqual(await Ledger.countDocuments({ user: rollbackUser._id }), 0);
  output.push('PASS — injected Transactions failure rolls back user balance and the existing ledger atomically');

  const transaction = await Transaction.findOne({ sourceId: 'qa-idempotency-credit-001' });
  assert.ok(transaction);
  await assert.rejects(Transaction.updateOne({ _id: transaction._id }, { $set: { amount: 999 } }));
  await assert.rejects(Transaction.deleteOne({ _id: transaction._id }));
  assert.strictEqual((await Transaction.findById(transaction._id)).amount, 50);
  output.push('PASS — Transactions update and delete are rejected in the Mongoose application layer');

  const source = await qaUser('103', { points: 2 });
  const beforeCount = await Ledger.countDocuments({ user: source._id });
  await assert.rejects(withMongoTransaction(async session => {
    const updated = await User.findOneAndUpdate({ _id: source._id, points: { $gte: 10 } }, { $inc: { points: -10 } }, { new: true, session });
    if (!updated) throw new Error('INSUFFICIENT_BALANCE');
  }), /INSUFFICIENT_BALANCE/);
  assert.strictEqual((await User.findById(source._id)).points, 2);
  assert.strictEqual(await Ledger.countDocuments({ user: source._id }), beforeCount);
  output.push('PASS — insufficient-funds conditional debit preserves nonnegative balance');

  const referrer = await qaUser('104');
  const invitee = await qaUser('105');
  const referrals = await Promise.all(Array.from({ length: 4 }, () => linkReferral({
    referredUserId: invitee._id, referrerId: referrer._id
  })));
  assert.strictEqual(referrals.filter(row => row.welcomePaid).length, 1);
  assert.strictEqual((await User.findById(referrer._id)).points, 10);
  assert.strictEqual((await User.findById(invitee._id)).points, 5);
  assert.strictEqual(await journalCollection.countDocuments({ type: 'referral_welcome' }), 1);
  assert.strictEqual(await journalCollection.countDocuments({ type: 'referral_initial' }), 1);
  output.push('PASS — four concurrent referral links produce exactly +10 inviter and +5 invitee with two immutable financial journal rows');

  // Importing server.js does not run background jobs or connect to any other DB.
  process.env.MONGO_URI = uri;
  process.env.BOT_TOKEN = 'qa-dummy-token-never-sent';
  process.env.NODE_ENV = 'test';
  const { app } = require('../server');
  httpServer = app.listen(0, '127.0.0.1');
  await new Promise(resolve => httpServer.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
  let response = await fetch(baseUrl + '/healthz');
  assert.strictEqual(response.status, 200);
  response = await fetch(baseUrl + '/readyz');
  assert.strictEqual(response.status, 200);
  response = await fetch(baseUrl + '/api/points/me');
  assert.strictEqual(response.status, 401);
  response = await fetch(baseUrl + '/api/tasks', { headers: { 'X-Telegram-Init-Data': 'auth_date=1&user=%7B%22id%22%3A1%7D' } });
  assert.strictEqual(response.status, 401);
  output.push('PASS — actual Express HTTP mounts return health/readiness 200 and reject unsigned private profile/task requests');

  const ledgerRows = await Ledger.find({}).lean();
  const transactionRows = await journalCollection.find({}).toArray();
  assert.strictEqual(transactionRows.length, ledgerRows.length);
  assert.ok(transactionRows.every(row => row.transactionId && row.sourceId && row.type && row.status));
  console.log(output.join('\n'));
  console.log('PASS — local Replica Set integration only; no production DB, real users or Telegram messages');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (httpServer) await new Promise(resolve => httpServer.close(resolve));
  if (mongoose.connection.readyState === 1) {
    // The URI guard above ensures this can only remove the disposable local QA DB.
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
