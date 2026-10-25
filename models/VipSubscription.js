'use strict';
const mongoose = require('mongoose');
const vipSubscriptionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  planNumber: { type: Number, required: true, min: 1, max: 10 },
  // Legacy purchases keep these point snapshots; new purchases use GRAM fields below.
  pricePoints: { type: Number, min: 0, default: null },
  priceGram: { type: Number, min: 0.000001, default: null },
  pricingCurrency: { type: String, enum: ['points', 'gram'], default: 'points' },
  monthlyRewardPercent: { type: Number, required: true, min: 0, max: 100 },
  durationDays: { type: Number, required: true, min: 1, max: 3650 },
  totalRewardCents: { type: Number, min: 0, default: null },
  totalRewardPoints: { type: Number, min: 0, default: null },
  dailyRewardAveragePoints: { type: Number, min: 0, default: null },
  totalRewardMicros: { type: Number, min: 0, default: null },
  totalRewardGram: { type: Number, min: 0, default: null },
  dailyRewardAverageGram: { type: Number, min: 0, default: null },
  startAt: { type: Date, required: true },
  endAt: { type: Date, required: true },
  claimsCompleted: { type: Number, default: 0, min: 0 },
  claimedRewardPoints: { type: Number, min: 0, default: 0 },
  claimedRewardGram: { type: Number, min: 0, default: 0 },
  lastClaimAt: { type: Date, default: null },
  status: { type: String, enum: ['active', 'completed', 'cancelled'], default: 'active', index: true },
  principalReturnedAt: { type: Date, default: null }
}, { timestamps: true });
vipSubscriptionSchema.index({ user: 1, status: 1, createdAt: -1 });
vipSubscriptionSchema.index({ status: 1, endAt: 1, principalReturnedAt: 1 });
module.exports = mongoose.model('VipSubscription', vipSubscriptionSchema);
