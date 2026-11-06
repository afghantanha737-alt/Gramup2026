'use strict';

const { cycleDayForStreak, dailyCheckinReward } = require('./dailyCheckin');
const { utcDayKey } = require('./utcDay');
const { isVerifiedAllowedPhone: defaultIsVerifiedAllowedPhone } = require('./telegramPhoneContact');
const {
  SENDING_LEASE_MS,
  retryDelayMs,
  enqueuePendingNotification: defaultEnqueuePendingNotification,
  sendNotificationOnce: defaultSendNotificationOnce
} = require('./notificationDelivery');
const { botText } = require('./botMessages');

const REFERRAL_COMMISSION_NOTIFICATION_TYPE = 'referral_commission';
const DAILY_STREAK_WARNING_NOTIFICATION_TYPE = 'daily_streak_warning';
const RETENTION_NOTIFICATION_TYPES = Object.freeze([
  DAILY_STREAK_WARNING_NOTIFICATION_TYPE,
  REFERRAL_COMMISSION_NOTIFICATION_TYPE
]);
const RETENTION_NOTIFICATION_MAX_ATTEMPTS = 5;
const RETENTION_NOTIFICATION_RETRY_INTERVAL_MS = 60 * 1000;
const RETENTION_NOTIFICATION_GATE_RECHECK_MS = 60 * 60 * 1000;
const RETENTION_NOTIFICATION_LIMIT = 100;
const FINAL_WARNING_HOUR_UTC = 23;
const RETENTION_NOTIFICATION_SEND_DELAY_MS = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

function asDate(value) {
  const resolved = typeof value === 'function' ? value() : value;
  const date = resolved instanceof Date ? new Date(resolved.getTime()) : new Date(resolved || Date.now());
  if (Number.isNaN(date.getTime())) throw new TypeError('Invalid notification date.');
  return date;
}

function isFinalUtcHour(now = new Date()) {
  const date = asDate(now);
  return date.getUTCHours() === FINAL_WARNING_HOUR_UTC;
}

function safeLanguage(user) {
  const language = String(user?.language || 'en').toLowerCase();
  return ['fa', 'ps', 'en'].includes(language) ? language : 'en';
}

function notificationGate(user, isVerifiedAllowedPhone = defaultIsVerifiedAllowedPhone) {
  return Boolean(
    user
      && !user.isBanned
      && !user.telegramBlockedAt
      && /^\d+$/.test(String(user.telegramId || ''))
      && isVerifiedAllowedPhone(user)
      && user.referralMessageConsent === 'granted'
  );
}

function commissionEventKey(sourceId, transactionId) {
  const stable = String(sourceId || transactionId || '').trim();
  return stable ? `referral-commission-notification:${stable}` : '';
}

function referralCommissionText(user, amount, level, rate) {
  return botText('referralCommissionEarned', safeLanguage(user), amount, level, rate);
}

/**
 * Queue exactly one immutable notification for one positive commission ledger row.
 * The caller supplies the same Mongo session used for the balance and ledger write.
 * Consent, verified phone, ban, Telegram-block and numeric chat-id gates are checked
 * before the outbox write; a gate failure never changes balances or consumes retries.
 */
async function enqueueReferralCommissionNotification(payload = {}, dependencies = {}) {
  const entry = payload.entry || {};
  const recipient = payload.user || payload.recipient || null;
  const amount = Number(payload.amount ?? entry.amount);
  const sourceId = payload.sourceId || entry.sourceId;
  const type = REFERRAL_COMMISSION_NOTIFICATION_TYPE;
  if (!Number.isFinite(amount) || amount <= 0 || entry.currency && entry.currency !== 'points') {
    return { status: 'skipped', reason: 'non_positive_or_non_points' };
  }
  const eventKey = commissionEventKey(sourceId, entry.transactionId || payload.transactionId);
  if (!eventKey || !notificationGate(recipient, dependencies.isVerifiedAllowedPhone || defaultIsVerifiedAllowedPhone)) {
    return { status: 'skipped', reason: eventKey ? 'notification_gate' : 'missing_source_id' };
  }

  const enqueue = dependencies.enqueuePendingNotification || defaultEnqueuePendingNotification;
  const level = Number(payload.referralLevel ?? entry.referralLevel) || 1;
  const rate = Number(payload.commissionRatePercent ?? entry.commissionRatePercent);
  const text = referralCommissionText(recipient, amount, level, Number.isFinite(rate) ? rate : 0);
  return enqueue({
    eventKey,
    type,
    user: recipient._id || entry.user,
    telegramId: String(recipient.telegramId),
    text,
    session: payload.session || dependencies.session || null
  }, { NotificationDelivery: dependencies.NotificationDelivery });
}

