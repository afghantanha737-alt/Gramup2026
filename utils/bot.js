'use strict';

const BOT_TOKEN = process.env.BOT_TOKEN;

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

class TelegramBotClient {
  constructor(token) {
    this.token = token;
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  async call(method, payload = {}, options = {}) {
    const response = await fetch(`${this.baseUrl}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(options.headers || {}) },
      body: JSON.stringify(payload)
    });
    let body = {};
    try { body = await response.json(); } catch { body = {}; }
    if (!response.ok || body.ok === false) {
      throw new TelegramApiError(body.description || `Telegram API ${method} failed`, response.status, body);
    }
    return body.result;
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
    const response = await fetch(`${this.baseUrl}/sendPhoto`, { method: 'POST', body: form });
    let body = {};
    try { body = await response.json(); } catch { body = {}; }
    if (!response.ok || body.ok === false) {
      throw new TelegramApiError(body.description || 'Telegram sendPhoto failed', response.status, body);
    }
    return body.result;
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
    if (isTelegramDeliveryBlocked(error)) {
      await markTelegramBlocked(telegramId);
      return false;
    }
    console.warn(`notifyUser failed for telegramId=${telegramId}:`, error.message || error);
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

async function copyMessageSafe(User, telegramId, fromChatId, messageId) {
  try {
    await bot.copyMessage(telegramId, fromChatId, messageId);
    return true;
  } catch (error) {
    if (isTelegramDeliveryBlocked(error)) await markTelegramBlocked(telegramId);
    return false;
  }
}

async function broadcastToActiveUsers(User, textOrFn) {
  if (!bot) return;
  const users = await User.find(activeTelegramUserFilter(), 'telegramId language');
  console.log(`📣 Text broadcast started: recipients=${users.length}`);
  const BATCH_SIZE = 20;
  const DELAY_MS = 1100;
  const textFor = typeof textOrFn === 'function' ? textOrFn : () => textOrFn;
  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const batch = users.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(u => notifyUser(u.telegramId, textFor(u))));
    if (i + BATCH_SIZE < users.length) await new Promise(resolve => setTimeout(resolve, DELAY_MS));
  }
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

module.exports = { bot, buildTelegramWebhookPayload, isChatMember, checkChatMembership, notifyUser, markTelegramBlocked, isTelegramDeliveryBlocked, activeTelegramUserFilter, broadcastToActiveUsers, broadcastCopyToActiveUsers };
