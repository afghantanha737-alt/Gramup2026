'use strict';

const NotificationDelivery = require('../models/NotificationDelivery');
const { notifyUser } = require('./bot');

const SENDING_LEASE_MS = 10 * 60 * 1000;

/**
 * Sends one Telegram notification for one immutable business event.
 * A stale sending lease is reclaimable; provider errors are persisted so no
 * delivery remains indefinitely stuck in the sending state.
 */
async function sendNotificationOnce({ eventKey, type, user, telegramId, text }) {
  if (!eventKey || !type || !user || !telegramId || !text) return { status: 'skipped' };

  const now = new Date();
  const staleBefore = new Date(now.getTime() - SENDING_LEASE_MS);
  let delivery;
  try {
    delivery = await NotificationDelivery.findOneAndUpdate(
      {
        eventKey,
        $or: [
          { status: 'pending' },
          { status: 'sending', sendingAt: { $lt: staleBefore } }
        ]
      },
      {
        $set: {
          status: 'sending',
          type,
          user,
          telegramId,
          sendingAt: now,
          error: ''
        },
        $inc: { attempts: 1 }
      },
      { new: true }
    );
    if (!delivery) {
      delivery = await NotificationDelivery.create({
        eventKey,
        type,
        user,
        telegramId,
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
    delivered = await notifyUser(telegramId, text);
    if (!delivered) deliveryError = 'Telegram delivery did not confirm success.';
  } catch (error) {
    deliveryError = String(error?.message || error).slice(0, 500);
  }

  if (delivered) {
    await NotificationDelivery.updateOne(
      { _id: delivery._id, status: 'sending' },
      { $set: { status: 'sent', sentAt: new Date(), sendingAt: null, error: '' } }
    );
    return { status: 'sent' };
  }

  await NotificationDelivery.updateOne(
    { _id: delivery._id, status: 'sending' },
    { $set: { status: 'unknown', sendingAt: null, error: deliveryError || 'Telegram delivery failed.' } }
  );
  return { status: 'unknown', error: deliveryError || 'Telegram delivery failed.' };
}

module.exports = { SENDING_LEASE_MS, sendNotificationOnce };
