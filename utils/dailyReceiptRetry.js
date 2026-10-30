'use strict';

// Retries immutable daily outbox payloads, including prior-date receipts.
// This worker never credits points or changes a streak.
async function runDailyReceiptRetrySweep(options = {}) {
  const Settings = options.Settings || require('../models/Settings');
  const settings = await Settings.getGlobal();
  if (settings.dailyReminderEnabled === false) return { skipped: 'messages_disabled', sent: 0 };
  const Model = options.NotificationDelivery || require('../models/NotificationDelivery');
  const User = options.User || require('../models/User');
  const send = options.sendNotificationOnce || require('./notificationDelivery').sendNotificationOnce;
  const now = options.now || new Date();
  const finalized = await require('./notificationExhaustion').finalizeExhaustedNotifications('daily_checkin', Model, now);
  const due = { $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }] };
  const rows = await Model.find({
    type: 'daily_checkin', text: { $exists: true, $nin: ['', null] }, attempts: { $lt: 5 },
    $or: [
      { status: 'pending', ...due }, { status: 'unknown', ...due },
      { status: 'sending', sendingAt: { $lt: new Date(now.getTime() - 600000) } }
    ]
  }).sort({ nextAttemptAt: 1, _id: 1 }).limit(100).lean();
  const result = { scanned: rows.length, sent: 0, failed: 0, skipped: 0, exhausted: Number(finalized.modifiedCount) || 0 };
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const user = await User.findById(row.user).select('_id telegramId isBanned telegramBlockedAt').lean();
    if (!user || user.isBanned || user.telegramBlockedAt || !/^\d+$/.test(String(user.telegramId || ''))) {
      result.skipped += 1;
      continue;
    }
    try {
      const delivery = await send({
        eventKey: row.eventKey, type: row.type, user: row.user,
        telegramId: row.telegramId, text: row.text
      }, { NotificationDelivery: Model, notifyUser: options.notifyUser, now, retryUnknown: true, maxAttempts: 5 });
      if (delivery.status === 'sent') result.sent += 1;
      else if (delivery.status === 'exhausted') result.exhausted += 1;
      else if (delivery.status === 'unknown') result.failed += 1;
      else result.skipped += 1;
    } catch (error) { result.failed += 1; }
    if (i + 1 < rows.length) await (options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms))))(50);
  }
  return result;
}

module.exports = { runDailyReceiptRetrySweep };
