'use strict';
const STALE_SENDING_MS = 10 * 60 * 1000;
async function finalizeExhaustedNotifications(type, Model, now = new Date(), maxAttempts = 5) {
  // Tiny offline adapters need not implement collection-wide updates.
  if (typeof Model.updateMany !== 'function') return { modifiedCount: 0 };
  return Model.updateMany({
    type, attempts: { $gte: maxAttempts },
    $or: [
      { status: 'pending' }, { status: 'unknown' },
      { status: 'sending', sendingAt: { $lt: new Date(now.getTime() - STALE_SENDING_MS) } }
    ]
  }, { $set: {
    status: 'exhausted', exhaustedAt: now, sendingAt: null,
    nextAttemptAt: null, error: 'Notification retry limit reached; operator review required.'
  } });
}
module.exports = { finalizeExhaustedNotifications };
