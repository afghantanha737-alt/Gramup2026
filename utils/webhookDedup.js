'use strict';
const crypto = require('crypto');
const TelegramWebhookUpdate = require('../models/TelegramWebhookUpdate');
const PROCESSING_LEASE_MS = 10 * 60 * 1000;

async function claimWebhookUpdate(updateId, updateType = 'other', Model = TelegramWebhookUpdate) {
  const id = Number(updateId);
  if (!Number.isSafeInteger(id) || id < 0) return { claimed: false, invalid: true };
  const now = new Date();
  const processingToken = crypto.randomUUID();
  try {
    await Model.create({ updateId: id, updateType, status: 'processing', processingToken, processingStartedAt: now, attemptCount: 1 });
    return { claimed: true, processingToken };
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }

  // A transiently failed request (Telegram retries after HTTP 500) or a worker
  // that died while processing can be reclaimed. The token prevents an older
  // handler from marking a newer attempt complete after its lease was replaced.
  const staleBefore = new Date(now.getTime() - PROCESSING_LEASE_MS);
  const reclaimed = await Model.findOneAndUpdate(
    {
      updateId: id,
      $or: [
        { status: 'failed' },
        { status: 'processing', processingStartedAt: { $lt: staleBefore } },
        { status: 'processing', processingStartedAt: null },
        { status: 'processing', processingStartedAt: { $exists: false } }
      ]
    },
    {
      $set: { updateType, status: 'processing', processingToken, processingStartedAt: now, receivedAt: now, completedAt: null, failureCode: '' },
      $inc: { attemptCount: 1 }
    },
    { new: true }
  );
  return reclaimed ? { claimed: true, processingToken, reclaimed: true } : { claimed: false, duplicate: true };
}

async function finishWebhookUpdate(updateId, status, failureCode = '', processingToken = '', Model = TelegramWebhookUpdate) {
  if (!['completed', 'failed'].includes(status)) throw new TypeError('Invalid webhook update status.');
  if (!processingToken) throw new TypeError('A webhook processing token is required.');
  await Model.updateOne({ updateId: Number(updateId), status: 'processing', processingToken }, {
    $set: { status, completedAt: new Date(), processingStartedAt: null, failureCode: String(failureCode || '').slice(0, 80) }
  });
}

module.exports = { claimWebhookUpdate, finishWebhookUpdate, PROCESSING_LEASE_MS };
