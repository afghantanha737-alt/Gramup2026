'use strict';

const assert = require('assert');
const {
  enqueuePendingNotification,
  sendNotificationOnce
} = require('../utils/notificationDelivery');
const {
  REFERRAL_NOTIFICATION_MAX_ATTEMPTS,
  runReferralNotificationRetrySweep
} = require('../utils/referralNotificationRetry');

const now = new Date('2026-10-30T10:00:00.000Z');
const rows = new Map();
let nextId = 1;

function clone(value) {
  return value == null ? value : { ...value };
}

function matchesCondition(value, condition) {
  if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
    if ('$lt' in condition) return value != null && value < condition.$lt;
    if ('$lte' in condition) return value == null || value <= condition.$lte;
    if ('$exists' in condition) return condition.$exists ? value !== undefined : value === undefined;
    if ('$nin' in condition) return !condition.$nin.some(item => value === item);
  }
  return value === condition;
}

function matches(row, filter) {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === '$or') return condition.some(branch => matches(row, branch));
    if (key === '$and') return condition.every(branch => matches(row, branch));
    return matchesCondition(row[key], condition);
  });
}

const NotificationDelivery = {
  async findOneAndUpdate(filter, update) {
    let row = [...rows.values()].find(candidate => matches(candidate, filter));
    if (!row && update.$setOnInsert) {
      row = { _id: `delivery-${nextId++}`, ...update.$setOnInsert };
      rows.set(row._id, row);
    }
    if (!row) return null;
    Object.assign(row, update.$set || {});
    for (const [key, value] of Object.entries(update.$inc || {})) row[key] = (row[key] || 0) + value;
    return row;
  },
  async create(payload) {
    if ([...rows.values()].some(row => row.eventKey === payload.eventKey)) {
      const error = new Error('duplicate');
      error.code = 11000;
      throw error;
    }
    const row = { _id: `delivery-${nextId++}`, ...payload };
    rows.set(row._id, row);
    return row;
  },
  async updateOne(filter, update) {
    const row = [...rows.values()].find(candidate => matches(candidate, filter));
    if (row) {
      Object.assign(row, update.$set || {});
      for (const [key, value] of Object.entries(update.$inc || {})) row[key] = (row[key] || 0) + value;
    }
    return { matchedCount: row ? 1 : 0 };
  },
  find(filter) {
    let selected = [...rows.values()].filter(row => matches(row, filter));
    return {
      sort() { selected = selected.sort((a, b) => String(a._id).localeCompare(String(b._id))); return this; },
      limit(value) { selected = selected.slice(0, value); return this; },
      async lean() { return selected.map(clone); }
    };
  }
};

const eligibleUser = {
  _id: 'referrer-1',
  telegramId: '200',
  isBanned: false,
  phoneCountryCode: '+93',
  phoneVerifiedAt: new Date('2026-10-01T00:00:00.000Z'),
  referralMessageConsent: 'granted'
};
const users = new Map([[eligibleUser._id, eligibleUser]]);
const User = {
  findById(id) {
    return {
      select() { return this; },
      then(resolve, reject) { return Promise.resolve(users.get(String(id)) || null).then(resolve, reject); }
    };
  }
};

(async () => {
  const notification = {
    eventKey: 'referral-initial:invitee-1',
    type: 'referral_initial',
    user: eligibleUser._id,
    telegramId: eligibleUser.telegramId,
    text: 'Reward +10 Points; L1 rate 10%.'
  };
  await enqueuePendingNotification({ ...notification, session: { id: 'tx-1' } }, { NotificationDelivery });
  const pending = [...rows.values()][0];
  assert.strictEqual(pending.status, 'pending');
  assert.strictEqual(pending.text, notification.text, 'the rendered reward/rates text is persisted in the outbox');

  const firstAttempt = await sendNotificationOnce(notification, {
    NotificationDelivery,
    notifyUser: async () => false,
    now
  });
  assert.strictEqual(firstAttempt.status, 'unknown');
  assert.strictEqual(pending.attempts, 1);
  assert.ok(pending.nextAttemptAt > now, 'failed delivery receives a backoff deadline');

  // A normal weekly-style call does not reclaim unknown rows.
  const notReclaimed = await sendNotificationOnce(notification, {
    NotificationDelivery,
    notifyUser: async () => { throw new Error('must not send'); },
    now: new Date(pending.nextAttemptAt.getTime() + 1)
  });
  assert.strictEqual(notReclaimed.status, 'duplicate', 'the weekly-compatible sender still reports an existing non-claimable event as duplicate');

  const retry = await runReferralNotificationRetrySweep({
    NotificationDelivery,
    User,
    now: new Date(pending.nextAttemptAt.getTime() + 1),
    notifyUser: async (telegramId, text) => telegramId === '200' && text === notification.text
  });
  assert.deepStrictEqual(retry, { scanned: 1, attempted: 1, sent: 1, unknown: 0, duplicate: 0, skipped: 0, exhausted: 0 });
  assert.strictEqual(pending.status, 'sent');

  // Gate failures do not call Telegram and are deferred without consuming an attempt.
  const gated = await enqueuePendingNotification({
    ...notification,
    eventKey: 'referral-initial:invitee-2',
    text: 'Reward +10 Points; L1 rate 10%.'
  }, { NotificationDelivery });
  const gatedRow = [...rows.values()].find(row => row.eventKey.endsWith('invitee-2'));
  eligibleUser.referralMessageConsent = 'denied';
  let sendCalls = 0;
  const gatedSweep = await runReferralNotificationRetrySweep({
    NotificationDelivery,
    User,
    now: new Date('2026-10-30T10:05:00.000Z'),
    notifyUser: async () => { sendCalls += 1; return true; }
  });
  assert.strictEqual(gatedSweep.skipped, 1);
  assert.strictEqual(sendCalls, 0);
  assert.strictEqual(gatedRow.attempts, 0);
  assert.strictEqual(gatedRow.status, 'pending');
  eligibleUser.referralMessageConsent = 'granted';

  // Empty/missing payloads, including historic unknown records, are never swept.
  rows.set('historic', { _id: 'historic', eventKey: 'old', type: 'referral_initial', user: eligibleUser._id, telegramId: '200', status: 'unknown', attempts: 1 });
  const historicSweep = await runReferralNotificationRetrySweep({ NotificationDelivery, User, now: new Date('2026-10-30T12:00:00.000Z'), notifyUser: async () => true });
  assert.strictEqual(historicSweep.scanned, 1, 'only the newly-created gated row is due; the sent and historic rows are excluded');
  assert.strictEqual(rows.get('historic').status, 'unknown');

  assert.strictEqual(REFERRAL_NOTIFICATION_MAX_ATTEMPTS, 5);
  console.log('PASS — referral notification outbox persists payloads, retries unknown/stale rows with gate checks, and excludes historic payload-less rows');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