function dailyStreakWarningEventKey(userId, dayKey) {
  const id = String(userId || '').trim();
  const key = Number(dayKey);
  return id && Number.isSafeInteger(key) ? `daily-streak-warning:${key}:${id}` : '';
}

function dailyStreakWarningDayKey(eventKey) {
  const match = /^daily-streak-warning:(-?\d+):/.exec(String(eventKey || ''));
  if (!match) return null;
  const dayKey = Number(match[1]);
  return Number.isSafeInteger(dayKey) ? dayKey : null;
}

function nextCheckinDetails(user, now = new Date()) {
  const date = asDate(now);
  const todayKey = utcDayKey(date);
  const last = user?.lastCheckIn ? new Date(user.lastCheckIn) : null;
  const lastKey = last && !Number.isNaN(last.getTime()) ? utcDayKey(last) : null;
  const streak = Math.max(0, Math.floor(Number(user?.streak) || 0));
  if (lastKey !== todayKey - 1 || streak <= 0) return null;
  const nextStreak = streak + 1;
  const cycleDay = cycleDayForStreak(nextStreak) || 1;
  return {
    dayKey: todayKey,
    nextStreak,
    cycleDay,
    rewardPoints: dailyCheckinReward(nextStreak)
  };
}

function streakWarningText(user, details) {
  return botText('dailyStreakExpiryWarning', safeLanguage(user), details.cycleDay, details.rewardPoints, details.nextStreak);
}

/**
 * Enqueues final-hour warnings only. It never calls claimDailyCheckin, changes a
 * User document, or writes a points ledger row. The event key makes repeated
 * minute-level scheduler calls converge to one row for one user and UTC day.
 */
async function enqueueDailyStreakExpiryWarnings(now = new Date(), options = {}) {
  const date = asDate(now);
  if (!isFinalUtcHour(date)) return { status: 'skipped', skipped: 'outside_final_hour', queued: 0, candidates: 0 };

  let settings = options.settings;
  if (!Object.prototype.hasOwnProperty.call(options, 'settings')) {
    const Settings = options.Settings || require('../models/Settings');
    settings = typeof Settings?.getGlobal === 'function' ? await Settings.getGlobal() : null;
  }
  if (settings?.dailyReminderEnabled === false) {
    return { status: 'skipped', skipped: 'notifications_disabled', queued: 0, candidates: 0 };
  }

  const User = options.User || require('../models/User');
  const NotificationDelivery = options.NotificationDelivery || require('../models/NotificationDelivery');
  const enqueue = options.enqueuePendingNotification || defaultEnqueuePendingNotification;
  const isVerifiedAllowedPhone = options.isVerifiedAllowedPhone || defaultIsVerifiedAllowedPhone;
  const todayKey = utcDayKey(date);
  const startOfToday = new Date(todayKey * DAY_MS);
  const startOfYesterday = new Date(startOfToday.getTime() - DAY_MS);
  const query = {
    isBanned: false,
    telegramBlockedAt: null,
    referralMessageConsent: 'granted',
    telegramId: { $exists: true, $nin: ['', null] },
    phoneVerifiedAt: { $ne: null },
    phoneCountryCode: { $in: ['+93', '+98'] },
    streak: { $gt: 0 },
    lastCheckIn: { $gte: startOfYesterday, $lt: startOfToday }
  };
  const projection = '_id telegramId language streak lastCheckIn isBanned telegramBlockedAt phoneCountryCode phoneVerifiedAt referralMessageConsent';

  let queued = 0;
  let skipped = 0;
  let candidates = 0;
  let found = User.find(query, projection);
  let cursor = null;
  if (found && typeof found.lean === 'function') found = found.lean();
  if (found && typeof found.cursor === 'function') cursor = found.cursor();

  const enqueueForUser = async user => {
    candidates += 1;
    const details = nextCheckinDetails(user, date);
    if (!details || !notificationGate(user, isVerifiedAllowedPhone)) {
      skipped += 1;
      return;
    }
    const result = await enqueue({
      eventKey: dailyStreakWarningEventKey(user._id, details.dayKey),
      type: DAILY_STREAK_WARNING_NOTIFICATION_TYPE,
      user: user._id,
      telegramId: String(user.telegramId),
      text: streakWarningText(user, details)
    }, { NotificationDelivery });
    if (result?.status !== 'skipped') queued += 1;
  };

  if (cursor && typeof cursor[Symbol.asyncIterator] === 'function') {
    try {
      for await (const user of cursor) await enqueueForUser(user);
    } finally {
      if (typeof cursor.close === 'function') await cursor.close();
    }
  } else {
    const users = await (cursor || found);
    for (const user of Array.isArray(users) ? users : []) await enqueueForUser(user);
  }
  return { status: 'ok', queued, skipped, candidates, dayKey: todayKey };
}

