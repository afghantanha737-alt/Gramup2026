'use strict';

function logTelegramNotificationFailure(error, context = 'notification', logger = console) {
  // Logging is also best-effort; never expose the Telegram URL/token or text.
  try {
    logger?.warn?.({
      event: 'telegram_notification_failed',
      context,
      errorCode: Number(error?.response?.body?.error_code || error?.response?.statusCode) || null,
      errorType: error?.name || 'Error'
    });
  } catch { /* A failed logger must not become a failed business operation. */ }
}

async function safelySendTelegram(operation, { context = 'notification', logger = console } = {}) {
  try {
    const result = await operation();
    return result !== false;
  } catch (error) {
    logTelegramNotificationFailure(error, context, logger);
    return false;
  }
}

module.exports = { safelySendTelegram, logTelegramNotificationFailure };
