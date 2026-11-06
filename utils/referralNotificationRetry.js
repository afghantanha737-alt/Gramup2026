'use strict';

const DefaultUser = require('../models/User');
const {
  SENDING_LEASE_MS,
  retryDelayMs: defaultRetryDelayMs,
  sendNotificationOnce: defaultSendNotificationOnce
} = require('./notificationDelivery');
const { isVerifiedAllowedPhone: defaultIsVerifiedAllowedPhone } = require('./telegramPhoneContact');

const REFERRAL_NOTIFICATION_MAX_ATTEMPTS = 5;
const REFERRAL_NOTIFICATION_RETRY_INTERVAL_MS = 60 * 1000;
const REFERRAL_NOTIFICATION_GATE_RECHECK_MS = 60 * 60 * 1000;
const REFERRAL_NOTIFICATION_RETRY_LOCK_KEY = 'referral-notification-retry';

function asDate(value) {
  const resolved = typeof value === 'function' ? value() : value;
  const date = resolved instanceof Date ? resolved : new Date(resolved || Date.now());
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function retryQuery(now, maxAttempts) {
  const due = {
    $or: [
      { nextAttemptAt: null },
      { nextAttemptAt: { $exists: false } },
      { nextAttemptAt: { $lte: now } }
    ]
  };
  return {
    type: 'referral_initial',
    // Historical rows have no durable message payload. Never claim them.
    text: { $exists: true, $nin: ['', null] },
    attempts: { $lt: maxAttempts },
    $or: [
      { status: 'pending', ...due },
      { status: 'unknown', ...due },
      { status: 'sending', sendingAt: { $lt: new Date(now.getTime() - SENDING_LEASE_MS) } }
    ]
  };
}

async function resolveCandidates(Model, query, limit) {
  let cursor = Model.find(query);
  if (cursor && typeof cursor.sort === 'function') cursor = cursor.sort({ nextAttemptAt: 1, createdAt: 1 });
  if (cursor && typeof cursor.limit === 'function') cursor = cursor.limit(limit);
  if (cursor && typeof cursor.lean === 'function') cursor = cursor.lean();
  const rows = await cursor;
  return Array.isArray(rows) ? rows : [];
}

async function resolveUser(User, id) {
  if (!User || typeof User.findById !== 'function') return null;
  let query = User.findById(id);
  if (query && typeof query.select === 'function') {
    query = query.select('_id telegramId isBanned telegramBlockedAt phoneCountryCode phoneVerifiedAt referralMessageConsent');
  }
  return query;
}

function gatePassed(user, isVerifiedAllowedPhone) {
  return Boolean(
    user
      && !user.isBanned
      && !user.telegramBlockedAt
      && isVerifiedAllowedPhone(user)
      && user.referralMessageConsent === 'granted'
  );
}

async function deferGateBlocked(Model, row, now, reason) {
  if (!row?._id || typeof Model.updateOne !== 'function') return;
  const nextAttemptAt = new Date(now.getTime() + REFERRAL_NOTIFICATION_GATE_RECHECK_MS);
  await Model.updateOne(
    {
      _id: row._id,
      $or: [
        { status: 'pending' },
        { status: 'unknown' },
        { status: 'sending', sendingAt: { $lt: new Date(now.getTime() - SENDING_LEASE_MS) } }
      ]
    },
    { $set: { status: 'pending', sendingAt: null, nextAttemptAt, error: `referral_notification_gate_${reason}` } }
  );
}

/**
 * Retries only newly-created referral outbox rows with a non-empty persisted
 * text payload. Call this from a server-owned interval under the distributed
 * lock identified by REFERRAL_NOTIFICATION_RETRY_LOCK_KEY.
 */
async function runReferralNotificationRetrySweep(options = {}) {
  const Model = options.NotificationDelivery || options.notificationDeliveryModel || require('../models/NotificationDelivery');
  const User = options.User || DefaultUser;
  const sendNotificationOnce = options.sendNotificationOnce || defaultSendNotificationOnce;
  const isVerifiedAllowedPhone = options.isVerifiedAllowedPhone || defaultIsVerifiedAllowedPhone;
  const now = asDate(options.now || new Date());
  const maxAttempts = Math.max(1, Number(options.maxAttempts || REFERRAL_NOTIFICATION_MAX_ATTEMPTS));
  const limit = Math.max(1, Math.min(1000, Number(options.limit || 100)));
  const finalized = await require('./notificationExhaustion').finalizeExhaustedNotifications('referral_initial', Model, now, maxAttempts);
  const rows = await resolveCandidates(Model, retryQuery(now, maxAttempts), limit);
  const summary = {
    scanned: rows.length,
    attempted: 0,
    sent: 0,
    unknown: 0,
    duplicate: 0,
    skipped: 0,
    exhausted: Number(finalized.modifiedCount) || 0
  };

  for (const row of rows) {
    const user = await resolveUser(User, row.user);
    if (!gatePassed(user, isVerifiedAllowedPhone)) {
      summary.skipped += 1;
      const reason = !user ? 'user_missing'
        : user.isBanned ? 'banned'
          : user.telegramBlockedAt ? 'telegram_blocked'
          : user.referralMessageConsent !== 'granted' ? 'consent'
            : 'phone';
      await deferGateBlocked(Model, row, now, reason);
      continue;
    }

    summary.attempted += 1;
    let result;
    try {
      result = await sendNotificationOnce(
        {
          eventKey: row.eventKey,
          type: row.type,
          user: row.user,
          telegramId: row.telegramId,
          text: row.text
        },
        {
          NotificationDelivery: Model,
          retryUnknown: true,
          maxAttempts,
          now,
          retryBaseMs: options.retryBaseMs || REFERRAL_NOTIFICATION_RETRY_INTERVAL_MS,
          retryMaxMs: options.retryMaxMs,
          notifyUser: options.notifyUser
        }
      );
    } catch (error) {
      result = { status: 'unknown', error: String(error?.message || error) };
    }

    if (result?.status === 'sent') summary.sent += 1;
    else if (result?.status === 'duplicate') summary.duplicate += 1;
    else if (result?.status === 'unknown') summary.unknown += 1;
    else if (result?.status === 'exhausted') summary.exhausted += 1;
    else summary.skipped += 1;
  }

  // Kept as an explicit exported signal for operators/metrics when a caller
  // chooses a smaller query window than the configured maximum.
  if (rows.some(row => Number(row.attempts) >= maxAttempts)) summary.exhausted += 1;
  return summary;
}

module.exports = {
  REFERRAL_NOTIFICATION_MAX_ATTEMPTS,
  REFERRAL_NOTIFICATION_RETRY_INTERVAL_MS,
  REFERRAL_NOTIFICATION_GATE_RECHECK_MS,
  REFERRAL_NOTIFICATION_RETRY_LOCK_KEY,
  RECOMMENDED_INTERVAL_MS: REFERRAL_NOTIFICATION_RETRY_INTERVAL_MS,
  RECOMMENDED_LOCK_KEY: REFERRAL_NOTIFICATION_RETRY_LOCK_KEY,
  retryQuery,
  runReferralNotificationRetrySweep,
  sweepReferralNotificationDeliveries: runReferralNotificationRetrySweep
};
