'use strict';
const mongoose = require('mongoose');

const walletQuoteSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  quoteId: { type: String, required: true, unique: true },
  fromAsset: { type: String, enum: ['UP', 'GRAM', 'USDT'], required: true },
  toAsset: { type: String, enum: ['UP', 'GRAM', 'USDT'], required: true },
  amount: { type: Number, required: true, min: 0 },
  receiveAmount: { type: Number, required: true, min: 0 },
  rate: { type: Number, required: true, min: 0 },
  pricesUsd: { type: Map, of: Number, default: {} },
  priceSource: { type: Map, of: String, default: {} },
  stale: { type: Map, of: Boolean, default: {} },
  expiresAt: { type: Date, required: true },
  consumedAt: { type: Date, default: null },
  conversionId: { type: String, default: '' }
}, { timestamps: true });

walletQuoteSchema.index({ user: 1, quoteId: 1 }, { unique: true });
walletQuoteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('WalletQuote', walletQuoteSchema);
