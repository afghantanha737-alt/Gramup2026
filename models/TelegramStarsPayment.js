'use strict';
const mongoose = require('mongoose');

const telegramStarsPaymentSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  telegramId: { type: String, required: true, index: true },
  product: { type: String, enum: ['streak_freeze', 'hash_boost_7d', 'vip_gold'], required: true },
  currency: { type: String, enum: ['XTR'], required: true, default: 'XTR' },
  amount: { type: Number, required: true, min: 1 },
  invoicePayload: { type: String, required: true },
  telegramPaymentChargeId: { type: String, required: true, unique: true },
  telegramProviderChargeId: { type: String, default: '' },
  paidAt: { type: Date, required: true, default: Date.now }
}, { timestamps: true });

telegramStarsPaymentSchema.index({ invoicePayload: 1 }, { unique: true });

module.exports = mongoose.model('TelegramStarsPayment', telegramStarsPaymentSchema);
