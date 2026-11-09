'use strict';
const mongoose = require('mongoose');

const adOrderSchema = new mongoose.Schema({
  advertiserTelegramId: { type: String, required: true, index: true },
  advertiserName: { type: String, default: '' },
  title: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, default: '', maxlength: 500 },
  destinationUrl: { type: String, required: true, trim: true },
  telegramChatId: { type: String, default: '' },
  verificationType: { type: String, enum: ['telegram', 'latest_post'], default: 'telegram' },
  targetLanguage: { type: String, default: 'ALL', maxlength: 8 },
  premiumOnly: { type: Boolean, default: false },
  requiredReaction: { type: String, default: '' },
  rewardUp: { type: Number, required: true, min: 1 },
  priceGramPerCompletion: { type: Number, required: true, min: 0.000000001 },
  priceUsdPerCompletion: { type: Number, default: 0, min: 0 },
  completionsRequested: { type: Number, required: true, min: 1, max: 1000000 },
  completionsApproved: { type: Number, default: 0, min: 0 },
  totalCostGram: { type: Number, required: true, min: 0 },
  paymentMethod: { type: String, enum: ['gram_balance', 'ton_mainnet'], default: 'gram_balance' },
  paymentStatus: { type: String, enum: ['pending', 'paid', 'refunded', 'failed'], default: 'pending', index: true },
  status: { type: String, enum: ['payment_pending', 'pending_review', 'approved', 'running', 'completed', 'rejected', 'cancelled'], default: 'pending_review', index: true },
  task: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', default: null },
  paymentSourceId: { type: String, unique: true, sparse: true },
  paymentReference: { type: String, unique: true, sparse: true, index: true },
  paymentAddressSnapshot: { type: String, default: '' },
  paymentAmountRaw: { type: String, default: '' },
  paymentSenderAddress: { type: String, default: '' },
  paymentTxHash: { type: String, unique: true, sparse: true, index: true },
  paymentVerifiedAt: { type: Date, default: null },
  refundSourceId: { type: String, unique: true, sparse: true },
  reviewNote: { type: String, default: '' },
  reviewedBy: { type: String, default: '' },
  reviewedAt: { type: Date, default: null }
}, { timestamps: true });

adOrderSchema.index({ status: 1, createdAt: -1 });
adOrderSchema.index({ advertiserTelegramId: 1, createdAt: -1 });
module.exports = mongoose.model('AdOrder', adOrderSchema);
