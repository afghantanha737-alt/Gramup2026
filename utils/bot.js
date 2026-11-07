'use strict';

const BOT_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_DELIVERY_TIMEOUT_MS = 8000;
const DELIVERY_METHODS = new Set(['sendMessage', 'sendPhoto', 'copyMessage', 'answerCallbackQuery']);

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

function parseSafeTelegramUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim()); }
  catch { return null; }
  if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
  if (url.hostname.toLowerCase() === 't.me' && url.protocol !== 'https:') return null;
  return url;
}

function buildWebAppReplyMarkup(buttonText, webAppUrl) {
  const text = String(buttonText || '').trim();
  if (!text) return null;
  if (text.length > 64) throw new TypeError('Button text must be 64 characters or fewer.');
  let url;
  try { url = new URL(String(webAppUrl || '').trim()); }
  catch { throw new TypeError('A valid HTTPS Mini App URL is required for a WebApp button.'); }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new TypeError('A valid HTTPS Mini App URL is required for a WebApp button.');
  }
  return { inline_keyboard: [[{ text, web_app: { url: url.toString() } }]] };
}

function buildBroadcastButtonsReplyMarkup(buttons, webAppUrl) {
  if (!Array.isArray(buttons)) throw new TypeError('Broadcast buttons must be an array.');
  if (!buttons.length) return null;
  if (buttons.length > 8) throw new TypeError('A broadcast can include at most 8 inline buttons.');
  const keyboardButtons = buttons.map((item, index) => {
    const text = String(item?.text || '').trim();
    if (!text) throw new TypeError(`Button ${index + 1} needs a label.`);
    if (text.length > 64) throw new TypeError('Button text must be 64 characters or fewer.');
    const destination = String(item?.url || '').trim();
    if (!destination) {
      const fallback = buildWebAppReplyMarkup(text, webAppUrl);
      return fallback.inline_keyboard[0][0];
    }
    const url = parseSafeTelegramUrl(destination);
    if (!url) throw new TypeError('Enter a valid HTTP(S) button link without credentials; Telegram links must use HTTPS.');
    return { text, url: url.toString() };
  });
  return { inline_keyboard: keyboardButtons.map(button => [button]) };
}

