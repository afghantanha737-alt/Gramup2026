'use strict';
const { requireTelegramAuth } = require('./telegramAuth');
const { requireMobileAuth } = require('./mobileAuth');

function isNativeSessionRequest(req) {
  return /^Bearer\s+/i.test(String(req?.get?.('authorization') || ''));
}

/**
 * Preserve the existing Telegram initData contract while accepting a validated
 * mobile Bearer session for the same protected business APIs. A malformed or
 * invalid Bearer credential is never downgraded to Telegram/query auth.
 */
function requireUnifiedAuth(botToken) {
  const telegramAuth = requireTelegramAuth(botToken);
  const mobileAuth = requireMobileAuth();
  return async (req, res, next) => {
    if (isNativeSessionRequest(req)) return mobileAuth(req, res, next);
    return telegramAuth(req, res, next);
  };
}

module.exports = { requireUnifiedAuth, isNativeSessionRequest };
