'use strict';
const mongoose = require('mongoose');

const idempotencyOperationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  scope: { type: String, required: true, enum: [
    'spin',
    'exchange_points_to_gram',
    'exchange_gram_to_points',
    'withdraw',
    'vip_purchase',
    'vip_daily_claim'
  ] },
  key: { type: String, required: true, minlength: 8, maxlength: 120 },
  requestHash: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
  status: { type: String, enum: ['processing', 'completed'], default: 'processing', required: true },
  responseStatus: { type: Number, default: 200 },
  responseBody: { type: mongoose.Schema.Types.Mixed, default: null },
  resourceId: { type: mongoose.Schema.Types.ObjectId, default: null },
  completedAt: { type: Date, default: null }
}, { timestamps: true, minimize: false });

idempotencyOperationSchema.index({ userId: 1, scope: 1, key: 1 }, { unique: true });
idempotencyOperationSchema.index({ userId: 1, createdAt: -1 });
// No TTL: deleting financial idempotency records would permit old retries to pay again.

module.exports = mongoose.model('IdempotencyOperation', idempotencyOperationSchema);