function escapeTelegramHtmlText(value) {
  return String(value).replace(/&(?!amp;|lt;|gt;|quot;)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeTelegramHtmlAttribute(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sanitizeTelegramHtml(value) {
  const source = String(value == null ? '' : value);
  const tags = /<[^<>]*>/g;
  const openTags = [];
  let output = '';
  let cursor = 0;
  let match;
  while ((match = tags.exec(source))) {
    output += escapeTelegramHtmlText(source.slice(cursor, match.index));
    const token = match[0];
    const simpleOpen = token.match(/^<(b|i|code)\s*>$/i);
    const simpleClose = token.match(/^<\/(b|i|code)\s*>$/i);
    const anchorOpen = token.match(/^<a\s+href\s*=\s*(?:"([^"]*)"|'([^']*)')\s*>$/i);
    const anchorClose = /^<\/a\s*>$/i.test(token);
    if (simpleOpen) {
      const tag = simpleOpen[1].toLowerCase();
      if (tag === 'code' ? openTags.length === 0 : !openTags.includes('code')) {
        output += `<${tag}>`;
        openTags.push(tag);
      } else output += escapeTelegramHtmlText(token);
    } else if (simpleClose) {
      const tag = simpleClose[1].toLowerCase();
      if (openTags[openTags.length - 1] === tag) {
        openTags.pop();
        output += `</${tag}>`;
      } else output += escapeTelegramHtmlText(token);
    } else if (anchorOpen) {
      const url = parseSafeTelegramUrl(anchorOpen[1] || anchorOpen[2]);
      if (url && !openTags.includes('a') && !openTags.includes('code')) {
        output += `<a href="${escapeTelegramHtmlAttribute(url.toString())}">`;
        openTags.push('a');
      } else output += escapeTelegramHtmlText(token);
    } else if (anchorClose && openTags[openTags.length - 1] === 'a') {
      openTags.pop();
      output += '</a>';
    } else output += escapeTelegramHtmlText(token);
    cursor = tags.lastIndex;
  }
  output += escapeTelegramHtmlText(source.slice(cursor));
  while (openTags.length) output += `</${openTags.pop()}>`;
  return output;
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

async function markTelegramBlocked(telegramId) {
  try {
    const User = require('../models/User');
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
    telegramId: { $exists: true, $nin: [null, ''] },
    $and: [
      { $or: [{ isBanned: false }, { isBanned: { $exists: false } }] },
      { $or: [{ telegramBlockedAt: null }, { telegramBlockedAt: { $exists: false } }] }
    ]
  };
}

function isValidTelegramUserId(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  const normalized = String(value);
  if (!/^\d{1,16}$/.test(normalized)) return false;
  try {
    const id = BigInt(normalized);
    return id > 0n && id <= 4503599627370495n;
  } catch {
    return false;
  }
}

function filterActiveTelegramRecipients(users) {
  return (Array.isArray(users) ? users : []).filter(user =>
    user && isValidTelegramUserId(user.telegramId) && user.isBanned !== true && user.telegramBlockedAt == null
  );
}

function getTelegramRetryAfterMs(error) {
  const seconds = Number(error?.response?.body?.parameters?.retry_after);
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 1000) : null;
}

function buildBroadcastButtonReplyMarkup(buttonText, buttonUrl, webAppUrl) {
  const text = String(buttonText || '').trim();
  if (!text) return null;
  return buildBroadcastButtonsReplyMarkup([{ text, url: buttonUrl }], webAppUrl);
}

async function copyMessageSafe(User, telegramId, fromChatId, messageId) {
  try {
    await bot.copyMessage(telegramId, fromChatId, messageId);
    return true;
  } catch (error) {
    if (isTelegramDeliveryBlocked(error)) await markTelegramBlocked(telegramId);
    return false;
  }
}

async function broadcastToActiveUsers(User, textOrFn, options = {}) {
  const empty = { sent: 0, failed: 0, blocked: 0, total: 0, processed: 0 };
  if (!bot) return empty;
  const candidates = options.recipients || await User.find(activeTelegramUserFilter(), 'telegramId language isBanned telegramBlockedAt');
  const users = filterActiveTelegramRecipients(candidates);
  const summary = { sent: 0, failed: 0, blocked: 0, total: users.length, processed: 0 };
  const textFor = typeof textOrFn === 'function' ? textOrFn : () => textOrFn;
  const sendOptions = { ...(options.sendOptions || {}) };
  if (options.replyMarkup) sendOptions.reply_markup = options.replyMarkup;
  const intervalMs = Number.isFinite(options.intervalMs) ? Math.max(0, options.intervalMs) : 50;
  const sleep = options.sleepFn || (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  const sleepBeforeRetry = options.retrySleepFn || sleep;
  console.log(`📣 Text broadcast started: recipients=${users.length}`);
  for (let index = 0; index < users.length; index += 1) {
    const user = users[index];
    const text = textFor(user);
    let delivered = false;
    let blocked = false;
    let attempt = 0;
    while (!delivered && attempt < 2) {
      try {
        if (options.imageBuffer) {
          await bot.sendPhoto(user.telegramId, options.imageBuffer, { caption: text, ...sendOptions });
        } else {
          await bot.sendMessage(user.telegramId, text, sendOptions);
        }
        delivered = true;
      } catch (error) {
        const retryAfterMs = getTelegramRetryAfterMs(error);
        if (retryAfterMs !== null && attempt === 0) {
          console.warn(JSON.stringify({ event: 'telegram_broadcast_rate_limited', retryAfterMs, at: new Date().toISOString() }));
          await sleepBeforeRetry(retryAfterMs);
          attempt += 1;
          continue;
        }
        blocked = isTelegramDeliveryBlocked(error);
        if (blocked) await markTelegramBlocked(user.telegramId);
        else console.warn(JSON.stringify({ event: 'telegram_broadcast_delivery_failed', errorCode: error?.response?.body?.error_code || error?.response?.statusCode || null, error: String(error?.message || error).slice(0, 300), at: new Date().toISOString() }));
        break;
      }
    }
    if (delivered) summary.sent += 1;
    else if (blocked) summary.blocked += 1;
    else summary.failed += 1;
    summary.processed += 1;
    if (typeof options.onProgress === 'function') await options.onProgress({ ...summary });
    if (intervalMs > 0 && index < users.length - 1) await sleep(intervalMs);
  }
  console.log(`📣 Broadcast finished: sent=${summary.sent} failed=${summary.failed} blocked=${summary.blocked} total=${summary.total}`);
  return summary;
}

async function broadcastCopyToActiveUsers(User, fromChatId, messageId) {
  if (!bot) return 0;
  const users = await User.find(activeTelegramUserFilter(), 'telegramId');
  console.log(`📣 Copy broadcast started: recipients=${users.length}, source=${fromChatId}/${messageId}`);
  const BATCH_SIZE = 20;
  const DELAY_MS = 1100;
  let sent = 0;
  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const batch = users.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(u => copyMessageSafe(User, u.telegramId, fromChatId, messageId)));
    sent += results.filter(Boolean).length;
    if (i + BATCH_SIZE < users.length) await new Promise(resolve => setTimeout(resolve, DELAY_MS));
  }
  console.log(`📣 Copy broadcast finished: sent=${sent} failed=${users.length - sent} total=${users.length}`);
  return sent;
}

module.exports = { bot, buildTelegramWebhookPayload, buildWebAppReplyMarkup, buildBroadcastButtonReplyMarkup, buildBroadcastButtonsReplyMarkup, sanitizeTelegramHtml, getTelegramRetryAfterMs, isChatMember, checkChatMembership, notifyUser, markTelegramBlocked, isTelegramDeliveryBlocked, activeTelegramUserFilter, isValidTelegramUserId, filterActiveTelegramRecipients, broadcastToActiveUsers, broadcastCopyToActiveUsers, withTelegramDeliveryDeadline };
