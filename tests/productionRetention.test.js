'use strict';

const assert = require('assert');
const { sendNotificationOnce: realSendNotificationOnce } = require('../utils/notificationDelivery');
const retentionNotifications = require('../utils/retentionNotifications');

function query(value) {
  return {
    select() { return this; },
    session() { return this; },
    lean: async () => (typeof value === 'function' ? value() : value),
    then(resolve, reject) { return Promise.resolve(typeof value === 'function' ? value() : value).then(resolve, reject); }
  };
}

async function testWelcomeRace() {
  const paths = {
    User: require.resolve('../models/User'),
    Settings: require.resolve('../models/Settings'),
    Relationship: require.resolve('../models/ReferralRelationship'),
    PointsLedger: require.resolve('../models/PointsLedger'),
    Notification: require.resolve('../utils/notificationDelivery'),
    Mongo: require.resolve('../utils/mongoTransaction'),
    Ledger: require.resolve('../utils/ledger')
  };
  const referrer = {
    _id: 'referrer-welcome', telegramId: '200', referredBy: null, isBanned: false,
    accountReviewStatus: 'normal', referralRiskScore: 0, referralRiskBlocked: false, points: 0,
    language: 'en', phoneCountryCode: '', phoneVerifiedAt: null, referralMessageConsent: 'unset'
  };
  const invitee = {
    _id: 'invitee-welcome', telegramId: '201', referredBy: null, referralInitialRewardEligible: false,
    isBanned: false, accountReviewStatus: 'normal', referralRiskScore: 0, referralRiskBlocked: false,
    points: 0, firstName: 'New User'
  };
  const users = new Map([[referrer._id, referrer], [invitee._id, invitee]]);
  const relations = new Map();
  const ledgerRows = new Map();

  const User = {
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
      if (user) {
        Object.assign(user, update.$set || {});
        user.invitedCount = (user.invitedCount || 0) + Number(update.$inc?.invitedCount || 0);
      }
      return { acknowledged: true };
    }
  };
  const Relationship = {
    findOneAndUpdate(filter, update) {
      const key = `${filter.referrerId}:${filter.referredUserId}`;
      let row = relations.get(key);
      const conditionalClaim = filter.welcomeRewardStatus === 'pending';
      if (conditionalClaim && (!row || row.welcomeRewardStatus !== 'pending')) return query(null);
      if (!row) {
        row = {
          _id: `relationship-${key}`,
          referrerId: filter.referrerId,
          referredUserId: filter.referredUserId,
          ...update.$setOnInsert
        };
        relations.set(key, row);
      }
      Object.assign(row, update.$set || {});
      row.save = async () => row;
      return query({ ...row, save: row.save });
    }
  };
  function PointsLedger(payload) { this.payload = payload; }
  PointsLedger.prototype.save = async function save() {
    const row = { _id: `ledger-${ledgerRows.size + 1}`, ...this.payload };
    ledgerRows.set(row.sourceId, row);
    return row;
  };
  PointsLedger.findOne = filter => query(ledgerRows.get(filter.sourceId) || null);

  require.cache[paths.User] = { id: paths.User, filename: paths.User, loaded: true, exports: User };
  require.cache[paths.Settings] = { id: paths.Settings, filename: paths.Settings, loaded: true, exports: { findOne: () => query({ referralLevelRates: [10], referralWelcomeRewardPoints: 5 }) } };
  require.cache[paths.Relationship] = { id: paths.Relationship, filename: paths.Relationship, loaded: true, exports: Relationship };
  require.cache[paths.PointsLedger] = { id: paths.PointsLedger, filename: paths.PointsLedger, loaded: true, exports: PointsLedger };
  require.cache[paths.Notification] = { id: paths.Notification, filename: paths.Notification, loaded: true, exports: { sendNotificationOnce: async () => ({ status: 'sent' }) } };
  require.cache[paths.Mongo] = { id: paths.Mongo, filename: paths.Mongo, loaded: true, exports: { withMongoTransaction: async work => work({ id: 'welcome-test' }) } };
  require.cache[paths.Ledger] = { id: paths.Ledger, filename: paths.Ledger, loaded: true, exports: {
    async recordLedgerRequired(payload) {
      const row = { _id: `ledger-${ledgerRows.size + 1}`, ...payload };
      ledgerRows.set(row.sourceId, row);
      return { created: true, entry: row };
    }
  } };

  const { linkReferral, DEFAULT_REFERRAL_WELCOME_REWARD_POINTS } = require('../utils/referralSystem');
  assert.strictEqual(DEFAULT_REFERRAL_WELCOME_REWARD_POINTS, 5);
  const results = await Promise.all([
    linkReferral({ referredUserId: invitee._id, referrerId: referrer._id }),
    linkReferral({ referredUserId: invitee._id, referrerId: referrer._id })
  ]);
  assert.strictEqual(results.filter(result => result.welcomePaid).length, 1, 'concurrent accepted links credit welcome once');
  assert.strictEqual(referrer.points, 10, 'existing inviter reward remains exactly ten');
  assert.strictEqual(invitee.points, 5, 'invitee receives the conservative default welcome credit');
  assert.strictEqual([...ledgerRows.values()].filter(row => row.type === 'referral_initial').length, 1);
  assert.strictEqual([...ledgerRows.values()].filter(row => row.type === 'referral_welcome').length, 1);
  assert.strictEqual(ledgerRows.get(`referral-welcome:${invitee._id}`).amount, 5);
  assert.ok([...ledgerRows.values()].every(row => row.type !== 'referral_welcome' || !['task', 'checkin', 'leaderboard_reward'].includes(row.type)));
}

