'use strict';

const { consumeRateLimit } = require('./sharedRateLimit');

const WINDOW_MS = 60 * 1000;
const SENSITIVE_RATE_LIMITS = Object.freeze({
  general: Object.freeze({ ipMaxRequests: 60, userMaxRequests: 30 }),
  task: Object.freeze({ ipMaxRequests: 30, userMaxRequests: 20 }),
  claim: Object.freeze({ ipMaxRequests: 15, userMaxRequests: 10 }),
  withdraw: Object.freeze({ ipMaxRequests: 10, userMaxRequests: 5 })
});

function boundedLimit(value, fallback) {
  const number = value == null ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > 1000000) {
    throw new RangeError('Invalid API security rate limit');
  }
  return number;
}

function requestIp(req) {
  const value = String(req?.ip || req?.socket?.remoteAddress || 'unknown').trim();
  // Express computes req.ip after applying the server's trust-proxy policy. Do
  // not parse arbitrary forwarding headers here, and never let an empty value
  // bypass the limiter.
  if (!value || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) return 'unknown';
  return value;
}

function authenticatedUserId(req) {
  const value = req?.dbUser?._id ?? req?.dbUser?.telegramId ?? req?.mobileSession?.user?._id;
  const text = value == null ? '' : String(value).trim();
  if (!text || text.length > 256 || /[\u0000-\u001f\u007f]/.test(text)) return null;
  return text;
}

function retryAfterSeconds(resetAt) {
  const time = resetAt instanceof Date ? resetAt.getTime() : new Date(resetAt).getTime();
  if (!Number.isFinite(time)) return 60;
  return Math.max(1, Math.ceil((time - Date.now()) / 1000));
}

function createSensitiveRateLimit(scope, options = {}) {
  const scopeText = String(scope || 'general').trim().toLowerCase();
  if (!/^[a-z0-9:_-]{1,64}$/.test(scopeText)) throw new TypeError('Invalid sensitive rate-limit scope');
  const defaults = SENSITIVE_RATE_LIMITS[scopeText] || SENSITIVE_RATE_LIMITS.general;
  const windowMs = options.windowMs == null ? WINDOW_MS : Number(options.windowMs);
  if (!Number.isSafeInteger(windowMs) || windowMs < 1000 || windowMs > 24 * 60 * 60 * 1000) {
    throw new RangeError('Invalid sensitive rate-limit window');
  }
  const ipMaxRequests = boundedLimit(options.ipMaxRequests, defaults.ipMaxRequests);
  const userMaxRequests = boundedLimit(options.userMaxRequests, defaults.userMaxRequests);
  const consume = options.consume || consumeRateLimit;
  if (typeof consume !== 'function') throw new TypeError('Invalid shared rate-limit consumer');
  const requireUser = options.requireUser !== false;

  return async function sensitiveRateLimitMiddleware(req, res, next) {
    const userId = authenticatedUserId(req);
    if (requireUser && !userId) {
      return res.status(401).json({ success: false, code: 'AUTH_REQUIRED', message: 'ورود کاربر لازم است.' });
    }

    try {
      const ipResult = await consume(`ip:${requestIp(req)}`, `sensitive:${scopeText}:ip`, ipMaxRequests, windowMs);
      if (!ipResult || ipResult.allowed !== true) {
        const retryAfter = retryAfterSeconds(ipResult?.resetAt);
        res.set?.('Retry-After', String(retryAfter));
        return res.status(429).json({ success: false, code: 'RATE_LIMITED', message: 'تعداد درخواست‌ها بیش از حد مجاز است.', retryAfter });
      }

      if (userId) {
        const userResult = await consume(`user:${userId}`, `sensitive:${scopeText}:user`, userMaxRequests, windowMs);
        if (!userResult || userResult.allowed !== true) {
          const retryAfter = retryAfterSeconds(userResult?.resetAt);
          res.set?.('Retry-After', String(retryAfter));
          return res.status(429).json({ success: false, code: 'RATE_LIMITED', message: 'تعداد درخواست‌های این حساب بیش از حد مجاز است.', retryAfter });
        }
      }
      return next();
    } catch (error) {
      // An unavailable or malformed shared store must never turn a sensitive
      // operation into an unmetered operation.
      console.error('Sensitive shared rate limiter unavailable:', error.message || error);
      return res.status(503).json({ success: false, code: 'RATE_LIMIT_UNAVAILABLE', message: 'درخواست موقتاً در دسترس نیست.' });
    }
  };
}

function sensitiveRateLimit(scope, options) {
  return createSensitiveRateLimit(scope, options);
}

function mobileBootstrapRateLimit(action, options = {}) {
  if (!['challenge', 'poll', 'consume'].includes(action)) throw new TypeError('Invalid mobile bootstrap scope');
  const limits = { challenge: 10, poll: 120, consume: 20 };
  const consume = options.consume || consumeRateLimit;
  const ipLimiter = createSensitiveRateLimit(`mobile_${action}`, {
    ipMaxRequests: limits[action], userMaxRequests: 30, requireUser: false, consume
  });
  return function mobileBootstrapMiddleware(req, res, next) {
    return ipLimiter(req, res, async () => {
      if (action === 'challenge') return next();
      const id = req.params?.challengeId ?? req.body?.challengeId;
      if (typeof id !== 'string' || !id || id.length > 128) {
        return res.status(400).json({ success: false, code: 'MOBILE_CHALLENGE_INVALID', message: 'چالش ورود نامعتبر است.' });
      }
      try {
        // Challenge token never appears in the key or logs. Bound polling and
        // token consumption even if an attacker switches source IP addresses.
        const identity = require('crypto').createHash('sha256').update(id).digest('hex');
        const result = await consume(`challenge:${identity}`, `mobile:${action}:challenge`, action === 'poll' ? 60 : 5, WINDOW_MS);
        if (!result || result.allowed !== true) {
          const retryAfter = retryAfterSeconds(result?.resetAt);
          res.set?.('Retry-After', String(retryAfter));
          return res.status(429).json({ success: false, code: 'RATE_LIMITED', retryAfter });
        }
        return next();
      } catch {
        return res.status(503).json({ success: false, code: 'RATE_LIMIT_UNAVAILABLE', message: 'ورود موقتاً در دسترس نیست.' });
      }
    });
  };
}

module.exports = {
  WINDOW_MS,
  SENSITIVE_RATE_LIMITS,
  requestIp,
  authenticatedUserId,
  createSensitiveRateLimit,
  sensitiveRateLimit,
  mobileBootstrapRateLimit
};
