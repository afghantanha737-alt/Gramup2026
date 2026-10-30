'use strict';

const crypto = require('crypto');
const RateLimitBucket = require('../models/RateLimitBucket');

const MIN_WINDOW_MS = 1000;
const MAX_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_REQUESTS = 1_000_000;
const MAX_BUCKET_COUNT = MAX_REQUESTS + 1;

function positiveInteger(value, name, max) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > max) {
    throw new RangeError(`Invalid ${name} for shared rate limiter`);
  }
  return number;
}

function rateLimitKey(identity, scope) {
  const identityText = String(identity ?? '').trim();
  const scopeText = String(scope ?? '').trim();
  if (!identityText || !scopeText || identityText.length > 512 || scopeText.length > 128 || /[\u0000-\u001f\u007f]/.test(`${identityText}${scopeText}`)) {
    throw new TypeError('Invalid shared rate-limit identity or scope');
  }
  return crypto.createHash('sha256').update(`${scopeText}|${identityText}`, 'utf8').digest('hex');
}

function dateValue(value, fallback) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

async function consumeRateLimit(identity, scope, maxRequests, windowMs, nowMs = Date.now(), Model = RateLimitBucket) {
  const max = positiveInteger(maxRequests, 'maxRequests', MAX_REQUESTS);
  const window = positiveInteger(windowMs, 'windowMs', MAX_WINDOW_MS);
  if (window < MIN_WINDOW_MS) throw new RangeError('Invalid windowMs for shared rate limiter');
  if (!Number.isFinite(Number(nowMs)) || !Number.isSafeInteger(Math.floor(Number(nowMs)))) {
    throw new RangeError('Invalid nowMs for shared rate limiter');
  }
  if (!Model || !Model.collection || typeof Model.collection.findOneAndUpdate !== 'function') {
    throw new Error('Shared rate-limit store is unavailable');
  }

  const currentMs = Math.floor(Number(nowMs));
  const now = new Date(currentMs);
  const cutoff = new Date(currentMs - window);
  const key = rateLimitKey(identity, scope);
  const expired = { $lte: [{ $ifNull: ['$resetAt', new Date(0)] }, cutoff] };
  const nextExpiry = new Date(currentMs + 2 * window);
  const pipeline = [{ $set: {
    count: {
      $min: [
        MAX_BUCKET_COUNT,
        { $cond: [expired, 1, { $add: [{ $ifNull: ['$count', 0] }, 1] }] }
      ]
    },
    resetAt: { $cond: [expired, now, { $ifNull: ['$resetAt', now] }] },
    expiresAt: { $cond: [expired, nextExpiry, { $ifNull: ['$expiresAt', nextExpiry] }] }
  } }];

  let result;
  try {
    result = await Model.collection.findOneAndUpdate(
      { _id: key },
      pipeline,
      { upsert: true, returnDocument: 'after' }
    );
  } catch (error) {
    // A concurrent upsert can race on the unique _id. Retry without upsert so
    // the caller still receives an atomic result rather than an allow decision.
    if (error?.code !== 11000) throw error;
    result = await Model.collection.findOneAndUpdate(
      { _id: key },
      pipeline,
      { returnDocument: 'after' }
    );
  }

  const bucket = result && Object.prototype.hasOwnProperty.call(result, 'value') ? result.value : result;
  const count = Number(bucket?.count);
  const resetAt = dateValue(bucket?.resetAt, null);
  const expiresAt = dateValue(bucket?.expiresAt, null);
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_BUCKET_COUNT || !resetAt || !expiresAt) {
    throw new Error('Shared rate-limit store returned an invalid bucket');
  }
  return { allowed: count <= max, count, resetAt };
}

module.exports = {
  rateLimitKey,
  consumeRateLimit,
  MIN_WINDOW_MS,
  MAX_WINDOW_MS,
  MAX_REQUESTS,
  MAX_BUCKET_COUNT
};
