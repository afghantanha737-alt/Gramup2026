'use strict';

const NotificationDelivery = require('../models/NotificationDelivery');
const { notifyUser: defaultNotifyUser } = require('./bot');

const SENDING_LEASE_MS = 10 * 60 * 1000;
const DEFAULT_RETRY_BASE_MS = 60 * 1000;
const DEFAULT_RETRY_MAX_MS = 60 * 60 * 1000;

function retryDelayMs(attempts, baseMs = DEFAULT_RETRY_BASE_MS, maxMs = DEFAULT_RETRY_MAX_MS) {
  const exponent = Math.max(0, Math.min(10, Number(attempts) - 1));
  return Math.min(maxMs, baseMs * (2 ** exponent));
}

function asDate(value) {
  const resolved = typeof value === 'function' ? value() : value;
  const date = resolved instanceof Date ? resolved : new Date(resolved || Date.now());
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function dueAt(now) {
  return {
    $or: [
      { nextAttemptAt: null },
      { nextAttemptAt: { $exists: false } },
      { nextAttemptAt: { $lte: now } }
    ]
  };
}

/**
 * Inserts the immutable Telegram payload in the same Mongo transaction as the
 * business event. The unique eventKey makes concurrent callers converge on one
 * outbox row without changing an already-persisted message.
 */
async function enqueuePendingNotification({ eventKey, type, user, telegramId, text, session }, dependencies = {}) {
  if (!eventKey || !type || !user || !telegramId || !text) return { status: 'skipped' };

  const Model = dependencies.NotificationDelivery || dependencies.notificationDeliveryModel || NotificationDelivery;
  const update = {
    $setOnInsert: {
      eventKey,
      type,
      user,
      telegramId,
      text,
      status: 'pending',
      attempts: 0,
      sendingAt: null,
      sentAt: null,
      nextAttemptAt: null,
      error: ''
    }
  };
  const options = { new: true, upsert: true, setDefaultsOnInsert: true };
  if (session) options.session = session;
  return Model.findOneAndUpdate({ eventKey }, update, options);
}

/**
 * Sends one Telegram notification for one immutable business event.
 *
 * The default contract intentionally keeps weekly callers unchanged: only
 * pending rows and stale sending leases are claimable. Retry workers may opt
 * into claimable unknown rows with retryUnknown: true.
 */
async function sendNotificationOnce(payload = {}, dependencies = {}) {
  const { eventKey, type, user, telegramId, text } = payload;
  if (!eventKey || !type || !user || !telegramId || !text) return { status: 'skipped' };

  const Model = dependencies.NotificationDelivery || dependencies.notificationDeliveryModel || NotificationDelivery;
  const notifyUser = dependencies.notifyUser || defaultNotifyUser;
  const now = asDate(dependencies.now || new Date());
  const staleBefore = new Date(now.getTime() - SENDING_LEASE_MS);
  const retryUnknown = dependencies.retryUnknown === true;
  const maxAttempts = Number.isFinite(Number(dependencies.maxAttempts))
    ? Math.max(1, Number(dependencies.maxAttempts))
    : null;
  const claimable = [
    { status: 'pending', ...dueAt(now) },
    { status: 'sending', sendingAt: { $lt: staleBefore } }
  ];
  if (retryUnknown) claimable.push({ status: 'unknown', ...dueAt(now) });

  const filter = { eventKey, $or: claimable };
  if (maxAttempts != null) filter.attempts = { $lt: maxAttempts };

  const claimUpdate = {
    $set: {
      status: 'sending',
      type,
      user,
      telegramId,
      text,
      sendingAt: now,
      nextAttemptAt: null,
      error: ''
    },
    $inc: { attempts: 1 }
  };

  let delivery;
  try {
    delivery = await Model.findOneAndUpdate(filter, claimUpdate, { new: true });
    if (!delivery) {
      delivery = await Model.create({
        eventKey,
        type,
        user,
        telegramId,
        text,
        status: 'sending',
        attempts: 1,
        sendingAt: now,
        nextAttemptAt: null,
        error: ''
      });
    }
  } catch (error) {
    if (error?.code === 11000) return { status: 'duplicate' };
    throw error;
  }

  let delivered = false;
  let deliveryError = '';
  try {
    delivered = await notifyUser(telegramId, text);
    if (!delivered) deliveryError = 'Telegram delivery did not confirm success.';
  } catch (error) {
    deliveryError = String(error?.message || error).slice(0, 500);
  }

  if (delivered) {
    await Model.updateOne(
      { _id: delivery._id, status: 'sending', attempts: delivery.attempts },
      { $set: { status: 'sent', sentAt: new Date(), sendingAt: null, nextAttemptAt: null, error: '' } }
    );
    return { status: 'sent' };
  }

  const attempts = Number(delivery.attempts) || 1;
  const exhausted = maxAttempts != null && attempts >= maxAttempts;
  const nextAttemptAt = new Date(now.getTime() + retryDelayMs(attempts, dependencies.retryBaseMs, dependencies.retryMaxMs));
  await Model.updateOne(
    { _id: delivery._id, status: 'sending', attempts: delivery.attempts },
    {
      $set: {
        status: exhausted ? 'exhausted' : 'unknown',
        sendingAt: null,
        nextAttemptAt: exhausted ? null : nextAttemptAt,
        exhaustedAt: exhausted ? now : null,
        error: deliveryError || 'Telegram delivery failed.'
      }
    }
  );
  return { status: exhausted ? 'exhausted' : 'unknown', error: deliveryError || 'Telegram delivery failed.', nextAttemptAt: exhausted ? null : nextAttemptAt };
}

module.exports = {
  SENDING_LEASE_MS,
  DEFAULT_RETRY_BASE_MS,
  DEFAULT_RETRY_MAX_MS,
  retryDelayMs,
  enqueuePendingNotification,
  // Alias kept explicit for integrations that describe this as an outbox.
  enqueueNotification: enqueuePendingNotification,
  createPendingNotification: enqueuePendingNotification,
  sendNotificationOnce
};
