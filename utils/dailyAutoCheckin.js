'use strict';

const { cycleDayForStreak, dailyCheckinReward } = require('./dailyCheckin');
const { DAY_MS, utcDayKey, wasUtcYesterday } = require('./utcDay');

const AUTO_CHECKIN_HOUR_UTC = 2;
const AUTO_CHECKIN_MINUTE_UTC = 30;
const DEFAULT_BATCH_SIZE = 20;
const NOTIFICATION_LEASE_MS = 10 * 60 * 1000;
const NOTIFICATION_TYPE = 'daily_checkin';

function assertValidDate(value, label = 'date') {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError(`Invalid ${label}.`);
  return date;
}

function utcDayStart(value) {
  const date = assertValidDate(value);
  return new Date(utcDayKey(date) * DAY_MS);
}

function automaticCheckinTarget(value = new Date()) {
  const start = utcDayStart(value);
  return new Date(start.getTime() + AUTO_CHECKIN_HOUR_UTC * 60 * 60 * 1000 + AUTO_CHECKIN_MINUTE_UTC * 60 * 1000);
}

function isAutomaticCheckinDue(value = new Date()) {
  const now = assertValidDate(value);
  return now.getTime() >= automaticCheckinTarget(now).getTime();
}

function nextAutomaticCheckinTarget(value = new Date()) {
  const now = assertValidDate(value);
  const target = automaticCheckinTarget(now);
  return now.getTime() < target.getTime() ? target : new Date(target.getTime() + DAY_MS);
}

function dailyCheckinSourceId(userId, dayKey) {
  const id = String(userId || '').trim();
  const key = Number(dayKey);
  if (!id || !Number.isSafeInteger(key) || key < 0) throw new TypeError('A valid user id and UTC day key are required.');
  return `checkin:${id}:${key}`;
}

function validateRewardAmount(amount) {
  const value = Number(amount);
  if (!Number.isSafeInteger(value) || value <= 0) {
    const error = new Error('Daily check-in reward amount is invalid.');
    error.code = 'INVALID_CHECKIN_REWARD';
    throw error;
  }
  return value;
}

function notificationText(user, { amount, cycleDay, streak }) {
  const lang = String(user?.language || 'en').toLowerCase();
  const safeLanguage = ['fa', 'ps', 'en'].includes(lang) ? lang : 'en';
  const templates = {
    fa: `پاداش ورود روزانه امروز ثبت شد: +${amount} پوینت. استریک شما ${streak} روز است (روز ${cycleDay} از چرخه ۷روزه).`,
    ps: `ستاسو د نن ورځې د ننوتلو انعام ثبت شو: +${amount} پواینټه. ستاسو سټریک ${streak} ورځې دی (د ۷ ورځني پړاو ${cycleDay}مه ورځ).`,
    en: `Today's daily check-in reward is credited: +${amount} points. Your streak is ${streak} days (cycle day ${cycleDay} of 7).`
  };
  return templates[safeLanguage];
}

function queryWithSession(query, session) {
  return session && query && typeof query.session === 'function' ? query.session(session) : query;
}

async function findUserById(User, userId, session) {
  const query = User.findById(userId);
  return queryWithSession(query, session);
}

async function findLedgerBySource(PointsLedger, sourceId, session) {
  if (!PointsLedger || typeof PointsLedger.findOne !== 'function') return null;
  const query = PointsLedger.findOne({ sourceId });
  return queryWithSession(query, session);
}

function updateUser(User, filter, update, session) {
  return User.findOneAndUpdate(filter, update, { new: true, session });
}

function previousLastCheckInFilter(lastCheckIn) {
  if (lastCheckIn == null) {
    return { $or: [{ lastCheckIn: null }, { lastCheckIn: { $exists: false } }] };
  }
  return { lastCheckIn };
}

function normalizeLedgerResult(result) {
  if (result && result.created === true) return result;
  const error = new Error('Daily check-in ledger entry was not created; transaction was aborted.');
  error.code = result?.duplicate ? 'CHECKIN_LEDGER_DUPLICATE' : 'CHECKIN_LEDGER_NOT_CREATED';
  throw error;
}

/**
 * Claim one UTC-day check-in. This function is intentionally usable by both
 * the automatic worker and the authenticated manual route. The User update
 * and unique PointsLedger insert must be performed in the same transaction.
 */
