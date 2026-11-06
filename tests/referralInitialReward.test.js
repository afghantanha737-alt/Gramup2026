'use strict';

const assert = require('assert');

function query(value) {
  return {
    select() { return this; },
    session() { return this; },
    then(resolve, reject) { return Promise.resolve(typeof value === 'function' ? value() : value).then(resolve, reject); }
  };
}

const paths = {
  User: require.resolve('../models/User'),
  Settings: require.resolve('../models/Settings'),
  Relationship: require.resolve('../models/ReferralRelationship'),
  PointsLedger: require.resolve('../models/PointsLedger'),
  Notification: require.resolve('../utils/notificationDelivery'),
  Mongo: require.resolve('../utils/mongoTransaction'),
  Ledger: require.resolve('../utils/ledger'),
  Messages: require.resolve('../utils/botMessages')
};

const referrer = { _id: 'referrer', telegramId: '200', referredBy: null, isBanned: false, accountReviewStatus: 'normal', referralRiskScore: 0, referralRiskBlocked: false, points: 0, language: 'en', phoneCountryCode: '+93', phoneVerifiedAt: new Date(), referralMessageConsent: 'granted' };
const invitee = { _id: 'invitee', telegramId: '100', referredBy: null, referralInitialRewardEligible: false, isBanned: false, accountReviewStatus: 'normal', referralRiskScore: 0, referralRiskBlocked: false, points: 0, firstName: 'New User' };
const users = new Map([[referrer._id, referrer], [invitee._id, invitee]]);
const ledgerRows = [];
let notificationCount = 0;

const userModel = {
  findById(id) { return query(users.get(String(id)) || null); },
  findOneAndUpdate(filter, update) {
    const user = users.get(String(filter._id));
    if (!user) return query(null);
    if (filter.referredBy === null && user.referredBy !== null) return query(null);
    if (filter.referralInitialRewardEligible === true && user.referralInitialRewardEligible !== true) return query(null);
    Object.assign(user, update.$set || {});
    user.points += Number(update.$inc?.points || 0);
    return query({ ...user });
  },
  async findByIdAndUpdate(id, update) {
    const user = users.get(String(id));
    if (!user) return null;
    Object.assign(user, update.$set || {});
    user.points += Number(update.$inc?.points || 0);
    return { ...user };
  },
  async updateOne(filter, update) {
    const user = users.get(String(filter._id));
    if (user) Object.assign(user, update.$set || {});
    return { acknowledged: true };
  }
};
const relationshipModel = {
  findOneAndUpdate(filter, update) {
    const row = {
      referrerId: filter.referrerId,
      referredUserId: filter.referredUserId,
      status: update.$set.status,
      initialRewardStatus: update.$setOnInsert.initialRewardStatus,
      async save() { return this; }
    };
    return query(row);
  }
};
const ledgerModel = { findOne: () => query(null) };
const ledger = {
  async recordLedgerRequired(payload) {
    const row = { ...payload, type: payload.type || 'referral_initial' };
    ledgerRows.push(row);
    return { created: true, entry: row };
  }
};

require.cache[paths.User] = { id: paths.User, filename: paths.User, loaded: true, exports: userModel };
require.cache[paths.Settings] = { id: paths.Settings, filename: paths.Settings, loaded: true, exports: { findOne: () => query({ referralLevelRates: [10, 5, 3, 2] }) } };
require.cache[paths.Relationship] = { id: paths.Relationship, filename: paths.Relationship, loaded: true, exports: relationshipModel };
require.cache[paths.PointsLedger] = { id: paths.PointsLedger, filename: paths.PointsLedger, loaded: true, exports: ledgerModel };
require.cache[paths.Notification] = { id: paths.Notification, filename: paths.Notification, loaded: true, exports: { sendNotificationOnce: async () => { notificationCount += 1; return { status: 'sent' }; } } };
require.cache[paths.Mongo] = { id: paths.Mongo, filename: paths.Mongo, loaded: true, exports: { withMongoTransaction: async work => work({ id: 'tx-initial' }) } };
require.cache[paths.Ledger] = { id: paths.Ledger, filename: paths.Ledger, loaded: true, exports: ledger };
require.cache[paths.Messages] = { id: paths.Messages, filename: paths.Messages, loaded: true, exports: { botText: () => 'test' } };

const { linkReferral } = require('../utils/referralSystem');

(async () => {
  const result = await linkReferral({ referredUserId: invitee._id, referrerId: referrer._id, source: 'signup' });
  assert.strictEqual(result.initialPaid, true);
  assert.strictEqual(referrer.points, 10);
  assert.strictEqual(invitee.referredBy, referrer._id);
  assert.strictEqual(invitee.referralInitialRewardEligible, false);
  assert.strictEqual(ledgerRows.length, 1);
  assert.strictEqual(ledgerRows[0].type, 'referral_initial');
  assert.strictEqual(ledgerRows[0].amount, 10);
  assert.strictEqual(ledgerRows[0].sourceId, `referral-initial:${invitee._id}`);
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(notificationCount, 1, 'a successful initial reward sends one Telegram notification');
  const duplicateLink = await linkReferral({ referredUserId: invitee._id, referrerId: referrer._id, source: 'signup' });
  assert.strictEqual(duplicateLink.initialPaid, false);
  assert.strictEqual(referrer.points, 10, 'the same referral cannot receive the initial reward twice');

  users.delete(invitee._id);
  const reRegistered = { ...invitee, _id: 'invitee-reregistered', referredBy: null, referralInitialRewardEligible: false };
  users.set(reRegistered._id, reRegistered);
  const reRegisterResult = await linkReferral({ referredUserId: reRegistered._id, referrerId: referrer._id, source: 'signup' });
  assert.strictEqual(reRegisterResult.initialPaid, true);
  assert.strictEqual(referrer.points, 20, 'a deleted and re-registered invitee receives a fresh initial reward');
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(notificationCount, 2, 're-registration sends one fresh Telegram notification');

  const noConsentInvitee = { ...invitee, _id: 'invitee-no-consent', telegramId: '101', referredBy: null, referralInitialRewardEligible: false };
  users.set(noConsentInvitee._id, noConsentInvitee);
  referrer.referralMessageConsent = 'unset';
  const unsetConsentResult = await linkReferral({ referredUserId: noConsentInvitee._id, referrerId: referrer._id, source: 'signup' });
  assert.strictEqual(unsetConsentResult.initialPaid, true, 'the reward remains payable while consent is unset');
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(notificationCount, 2, 'unset consent sends no Telegram message');

  const deniedInvitee = { ...invitee, _id: 'invitee-denied', telegramId: '102', referredBy: null, referralInitialRewardEligible: false };
  users.set(deniedInvitee._id, deniedInvitee);
  referrer.referralMessageConsent = 'denied';
  const deniedConsentResult = await linkReferral({ referredUserId: deniedInvitee._id, referrerId: referrer._id, source: 'signup' });
  assert.strictEqual(deniedConsentResult.initialPaid, true, 'consent affects messaging only, not the existing reward calculation');
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(notificationCount, 2, 'no referral Telegram message is sent after the user denies consent');
  console.log('ALL PASS — initial referral +10 reward, consent-gated new-invite message, and no repeat notification');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
