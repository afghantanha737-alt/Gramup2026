'use strict';
const mongoose = require('mongoose');

/**
 * Reserve accounting is stored in integer Points cents (1 Point = 100 cents).
 * It is an internal liability guard, not a claim that external funds were
 * deposited. Funding must be declared by an authorized admin and audited.
 */
const vipReserveSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, default: 'global' },
  availablePointsCents: { type: Number, required: true, min: 0, default: 0 },
  reservedPointsCents: { type: Number, required: true, min: 0, default: 0 },
  paidPointsCents: { type: Number, required: true, min: 0, default: 0 },
  fundedPointsCents: { type: Number, required: true, min: 0, default: 0 },
  lastFundedAt: { type: Date, default: null },
  lastPaidAt: { type: Date, default: null },
  version: { type: Number, required: true, default: 1 }
}, { timestamps: true });

module.exports = mongoose.model('VipReserve', vipReserveSchema);
