'use strict';

const assert = require('assert');

function query(value) {
  return {
    select() { return this; },
    session() { return this; },
    lean: async () => (typeof value === 'function' ? value() : value),
    then(resolve, reject) { return Promise.resolve(typeof value === 'function' ? value() : value).then(resolve, reject); }
  };
}

const modelPaths = {
  User: require.resolve('../models/User'),
  Settings: require.resolve('../models/Settings'),
  ReferralRelationship: require.resolve('../models/ReferralRelationship'),
  PointsLedger: require.resolve('../models/PointsLedger'),
  NotificationDelivery: require.resolve('../utils/notificationDelivery'),
  MongoTransaction: require.resolve('../utils/mongoTransaction')
};

const parent4 = { _id: 'l4', referredBy: null, isBanned: false, accountReviewStatus: 'normal', referralRiskScore: 0, referralRiskBlocked: false, points: 0 };
const parent3 = { _id: 'l3', referredBy: 'l4', isBanned: false, accountReviewStatus: 'normal', referralRiskScore: 0, referralRiskBlocked: false, points: 0 };
const parent2 = { _id: 'l2', referredBy: 'l3', isBanned: false, accountReviewStatus: 'normal', referralRiskScore: 0, referralRiskBlocked: false, points: 0 };
const parent1 = { _id: 'l1', referredBy: 'l2', isBanned: false, accountReviewStatus: 'normal', referralRiskScore: 0, referralRiskBlocked: false, points: 0 };
const origin = { _id: 'origin', referredBy: 'l1', isBanned: false, accountReviewStatus: 'normal', referralRiskScore: 0, referralRiskBlocked: false, points: 0, createdAt: new Date('2026-09-01T00:00:00Z'), referralEligibilityStatus: 'eligible', referralEligibleAt: new Date('2026-09-08T00:00:00Z') };
const users = new Map([parent4, parent3, parent2, parent1, origin].map(user => [user._id, user]));
const entries = new Map();
const relationships = [];

const fakeUser = {
  findById(id) { return query(users.get(String(id)) || null); },
  async findByIdAndUpdate(id, update) {
    const user = users.get(String(id));
    if (!user) return null;
    user.points += Number(update.$inc?.points || 0);
    return { ...user };
  }
};
const fakeSettings = { findOne: () => query({ referralLevelRates: [10, 5, 3, 2] }) };
const fakeRelationship = {
  findOneAndUpdate(filter, update) {
    const row = { referrerId: filter.referrerId, referredUserId: filter.referredUserId, level: update.$set.level, status: update.$set.status };
    relationships.push(row);
    return query(row);
  }
};
function FakePointsLedger(payload) {
  this.payload = payload;
}
FakePointsLedger.prototype.save = async function save() {
  const entry = { ...this.payload };
  entries.set(entry.sourceId, entry);
  return entry;
};
FakePointsLedger.findOne = filter => query(entries.has(filter.sourceId) ? { _id: filter.sourceId } : null);

require.cache[modelPaths.User] = { id: modelPaths.User, filename: modelPaths.User, loaded: true, exports: fakeUser };
require.cache[modelPaths.Settings] = { id: modelPaths.Settings, filename: modelPaths.Settings, loaded: true, exports: fakeSettings };
require.cache[modelPaths.ReferralRelationship] = { id: modelPaths.ReferralRelationship, filename: modelPaths.ReferralRelationship, loaded: true, exports: fakeRelationship };
require.cache[modelPaths.PointsLedger] = { id: modelPaths.PointsLedger, filename: modelPaths.PointsLedger, loaded: true, exports: FakePointsLedger };
require.cache[modelPaths.NotificationDelivery] = { id: modelPaths.NotificationDelivery, filename: modelPaths.NotificationDelivery, loaded: true, exports: { sendNotificationOnce: async () => ({ status: 'sent' }) } };
require.cache[modelPaths.MongoTransaction] = { id: modelPaths.MongoTransaction, filename: modelPaths.MongoTransaction, loaded: true, exports: { withMongoTransaction: async work => work({ id: 'tx-test' }) } };

const { recordLedgerRequired } = require('../utils/ledger');
const { distributeReferralCommissions } = require('../utils/referralSystem');

(async () => {
  const earning = { user: origin._id, amount: 100, currency: 'points', type: 'task', sourceId: 'task-source-100', transactionId: 'task-tx-100', session: { id: 'tx-1' } };
  await recordLedgerRequired(earning);
  const paid = [...entries.values()]
    .filter(entry => entry.type === 'referral_commission')
    .sort((a, b) => a.referralLevel - b.referralLevel);
  assert.deepStrictEqual(paid.map(entry => [entry.referralLevel, entry.amount]), [[1, 10], [2, 5], [3, 3], [4, 1]]);
  assert.deepStrictEqual([parent1, parent2, parent3, parent4].map(user => user.points), [10, 5, 3, 1]);
  assert.ok(paid.every(entry => entry.currency === 'points'));
  assert.deepStrictEqual(relationships.map(row => row.level), [1, 2, 3, 4]);

  const duplicate = await distributeReferralCommissions(earning, { id: 'tx-2' });
  assert.deepStrictEqual(duplicate, []);
  assert.deepStrictEqual([parent1, parent2, parent3, parent4].map(user => user.points), [10, 5, 3, 1]);

  const youngOrigin = { ...origin, _id: 'young', referredBy: parent1._id, createdAt: new Date(), referralEligibilityStatus: 'pending', referralEligibleAt: null };
  users.set(youngOrigin._id, youngOrigin);
  const youngPaid = await distributeReferralCommissions({ ...earning, user: youngOrigin._id, sourceId: 'task-young-100' }, { id: 'tx-3' });
  assert.deepStrictEqual(youngPaid, [], 'a non-active account must not generate referral commissions');

  parent2.referralRiskScore = 50;
  const blocked = await distributeReferralCommissions({ ...earning, sourceId: 'task-risk-100' }, { id: 'tx-4' });
  assert.deepStrictEqual(blocked.map(item => [item.level, item.amount]), [[1, 10]], 'a risky L2 ancestor blocks L2+ without invalidating a clean L1');

  console.log('ALL PASS — real Spin ledger trigger, immediate L1-L4 commission, young account, anti-abuse and idempotency');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
