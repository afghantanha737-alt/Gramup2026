'use strict';
const mongoose = require('mongoose');

const MAX_BUCKET_COUNT = 1000001;
const rateLimitBucketSchema = new mongoose.Schema({
  _id: { type: String, required: true, maxlength: 64 },
  count: { type: Number, required: true, min: 0, max: MAX_BUCKET_COUNT, validate: Number.isInteger, default: 0 },
  resetAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true }
}, { versionKey: false, timestamps: false, strict: 'throw' });
rateLimitBucketSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'rate_limit_expiry' });
module.exports = mongoose.model('RateLimitBucket', rateLimitBucketSchema);