function dueQuery(type, now, maxAttempts) {
  const due = {
    $or: [
      { nextAttemptAt: null },
      { nextAttemptAt: { $exists: false } },
      { nextAttemptAt: { $lte: now } }
    ]
  };
  return {
    type,
    text: { $exists: true, $nin: ['', null] },
    attempts: { $lt: maxAttempts },
    $or: [
      { status: 'pending', ...due },
      { status: 'unknown', ...due },
      { status: 'sending', sendingAt: { $lt: new Date(now.getTime() - SENDING_LEASE_MS) } }
    ]
  };
}

async function resolveRows(Model, query, limit) {
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
  if (query && typeof query.select === 'function') query = query.select('_id telegramId isBanned telegramBlockedAt phoneCountryCode phoneVerifiedAt referralMessageConsent lastCheckIn streak');
  return query;
}

async function deferGateBlocked(Model, row, now, reason) {
  if (!row?._id || typeof Model.updateOne !== 'function') return;
  await Model.updateOne(
    { _id: row._id, $or: [
      { status: 'pending' }, { status: 'unknown' },
      { status: 'sending', sendingAt: { $lt: new Date(now.getTime() - SENDING_LEASE_MS) } }
    ] },
    { $set: {
      status: 'pending', sendingAt: null,
      nextAttemptAt: new Date(now.getTime() + RETENTION_NOTIFICATION_GATE_RECHECK_MS),
      error: `retention_notification_gate_${reason}`
    } }
  );
}

async function clearStaleWarning(Model, row, now, reason) {
  if (!row?._id || typeof Model.updateOne !== 'function') return false;
  const result = await Model.updateOne(
    { _id: row._id, $or: [
      { status: 'pending' }, { status: 'unknown' },
      { status: 'sending', sendingAt: { $lt: new Date(now.getTime() - SENDING_LEASE_MS) } }
    ] },
    { $set: {
      status: 'exhausted', exhaustedAt: now, sendingAt: null,
      nextAttemptAt: null, error: `retention_warning_cleared_${reason}`
    } }
  );
  return Number(result?.modifiedCount ?? result?.nModified ?? result?.matchedCount ?? 0) > 0;
}