async function claimDailyCheckin(userId, options = {}) {
  const now = assertValidDate(options.now || new Date(), 'now');
  const todayKey = utcDayKey(now);
  const sourceId = dailyCheckinSourceId(userId, todayKey);
  const User = options.User || require('../models/User');
  const PointsLedger = options.PointsLedger || require('../models/PointsLedger');
  const withMongoTransaction = options.withMongoTransaction || require('./mongoTransaction').withMongoTransaction;
  const recordLedger = options.recordLedger || options.recordLedgerRequired || require('./ledger').recordLedgerRequired;

  return withMongoTransaction(async session => {
    const current = await findUserById(User, userId, session);
    if (!current) return { status: 'missing', sourceId, dayKey: todayKey };
    if (current.isBanned) return { status: 'banned', sourceId, dayKey: todayKey, user: current };
    if (utcDayKey(current.lastCheckIn) === todayKey) {
      const streak = Math.max(0, Math.floor(Number(current.streak) || 0));
      return {
        status: 'already_claimed',
        sourceId,
        dayKey: todayKey,
        amount: validateRewardAmount(dailyCheckinReward(streak)),
        cycleDay: cycleDayForStreak(streak) || 1,
        streak,
        user: current
      };
    }

    // A prior committed ledger row is authoritative even if a legacy user row
    // was not updated. It prevents a repair/retry from crediting twice.
    const existingLedger = await findLedgerBySource(PointsLedger, sourceId, session);
    if (existingLedger) {
      const streak = Math.max(0, Math.floor(Number(current.streak) || 0));
      return {
        status: 'already_claimed',
        sourceId,
        dayKey: todayKey,
        amount: validateRewardAmount(dailyCheckinReward(streak)),
        cycleDay: cycleDayForStreak(streak) || 1,
        streak,
        user: current
      };
    }

    const lastCheckIn = current.lastCheckIn || null;
    const wasYesterday = wasUtcYesterday(lastCheckIn, todayKey * DAY_MS);
    const newStreak = wasYesterday ? Math.max(0, Math.floor(Number(current.streak) || 0)) + 1 : 1;
    const reward = validateRewardAmount((options.rewardForStreak || dailyCheckinReward)(newStreak));
    const cycleDay = cycleDayForStreak(newStreak);
    const updateFilter = {
      _id: current._id || userId,
      isBanned: false,
      ...previousLastCheckInFilter(lastCheckIn)
    };
    if (lastCheckIn != null) updateFilter.lastCheckIn = lastCheckIn;
    const updated = await updateUser(
      User,
      updateFilter,
      { $set: { streak: newStreak, lastCheckIn: now }, $inc: { points: reward, totalCheckins: 1 } },
      session
    );

    if (!updated) {
      // The transaction wrapper retries transient write conflicts. A null
      // match on a non-conflicting adapter means another claimant won.
      return { status: 'already_claimed', sourceId, dayKey: todayKey };
    }

    const ledgerResult = await recordLedger({
      user: updated._id || userId,
      type: 'checkin',
      amount: reward,
      currency: 'points',
      description: `ورود روزانه (روز ${cycleDay} از چرخه ۷روزه)`,
      balanceAfter: updated.points,
      sourceId,
      session
    });
    normalizeLedgerResult(ledgerResult);

    if (options.queueNotification === true && options.settings?.dailyReminderEnabled !== false
      && /^\d+$/.test(String(updated.telegramId || '')) && !updated.telegramBlockedAt) {
      const enqueue = options.enqueuePendingNotification || require('./notificationDelivery').enqueuePendingNotification;
      await enqueue({
        eventKey: `daily-checkin:${sourceId}`, type: NOTIFICATION_TYPE,
        user: updated._id, telegramId: updated.telegramId,
        text: notificationText(updated, { amount: reward, cycleDay, streak: newStreak }),
        session
      }, { NotificationDelivery: options.NotificationDelivery });
    }

    return {
      status: 'credited',
      sourceId,
      dayKey: todayKey,
      amount: reward,
      cycleDay,
      streak: newStreak,
      user: updated
    };
  });
}

