'use strict';

/**
 * منطق خالص (بدون دیتابیس/ربات) برای بخش «مدیریت از تلگرام» — قابل تست مستقل.
 * هویت ادمین فقط از روی telegramId امضاشده‌ی خودِ آپدیت تلگرام تایید می‌شود (نه از ورودی کاربر)،
 * پس این مسیر امن است حتی بدون کلید جداگانه.
 */

function parseAdminIds(raw) {
  return new Set(
    String(raw || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  );
}

function isAdminTelegramId(telegramId, raw = process.env.ADMIN_TELEGRAM_IDS) {
  const ids = parseAdminIds(raw);
  return ids.has(String(telegramId));
}

/** حداکثر عمر «در انتظار محتوای پیام همگانی» و «در انتظار تایید» (میلی‌ثانیه) */
const BROADCAST_STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Conversation state is persisted in Mongo so every app instance sees the same workflow.
 */
function createAdminSessionStore(now = () => Date.now(), Model = require('../models/TelegramAdminConversation')) {
  const expiry = () => new Date(now() + BROADCAST_STATE_TTL_MS);
  async function upsertConversation(telegramId, update) {
    const filter = { telegramId: String(telegramId) };
    try {
      return await Model.findOneAndUpdate(filter, update, { upsert: true, new: true, setDefaultsOnInsert: true });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      return Model.findOneAndUpdate(filter, update, { new: true });
    }
  }
  return {
    async setAwaitingContent(telegramId) {
      await upsertConversation(telegramId, {
        $set: { state: 'awaiting_content', fromChatId: null, messageId: null, expiresAt: expiry() }
      }, { upsert: true, new: true, setDefaultsOnInsert: true });
    },
    async isAwaitingContent(telegramId) {
      return Boolean(await Model.exists({ telegramId: String(telegramId), state: 'awaiting_content', expiresAt: { $gt: new Date(now()) } }));
    },
    async clearAwaitingContent(telegramId) {
      await Model.deleteOne({ telegramId: String(telegramId), state: 'awaiting_content' });
    },
    async setPendingConfirm(telegramId, fromChatId, messageId) {
      await upsertConversation(telegramId, {
        $set: { state: 'pending_confirm', fromChatId, messageId: Number(messageId), expiresAt: expiry() }
      }, { upsert: true, new: true, setDefaultsOnInsert: true });
    },
    async takePendingConfirm(telegramId) {
      return Model.findOneAndDelete({ telegramId: String(telegramId), state: 'pending_confirm', expiresAt: { $gt: new Date(now()) } })
        .select('fromChatId messageId expiresAt').lean();
    },
    async hasPendingConfirm(telegramId) {
      return Boolean(await Model.exists({ telegramId: String(telegramId), state: 'pending_confirm', expiresAt: { $gt: new Date(now()) } }));
    }
  };
}

module.exports = { parseAdminIds, isAdminTelegramId, createAdminSessionStore, BROADCAST_STATE_TTL_MS };