async function sweepNotificationType(type, options = {}) {
  const Model = options.NotificationDelivery || options.notificationDeliveryModel || require('../models/NotificationDelivery');
  const User = options.User || require('../models/User');
  const sendNotificationOnce = options.sendNotificationOnce || defaultSendNotificationOnce;
  const isVerifiedAllowedPhone = options.isVerifiedAllowedPhone || defaultIsVerifiedAllowedPhone;
  const now = asDate(options.now || new Date());
  const maxAttempts = Math.max(1, Number(options.maxAttempts || RETENTION_NOTIFICATION_MAX_ATTEMPTS));
  const limit = Math.max(1, Math.min(1000, Number(options.limit || RETENTION_NOTIFICATION_LIMIT)));
  const finalized = typeof Model.updateMany === 'function'
    ? await require('./notificationExhaustion').finalizeExhaustedNotifications(type, Model, now, maxAttempts)
    : { modifiedCount: 0 };
  const rows = await resolveRows(Model, dueQuery(type, now, maxAttempts), limit);
  const summary = { scanned: rows.length, attempted: 0, sent: 0, unknown: 0, duplicate: 0, skipped: 0, exhausted: Number(finalized.modifiedCount) || 0 };
  const usersAttempted = options.usersAttempted || new Set();
  const sendState = options.sendState || { count: 0 };
  const currentDayKey = utcDayKey(now);

  for (const row of rows) {
    const user = await resolveUser(User, row.user);
    if (type === DAILY_STREAK_WARNING_NOTIFICATION_TYPE) {
      const warningDayKey = dailyStreakWarningDayKey(row.eventKey);
      if (warningDayKey !== currentDayKey) {
        if (await clearStaleWarning(Model, row, now, warningDayKey == null ? 'invalid_event' : 'stale_previous_day')) summary.exhausted += 1;
        else summary.skipped += 1;
        continue;
      }
      const claimedToday = user?.lastCheckIn && utcDayKey(new Date(user.lastCheckIn)) === currentDayKey;
      if (claimedToday) {
        if (await clearStaleWarning(Model, row, now, 'already_claimed_today')) summary.exhausted += 1;
        else summary.skipped += 1;
        continue;
      }
    }
    if (!notificationGate(user, isVerifiedAllowedPhone)) {
      summary.skipped += 1;
      const reason = !user ? 'user_missing' : user.isBanned ? 'banned' : user.telegramBlockedAt ? 'telegram_blocked' : user.referralMessageConsent !== 'granted' ? 'consent' : 'phone';
      await deferGateBlocked(Model, row, now, reason);
      continue;
    }
    const userKey = String(row.user);
    if (usersAttempted.has(userKey)) {
      summary.skipped += 1;
      continue;
    }
    usersAttempted.add(userKey);
    summary.attempted += 1;
    let result;
    try {
      if (sendState.count > 0) {
        const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
        await sleep(RETENTION_NOTIFICATION_SEND_DELAY_MS);
      }
      sendState.count += 1;
      result = await sendNotificationOnce({
        eventKey: row.eventKey, type: row.type, user: row.user,
        telegramId: row.telegramId, text: row.text
      }, {
        NotificationDelivery: Model,
        retryUnknown: true,
        maxAttempts,
        now,
        retryBaseMs: options.retryBaseMs || RETENTION_NOTIFICATION_RETRY_INTERVAL_MS,
        retryMaxMs: options.retryMaxMs,
        notifyUser: options.notifyUser
      });
    } catch (error) {
      result = { status: 'unknown', error: String(error?.message || error) };
    }
    if (result?.status === 'sent') summary.sent += 1;
    else if (result?.status === 'duplicate') summary.duplicate += 1;
    else if (result?.status === 'unknown') summary.unknown += 1;
    else if (result?.status === 'exhausted') summary.exhausted += 1;
    else summary.skipped += 1;
  }
  return summary;
}

/** Queue final-hour warnings, then deliver both retention notification types. */
async function runRetentionNotificationSweep(options = {}) {
  const now = asDate(options.now || new Date());
  const warning = options.enqueueWarnings === false
    ? { status: 'skipped', skipped: 'disabled' }
    : await enqueueDailyStreakExpiryWarnings(now, options);
  const types = options.types || RETENTION_NOTIFICATION_TYPES;
  const byType = {};
  const usersAttempted = new Set();
  const sendState = { count: 0 };
  for (const type of types) {
    byType[type] = await sweepNotificationType(type, { ...options, usersAttempted, sendState });
  }
  return { warning, byType };
}

module.exports = {
  REFERRAL_COMMISSION_NOTIFICATION_TYPE,
  DAILY_STREAK_WARNING_NOTIFICATION_TYPE,
  RETENTION_NOTIFICATION_TYPES,
  RETENTION_NOTIFICATION_MAX_ATTEMPTS,
  RETENTION_NOTIFICATION_RETRY_INTERVAL_MS,
  RETENTION_NOTIFICATION_GATE_RECHECK_MS,
  RETENTION_NOTIFICATION_LIMIT,
  FINAL_WARNING_HOUR_UTC,
  isFinalUtcHour,
  notificationGate,
  commissionEventKey,
  referralCommissionText,
  enqueueReferralCommissionNotification,
  dailyStreakWarningEventKey,
  dailyStreakWarningDayKey,
  nextCheckinDetails,
  streakWarningText,
  enqueueDailyStreakExpiryWarnings,
  dueQuery,
  sweepNotificationType,
  runRetentionNotificationSweep
};
