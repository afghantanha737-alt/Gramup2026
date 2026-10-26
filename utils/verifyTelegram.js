'use strict';

const { verifyInitData } = require('./telegramAuth');

/**
 * Backwards-compatible wrapper around the canonical Telegram WebApp validator.
 * All callers receive only the validated Telegram user object, while the
 * canonical validator enforces duplicate-key checks, auth_date/max-age,
 * schema validation and timing-safe HMAC comparison.
 */
function verifyTelegramInitData(initData, botToken) {
  const verified = verifyInitData(initData, botToken);
  return verified?.user || null;
}

module.exports = verifyTelegramInitData;