async function testWarningTiming() {
  const {
    enqueueDailyStreakExpiryWarnings,
    nextCheckinDetails,
    DAILY_STREAK_WARNING_NOTIFICATION_TYPE
  } = retentionNotifications;
  const user = {
    _id: 'warning-user', telegramId: '300', language: 'en', streak: 6,
    lastCheckIn: new Date('2026-10-29T23:00:00.000Z'), isBanned: false,
    telegramBlockedAt: null, phoneCountryCode: '+93', phoneVerifiedAt: new Date('2026-10-01T00:00:00Z'),
    referralMessageConsent: 'granted'
  };
  let warningFilter;
  const users = {
    find(filter) {
      warningFilter = filter;
      return { select() { return this; }, lean: async () => [user] };
    }
  };
  const rows = new Map();
  const NotificationDelivery = {};
  const enqueue = async payload => {
    if (!rows.has(payload.eventKey)) rows.set(payload.eventKey, { ...payload, type: payload.type });
    return rows.get(payload.eventKey);
  };
  assert.strictEqual(nextCheckinDetails(user, new Date('2026-10-30T22:59:00Z')).rewardPoints, 15);
  const before = await enqueueDailyStreakExpiryWarnings(new Date('2026-10-30T22:59:00Z'), { User: users, NotificationDelivery, settings: { dailyReminderEnabled: true }, enqueuePendingNotification: enqueue });
  assert.strictEqual(before.skipped, 'outside_final_hour');
  const pointsBefore = user.points;
  const queued = await enqueueDailyStreakExpiryWarnings(new Date('2026-10-30T23:30:00Z'), { User: users, NotificationDelivery, settings: { dailyReminderEnabled: true }, enqueuePendingNotification: enqueue });
  assert.strictEqual(queued.queued, 1);
  assert.deepStrictEqual(warningFilter.streak, { $gt: 0 });
  assert.strictEqual(warningFilter.lastCheckIn.$gte.toISOString(), '2026-10-29T00:00:00.000Z');
  assert.strictEqual(warningFilter.lastCheckIn.$lt.toISOString(), '2026-10-30T00:00:00.000Z');
  const repeated = await enqueueDailyStreakExpiryWarnings(new Date('2026-10-30T23:45:00Z'), { User: users, NotificationDelivery, settings: { dailyReminderEnabled: true }, enqueuePendingNotification: enqueue });
  assert.strictEqual(rows.size, 1, 'same user/day warning has one immutable event key');
  assert.strictEqual([...rows.values()][0].type, DAILY_STREAK_WARNING_NOTIFICATION_TYPE);
  assert.match([...rows.values()][0].text, /15/);
  assert.strictEqual(user.points, pointsBefore, 'warning never credits points');
  assert.strictEqual(user.lastCheckIn.toISOString(), '2026-10-29T23:00:00.000Z', 'warning never changes the check-in marker');
  assert.strictEqual(repeated.queued, 1, 'enqueue remains idempotent on repeated scheduler calls');

  let queriedWhileDisabled = false;
  const disabled = await enqueueDailyStreakExpiryWarnings(new Date('2026-10-30T23:50:00Z'), {
    User: { find() { queriedWhileDisabled = true; throw new Error('disabled warning enqueue must not query users'); } },
    settings: { dailyReminderEnabled: false },
    enqueuePendingNotification: enqueue
  });
  assert.strictEqual(disabled.skipped, 'notifications_disabled');
  assert.strictEqual(queriedWhileDisabled, false);
}