async function claimNotificationDelivery({ eventKey, user, amount, cycleDay, streak }, options = {}) {
  const telegramId = String(user?.telegramId || '').trim();
  if (!/^\d+$/.test(telegramId)) return { status: 'skipped', reason: 'missing_telegram_id' };
  if (user?.telegramBlockedAt || user?.isBanned) return { status: 'skipped', reason: 'blocked' };
  if (options.settings?.dailyReminderEnabled === false) return { status: 'skipped', reason: 'notifications_disabled' };

  const NotificationDelivery = options.NotificationDelivery || options.notificationDeliveryModel || require('../models/NotificationDelivery');
  const notifyUser = options.notifyUser || require('./bot').notifyUser;
  const type = options.notificationType || NOTIFICATION_TYPE;
  const now = assertValidDate(options.now || new Date(), 'now');
  const staleBefore = new Date(now.getTime() - NOTIFICATION_LEASE_MS);
  const text = notificationText(user, { amount, cycleDay, streak });
  let delivery;

  try {
    delivery = await NotificationDelivery.findOneAndUpdate(
      {
        eventKey,
        attempts: { $lt: 5 },
        $and: [{ $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }] }],
        $or: [
          { status: 'pending' },
          { status: 'unknown' },
          { status: 'sending', sendingAt: { $lt: staleBefore } }
        ]
      },
      {
        $set: { status: 'sending', type, user: user._id, telegramId, text, sendingAt: now, nextAttemptAt: null, error: '' },
        $inc: { attempts: 1 }
      },
      { new: true }
    );
    if (!delivery) {
      delivery = await NotificationDelivery.create({
        eventKey,
        type,
        user: user._id,
        telegramId,
        text,
        status: 'sending',
        attempts: 1,
        sendingAt: now
      });
    }
  } catch (error) {
    if (error?.code === 11000) return { status: 'duplicate' };
    throw error;
  }

  let delivered = false;
  let deliveryError = '';
  try {
    delivered = Boolean(await notifyUser(telegramId, text));
    if (!delivered) deliveryError = 'Telegram delivery did not confirm success.';
  } catch (error) {
    deliveryError = String(error?.message || error).slice(0, 500);
  }

  if (delivered) {
    await NotificationDelivery.updateOne(
      { _id: delivery._id, status: 'sending', attempts: delivery.attempts },
      { $set: { status: 'sent', sentAt: now, sendingAt: null, error: '' } }
    );
    return { status: 'sent', text, attempts: delivery.attempts };
  }

  await NotificationDelivery.updateOne(
    { _id: delivery._id, status: 'sending', attempts: delivery.attempts },
    { $set: { status: delivery.attempts >= 5 ? 'exhausted' : 'unknown', sendingAt: null,
      exhaustedAt: delivery.attempts >= 5 ? now : null,
      nextAttemptAt: delivery.attempts >= 5 ? null : new Date(now.getTime() + Math.min(30, 2 ** Math.max(0, delivery.attempts - 1)) * 60000),
      error: deliveryError || 'Telegram delivery failed.' } }
  );
  return { status: 'failed', error: deliveryError || 'Telegram delivery failed.', text, attempts: delivery.attempts };
}

async function* userBatches(User, batchSize) {
  let query = User.find({});
  if (query && typeof query.select === 'function') query = query.select('_id telegramId language');
  if (query && typeof query.cursor === 'function') {
    const cursor = query.lean().cursor();
    let batch = [];
    try {
      for await (const user of cursor) {
        batch.push(user);
        if (batch.length >= batchSize) { yield batch; batch = []; }
      }
      if (batch.length) yield batch;
    } finally {
      await cursor.close();
    }
    return;
  }
  // Lightweight adapters used by offline tests may not implement cursors.
  if (query && typeof query.lean === 'function') query = query.lean();
  const users = (await query) || [];
  for (let offset = 0; offset < users.length; offset += batchSize) yield users.slice(offset, offset + batchSize);
}

/**
 * Run after the 07:00 Asia/Kabul boundary (02:30 UTC). It is safe to run
 * repeatedly or from several workers: the UTC sourceId plus conditional User
 * update makes each account receive at most one credit for that UTC date.
 * `enabled:false` is the explicit application-setting kill switch.
 */
