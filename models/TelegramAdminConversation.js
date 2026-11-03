'use strict';
const mongoose = require('mongoose');
const telegramAdminConversationSchema = new mongoose.Schema({
  telegramId: { type: String, required: true },
  state: { type: String, enum: ['awaiting_content', 'pending_confirm'], required: true },
  fromChatId: { type: mongoose.Schema.Types.Mixed, default: null },
  messageId: { type: Number, default: null },
  contentType: { type: String, enum: ['text', 'photo', 'video', 'document', 'audio', 'animation', 'copy'], default: 'copy' },
  contentText: { type: String, default: '' },
  contentCaption: { type: String, default: '' },
  contentFileId: { type: String, default: '' },
  expiresAt: { type: Date, required: true }
}, { timestamps: true });
telegramAdminConversationSchema.index({ telegramId: 1 }, { unique: true, name: 'telegram_admin_conversation_unique' });
telegramAdminConversationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'telegram_admin_conversation_expiry' });
module.exports = mongoose.model('TelegramAdminConversation', telegramAdminConversationSchema);