async function testCommissionDedupAndFailure() {
  const {
    enqueueReferralCommissionNotification,
    sweepNotificationType,
    REFERRAL_COMMISSION_NOTIFICATION_TYPE
  } = require('../utils/retentionNotifications');
  const recipient = {
    _id: 'commission-user', telegramId: '400', language: 'en', isBanned: false,
    telegramBlockedAt: null, phoneCountryCode: '+98', phoneVerifiedAt: new Date('2026-10-01T00:00:00Z'),
    referralMessageConsent: 'granted'
  };
  const rows = new Map();
  const enqueue = async payload => {
    const existing = rows.get(payload.eventKey);
    if (existing) return existing;
    const row = { _id: 'delivery-1', status: 'pending', attempts: 0, nextAttemptAt: null, sendingAt: null, ...payload };
    rows.set(payload.eventKey, row);
    return row;
  };
  const entry = { user: recipient._id, amount: 10, currency: 'points', sourceId: 'referral-commission:earn-1:recipient:commission-user:level:1', referralLevel: 1, commissionRatePercent: 10 };
  await enqueueReferralCommissionNotification({ entry, user: recipient }, { enqueuePendingNotification: enqueue });
  await enqueueReferralCommissionNotification({ entry, user: recipient }, { enqueuePendingNotification: enqueue });
  assert.strictEqual(rows.size, 1, 'same positive commission source queues once');
  assert.strictEqual([...rows.values()][0].type, REFERRAL_COMMISSION_NOTIFICATION_TYPE);
  const consentDenied = await enqueueReferralCommissionNotification({
    entry: { ...entry, sourceId: 'referral-commission:denied' },
    user: { ...recipient, referralMessageConsent: 'denied' }
  }, { enqueuePendingNotification: enqueue });
  assert.deepStrictEqual(consentDenied, { status: 'skipped', reason: 'notification_gate' });
  assert.strictEqual(rows.size, 1, 'consent denial does not create an outbox row');

  const Model = {
    find(query) {
      const selected = [...rows.values()].filter(row => row.status === 'pending' || row.status === 'unknown');
      return { sort() { return this; }, limit() { return this; }, lean: async () => selected };
    },
    async findOneAndUpdate(filter, update) {
      const row = [...rows.values()].find(candidate => candidate.eventKey === filter.eventKey && (candidate.status === 'pending' || candidate.status === 'unknown'));
      if (!row) return null;
      Object.assign(row, update.$set || {});
      row.attempts += Number(update.$inc?.attempts || 0);
      return row;
    },
    async updateOne(filter, update) {
      const row = [...rows.values()].find(candidate => candidate._id === filter._id);
      if (row) Object.assign(row, update.$set || {});
      return { matchedCount: row ? 1 : 0 };
    },
    async updateMany() { return { modifiedCount: 0 }; }
  };
  const User = { findById() { return query(recipient); } };
  const first = await sweepNotificationType(REFERRAL_COMMISSION_NOTIFICATION_TYPE, {
    NotificationDelivery: Model, User, now: new Date('2026-10-30T10:00:00Z'), maxAttempts: 2,
    notifyUser: async () => false, sendNotificationOnce: realSendNotificationOnce
  });
  assert.strictEqual(first.unknown, 1);
  assert.strictEqual([...rows.values()][0].attempts, 1);
  const retryAt = new Date([...rows.values()][0].nextAttemptAt);
  const second = await sweepNotificationType(REFERRAL_COMMISSION_NOTIFICATION_TYPE, {
    NotificationDelivery: Model, User, now: new Date(retryAt.getTime() + 1), maxAttempts: 2,
    notifyUser: async () => false, sendNotificationOnce: realSendNotificationOnce
  });
  assert.strictEqual(second.exhausted, 1);
  assert.strictEqual([...rows.values()][0].status, 'exhausted');
}

