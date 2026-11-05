'use strict';

const BOT_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_DELIVERY_TIMEOUT_MS = 8000;
const DELIVERY_METHODS = new Set(['sendMessage', 'sendPhoto', 'copyMessage', 'answerCallbackQuery']);
const TELEGRAM_USER_ID_PATTERN = /^[1-9]\d{0,15}$/;
const TELEGRAM_MAX_USER_ID = (1n << 52n) - 1n;
const DEFAULT_BROADCAST_INTERVAL_MS = 50;

class TelegramApiError extends Error {
  constructor(message, statusCode, body) {
    super(message);
    this.name = 'TelegramApiError';
    this.response = { statusCode, body };
  }
}

function buildTelegramWebhookPayload(url, options = {}) {
  return { url, ...options };
}

async function withTelegramDeliveryDeadline(operation, timeoutMs = TELEGRAM_DELIVERY_TIMEOUT_MS) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TelegramApiError('Telegram notification timed out', 504, { error_code: 504 }));
    }, timeoutMs);
  });
  try {
    // Promise.race also bounds test/custom transports that ignore AbortSignal.
    return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

class TelegramBotClient {
  constructor(token) {
    this.token = token;
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  async call(method, payload = {}, options = {}) {
    const delivery = DELIVERY_METHODS.has(method);
    const request = async signal => {
      const response = await fetch(`${this.baseUrl}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(options.headers || {}) },
        body: JSON.stringify(payload),
        ...(signal ? { signal } : {})
      });
      let body = {};
      try { body = await response.json(); } catch { body = {}; }
      if (!response.ok || body.ok === false || (delivery && body.ok !== true)) {
        throw new TelegramApiError(body.description || `Telegram API ${method} failed`, response.status, body);
      }
      return body.result;
    };
    return delivery ? withTelegramDeliveryDeadline(request) : request();
  }

  sendMessage(chatId, text, options = {}) {
    return this.call('sendMessage', { chat_id: chatId, text, ...options });
  }

  async sendPhoto(chatId, buffer, options = {}) {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('photo', new Blob([buffer]), 'broadcast.jpg');
    for (const [key, value] of Object.entries(options || {})) {
      if (value !== undefined && value !== null) form.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
    return withTelegramDeliveryDeadline(async signal => {
      const response = await fetch(`${this.baseUrl}/sendPhoto`, { method: 'POST', body: form, signal });
      let body = {};
      try { body = await response.json(); } catch { body = {}; }
      if (!response.ok || body.ok !== true) {
        throw new TelegramApiError(body.description || 'Telegram sendPhoto failed', response.status, body);
      }
      return body.result;
    });
  }

  copyMessage(chatId, fromChatId, messageId, options = {}) {
    return this.call('copyMessage', { chat_id: chatId, from_chat_id: fromChatId, message_id: messageId, ...options });
  }

  answerCallbackQuery(callbackQueryId, options = {}) {
    return this.call('answerCallbackQuery', { callback_query_id: callbackQueryId, ...options });
  }

  setWebHook(url, options = {}) {
    // Telegram expects secret_token as a setWebhook parameter, then sends it
    // back to this server as X-Telegram-Bot-Api-Secret-Token on each update.
    return this.call('setWebhook', buildTelegramWebhookPayload(url, options));
  }

  getWebhookInfo() { return this.call('getWebhookInfo'); }
  getChat(chatId) { return this.call('getChat', { chat_id: chatId }); }
  getMe() { return this.call('getMe'); }
  getChatMember(chatId, userId) { return this.call('getChatMember', { chat_id: chatId, user_id: userId }); }
}

// یک instance مشترک ربات برای کل پروژه (webhook, verify عضویت, ارسال عکس, پیام همگانی)
const bot = BOT_TOKEN ? new TelegramBotClient(BOT_TOKEN) : null;

function withTimeout(promise, ms, fallbackValue) {
  promise.catch(() => {});
  return Promise.race([
    promise,
    new Promise(resolve => setTimeout(() => resolve(fallbackValue), ms))
  ]);
}

async function checkChatMembership(chatId, telegramUserId) {
  if (!bot) return { joined: false, configError: 'BOT_TOKEN تنظیم نشده است.' };
  if (!chatId) return { joined: false, configError: 'برای این تسک chatId ثبت نشده است.' };

  try {
    const member = await withTimeout(bot.getChatMember(chatId, telegramUserId), 25000, 'TIMEOUT');
    if (member === 'TIMEOUT') {
      console.warn(`getChatMember timed out for chat=${chatId} user=${telegramUserId}`);
      return { joined: false, configError: 'پاسخ تلگرام کند بود (Timeout). دوباره تلاش کن.' };
    }
    return { joined: ['member', 'administrator', 'creator'].includes(member.status) };
  } catch (error) {
    const raw = error.message || '';
    console.warn(`getChatMember failed for chat=${chatId} user=${telegramUserId}:`, raw);
    const isConfigIssue = /chat not found/i.test(raw) || /not enough rights/i.test(raw) || /member list is inaccessible/i.test(raw) || /bot is not a member/i.test(raw) || /kicked/i.test(raw);
    if (isConfigIssue) return { joined: false, configError: `مشکل تنظیمات تسک: ${raw}` };
    return { joined: false };
  }
}

async function isChatMember(chatId, telegramUserId) {
  const result = await checkChatMembership(chatId, telegramUserId);
  return result.joined;
}

async function notifyUser(telegramId, text, options = {}) {
  if (!bot || !telegramId) return false;
  try {
    await bot.sendMessage(telegramId, text, options);
    return true;
  } catch (error) {
    const blocked = isTelegramDeliveryBlocked(error);
    const errorCode = error?.response?.body?.error_code || error?.response?.statusCode || null;
    console.warn(JSON.stringify({
      event: 'telegram_notification_failed',
      telegramId: String(telegramId),
      blocked,
      errorCode,
      error: String(error?.message || error).slice(0, 300),
      at: new Date().toISOString()
    }));
    if (blocked) {
      await markTelegramBlocked(telegramId);
      return false;
    }
    return false;
  }
}

function isTelegramDeliveryBlocked(error) {
  const code = error?.response?.body?.error_code || error?.response?.statusCode;
  const message = String(error?.message || error || '');
  return Number(code) === 403 || /bot was blocked|user is deactivated|chat not found/i.test(message);
}

function buildWebAppReplyMarkup(buttonText, webAppUrl) {
  const text = String(buttonText || '').trim();
  if (!text) return null;
  if (text.length > 64) throw new TypeError('WebApp button text must be 64 characters or fewer.');
  let url;
  try { url = new URL(String(webAppUrl || '').trim()); }
  catch { throw new TypeError('A valid HTTPS Mini App URL is required for a WebApp button.'); }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new TypeError('A valid HTTPS Mini App URL is required for a WebApp button.');
  }
  return { inline_keyboard: [[{ text, web_app: { url: url.toString() } }]] };
}

function getTelegramRetryAfterMs(error) {
  const body = error?.response?.body || {};
  const code = Number(body.error_code || error?.response?.statusCode || error?.statusCode);
  const message = String(error?.message || error || '');
  const rateLimited = code === 429 || error?.name === 'FloodWait' || /too many requests|flood.?wait/i.test(message);
  if (!rateLimited) return null;

  let seconds = body.parameters?.retry_after
    ?? error?.parameters?.retry_after
    ?? error?.retry_after
    ?? error?.retryAfter
    ?? error?.seconds;
  if (seconds == null) {
    const match = message.match(/retry\s+after\s+(\d+(?:\.\d+)?)/i);
    seconds = match ? Number(match[1]) : 1;
  }
  const numericSeconds = Number(seconds);
  return Math.max(DEFAULT_BROADCAST_INTERVAL_MS, Math.ceil((Number.isFinite(numericSeconds) && numericSeconds >= 0 ? numericSeconds : 1) * 1000));
}

async function markTelegramBlocked(telegramId, UserModel) {
  try {
    const User = UserModel || require('../models/User');
    await User.updateOne(
      { telegramId: String(telegramId), telegramBlockedAt: null },
      { $set: { telegramBlockedAt: new Date() } }
    );
  } catch (error) {
    console.warn('Failed to mark Telegram-blocked user:', error.message || error);
  }
}

// رکوردهای قدیمی ممکن است قبل از اضافه‌شدن فیلدهای isBanned و
// telegramBlockedAt ایجاد شده باشند؛ نبودن این فیلدها نباید کاربر سالم را
// از پیام‌های همگانی حذف کند.
function activeTelegramUserFilter() {
  return {
    // Keep this broad enough to retrieve legacy rows whose BSON ID was stored
    // as a number; filterActiveTelegramRecipients validates the final chat ID.
    telegramId: { $exists: true, $nin: [null, ''] },
    $and: [
      { $or: [{ isBanned: false }, { isBanned: { $exists: false } }] },
      { $or: [{ telegramBlockedAt: null }, { telegramBlockedAt: { $exists: false } }] }
    ]
  };
}

function isValidTelegramUserId(value) {
  const id = String(value == null ? '' : value);
  if (!TELEGRAM_USER_ID_PATTERN.test(id)) return false;
  try { return BigInt(id) <= TELEGRAM_MAX_USER_ID; }
  catch { return false; }
}

function filterActiveTelegramRecipients(users) {
  return (Array.isArray(users) ? users : []).filter(user =>
    isValidTelegramUserId(user?.telegramId) && user?.isBanned !== true && !user?.telegramBlockedAt
  );
}

async function deliverBroadcastRecipient(User, user, send, sleepFn) {
  const telegramId = String(user?.telegramId || '');
  while (true) {
    try {
      await send();
      return 'sent';
    } catch (error) {
      if (isTelegramDeliveryBlocked(error)) {
        await markTelegramBlocked(telegramId, User);
        return 'blocked';
      }

      const retryAfterMs = getTelegramRetryAfterMs(error);
      if (retryAfterMs !== null) {
        console.warn(JSON.stringify({ event: 'telegram_broadcast_rate_limited', retryAfterMs, at: new Date().toISOString() }));
        await sleepFn(retryAfterMs);
        continue;
      }

      console.warn(JSON.stringify({
        event: 'telegram_broadcast_delivery_failed',
        errorCode: error?.response?.body?.error_code || error?.response?.statusCode || null,
        error: String(error?.message || error).slice(0, 300),
        at: new Date().toISOString()
      }));
      return 'failed';
    }
  }
}

async function runBroadcastRecipients(User, users, sendForUser, options = {}) {
  const intervalMs = Number.isFinite(Number(options.intervalMs))
    ? Math.max(0, Number(options.intervalMs))
    : DEFAULT_BROADCAST_INTERVAL_MS;
  const sleepFn = typeof options.sleepFn === 'function'
    ? options.sleepFn
    : ms => new Promise(resolve => setTimeout(resolve, ms));
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const summary = { sent: 0, failed: 0, blocked: 0, total: users.length, processed: 0 };

  async function reportProgress() {
    if (!onProgress) return;
    try { await onProgress({ ...summary }); }
    catch (error) { console.warn('Broadcast progress update failed:', error.message || error); }
  }

  for (const user of users) {
    const outcome = await deliverBroadcastRecipient(User, user, () => sendForUser(user), sleepFn);
    summary[outcome] += 1;
    summary.processed += 1;
    if (summary.processed % 20 === 0 || summary.processed === summary.total) await reportProgress();
    if (summary.processed < summary.total) await sleepFn(intervalMs);
  }
  if (summary.total === 0) await reportProgress();
  return summary;
}

async function broadcastToActiveUsers(User, textOrFn, options = {}) {
  if (!bot) return { sent: 0, failed: 0, blocked: 0, total: 0, processed: 0 };
  const candidates = Array.isArray(options.recipients)
    ? options.recipients
    : await User.find(activeTelegramUserFilter(), 'telegramId language');
  const users = filterActiveTelegramRecipients(candidates);
  console.log(`📣 Text broadcast started: recipients=${users.length}`);
  const textFor = typeof textOrFn === 'function' ? textOrFn : () => textOrFn;
  const sendForUser = async user => {
    const text = await textFor(user);
    const sendOptions = { ...(options.sendOptions || {}) };
    if (options.replyMarkup) sendOptions.reply_markup = options.replyMarkup;
    if (options.imageBuffer) {
      await bot.sendPhoto(user.telegramId, options.imageBuffer, { caption: text, ...sendOptions });
    } else {
      await bot.sendMessage(user.telegramId, text, sendOptions);
    }
  };
  const summary = await runBroadcastRecipients(User, users, sendForUser, options);
  console.log(`📣 Broadcast finished: sent=${summary.sent} failed=${summary.failed} blocked=${summary.blocked} total=${summary.total}`);
  return summary;
}

async function broadcastCopyToActiveUsers(User, fromChatId, messageId) {
  if (!bot) return { sent: 0, failed: 0, blocked: 0, total: 0, processed: 0 };
  const candidates = await User.find(activeTelegramUserFilter(), 'telegramId isBanned telegramBlockedAt');
  const users = filterActiveTelegramRecipients(candidates);
  console.log(`📣 Copy broadcast started: recipients=${users.length}, source=${fromChatId}/${messageId}`);
  const summary = await runBroadcastRecipients(User, users, user => bot.copyMessage(user.telegramId, fromChatId, messageId));
  console.log(`📣 Copy broadcast finished: sent=${summary.sent} failed=${summary.failed} blocked=${summary.blocked} total=${summary.total}`);
  return summary;
}

module.exports = { bot, buildTelegramWebhookPayload, buildWebAppReplyMarkup, getTelegramRetryAfterMs, isChatMember, checkChatMembership, notifyUser, markTelegramBlocked, isTelegramDeliveryBlocked, activeTelegramUserFilter, isValidTelegramUserId, filterActiveTelegramRecipients, broadcastToActiveUsers, broadcastCopyToActiveUsers, withTelegramDeliveryDeadline };