async function runDailyAutoCheckin(now = new Date(), options = {}) {
  const current = assertValidDate(now, 'now');
  if (options.enabled === false) return { credited: 0, skipped: 'disabled', at: current.toISOString() };
  if (!isAutomaticCheckinDue(current)) {
    return { credited: 0, skipped: 'before_schedule', nextRunAt: automaticCheckinTarget(current).toISOString(), at: current.toISOString() };
  }

  const User = options.User || require('../models/User');
  const NotificationDelivery = options.NotificationDelivery || require('../models/NotificationDelivery');
  await require('./notificationExhaustion').finalizeExhaustedNotifications(NOTIFICATION_TYPE, NotificationDelivery, current);
  const batchSize = Number.isSafeInteger(options.batchSize) && options.batchSize > 0 ? options.batchSize : DEFAULT_BATCH_SIZE;
  const result = {
    credited: 0,
    pointsCredited: 0,
    alreadyClaimed: 0,
    banned: 0,
    missing: 0,
    failed: 0,
    notificationsSent: 0,
    notificationsFailed: 0,
    notificationsSkipped: 0,
    total: 0,
    errors: []
  };

  for await (const batch of userBatches(User, batchSize)) {
    result.total += batch.length;
    const outcomes = await Promise.all(batch.map(async candidate => {
      try {
        const claim = await claimDailyCheckin(candidate._id, { ...options, now, User, queueNotification: true });
        if (claim.status === 'credited' || claim.status === 'already_claimed') {
          if (claim.status === 'credited') { result.credited += 1; result.pointsCredited += claim.amount; }
          // A user may have completed the manual claim earlier in this UTC
          // day. The receipt is still safe to attempt because its durable
          // event key is the same as the credit source and sent deliveries
          // cannot be claimed again.
          if (!claim.amount || !claim.cycleDay || !claim.streak || !claim.user) return { claim };
          const delivery = await claimNotificationDelivery({
            eventKey: `daily-checkin:${claim.sourceId}`,
            user: { ...candidate, ...(typeof claim.user?.toObject === 'function' ? claim.user.toObject() : claim.user || {}) },
            amount: claim.amount,
            cycleDay: claim.cycleDay,
            streak: claim.streak
          }, { ...options, now });
          return { claim, delivery };
        }
        return { claim };
      } catch (error) {
        return { error };
      }
    }));

    for (const outcome of outcomes) {
      if (outcome.error) {
        result.failed += 1;
        result.errors.push(String(outcome.error?.message || outcome.error).slice(0, 300));
        continue;
      }
      const status = outcome.claim.status;
      if (status === 'already_claimed') result.alreadyClaimed += 1;
      else if (status === 'banned') result.banned += 1;
      else if (status === 'missing') result.missing += 1;
      const deliveryStatus = outcome.delivery?.status;
      if (deliveryStatus === 'sent') result.notificationsSent += 1;
      else if (deliveryStatus === 'failed') result.notificationsFailed += 1;
      else if (deliveryStatus) result.notificationsSkipped += 1;
    }
    if (batch.length >= batchSize) {
      const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
      await sleep(1100);
    }
  }

  return { ...result, at: current.toISOString() };
}

/**
 * Application-facing entrypoint. The parent scheduler should call this
 * function under its distributed `daily-reminder-sweep` lock. It deliberately
 * requires the explicit Settings flag; the lower-level runner remains useful
 * for tests and controlled maintenance calls.
 */
async function runDailyAutoCheckinSweep(now = new Date(), options = {}) {
  if (options.settings?.dailyAutoCheckinEnabled !== undefined) {
    if (options.settings.dailyAutoCheckinEnabled !== true) return { credited: 0, skipped: 'disabled', at: assertValidDate(now, 'now').toISOString() };
    return runDailyAutoCheckin(now, { ...options, enabled: true });
  }
  const Settings = options.Settings || require('../models/Settings');
  const settings = await Settings.getGlobal();
  if (settings?.dailyAutoCheckinEnabled !== true) {
    return { credited: 0, skipped: 'disabled', at: assertValidDate(now, 'now').toISOString() };
  }
  return runDailyAutoCheckin(now, { ...options, enabled: true, settings });
}

module.exports = {
  AUTO_CHECKIN_HOUR_UTC,
  AUTO_CHECKIN_MINUTE_UTC,
  DEFAULT_BATCH_SIZE,
  NOTIFICATION_LEASE_MS,
  NOTIFICATION_TYPE,
  automaticCheckinTarget,
  claimDailyCheckin,
  claimNotificationDelivery,
  dailyCheckinSourceId,
  isAutomaticCheckinDue,
  nextAutomaticCheckinTarget,
  notificationText,
  runDailyAutoCheckin,
  runDailyAutoCheckinSweep,
  validateRewardAmount
};