async function testWarningDeliveryClearsStaleAndClaimed() {
  const {
    sweepNotificationType,
    DAILY_STREAK_WARNING_NOTIFICATION_TYPE,
    dailyStreakWarningEventKey
  } = retentionNotifications;
  const now = new Date('2026-10-30T23:30:00Z');
  const currentDay = Math.floor(now.getTime() / 86400000);
  const rows = new Map([
    ['stale', {
      _id: 'stale', eventKey: dailyStreakWarningEventKey('stale-user', currentDay - 1),
      type: DAILY_STREAK_WARNING_NOTIFICATION_TYPE, user: 'stale-user', telegramId: '500',
      text: 'stale', status: 'pending', attempts: 0, nextAttemptAt: null, sendingAt: null
    }],
    ['claimed', {
      _id: 'claimed', eventKey: dailyStreakWarningEventKey('claimed-user', currentDay),
      type: DAILY_STREAK_WARNING_NOTIFICATION_TYPE, user: 'claimed-user', telegramId: '501',
      text: 'claimed', status: 'pending', attempts: 0, nextAttemptAt: null, sendingAt: null
    }]
  ]);
  const Model = {
    find() {
      return { sort() { return this; }, limit() { return this; }, lean: async () => [...rows.values()] };
    },
    async updateMany() { return { modifiedCount: 0 }; },
    async updateOne(filter, update) {
      const row = rows.get(String(filter._id));
      if (!row || !['pending', 'unknown'].includes(row.status)) return { matchedCount: 0, modifiedCount: 0 };
      Object.assign(row, update.$set || {});
      return { matchedCount: 1, modifiedCount: 1 };
    }
  };
  const users = new Map([
    ['stale-user', { _id: 'stale-user', telegramId: '500', isBanned: false, telegramBlockedAt: null, phoneCountryCode: '+93', phoneVerifiedAt: now, referralMessageConsent: 'granted', lastCheckIn: new Date('2026-10-29T12:00:00Z'), streak: 2 }],
    ['claimed-user', { _id: 'claimed-user', telegramId: '501', isBanned: false, telegramBlockedAt: null, phoneCountryCode: '+93', phoneVerifiedAt: now, referralMessageConsent: 'granted', lastCheckIn: new Date('2026-10-30T12:00:00Z'), streak: 3 }]
  ]);
  let sends = 0;
  const result = await sweepNotificationType(DAILY_STREAK_WARNING_NOTIFICATION_TYPE, {
    NotificationDelivery: Model,
    User: { findById(id) { return query(users.get(String(id))); } },
    now,
    sendNotificationOnce: async () => { sends += 1; return { status: 'sent' }; },
    sleep: async () => {}
  });
  assert.strictEqual(result.attempted, 0);
  assert.strictEqual(result.exhausted, 2);
  assert.strictEqual(sends, 0, 'stale and already-claimed warnings are never delivered');
  assert.strictEqual(rows.get('stale').status, 'exhausted');
  assert.strictEqual(rows.get('stale').error, 'retention_warning_cleared_stale_previous_day');
  assert.strictEqual(rows.get('claimed').status, 'exhausted');
  assert.strictEqual(rows.get('claimed').error, 'retention_warning_cleared_already_claimed_today');
}

(async () => {
  await testWelcomeRace();
  await testWarningTiming();
  await testCommissionDedupAndFailure();
  await testWarningDeliveryClearsStaleAndClaimed();
  console.log('PASS — welcome race idempotency, filtered final-hour warning, consent/dedup, stale-warning clearing, and bounded failure retry');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
