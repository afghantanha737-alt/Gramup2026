'use strict';

const mongoose = require('mongoose');
const { LEGACY_VIP_POLICY_VERSION } = require('../utils/vipPolicy');

const vipSubscriptionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  planNumber: { type: Number, required: true, min: 1, max: 10 },
  pricePoints: { type: Number, required: true, min: 1 },
  monthlyRewardPercent: { type: Number, required: true, min: 0, max: 100 },
  durationDays: { type: Number, required: true, min: 1, max: 3650 },
  // Missing values on historical documents intentionally resolve to legacy_v1.
  policyVersion: { type: String, enum: ['legacy_v1', 'v2_100d'], default: LEGACY_VIP_POLICY_VERSION, index: true },
  policyEffectiveAt: { type: Date, default: null },
  productGroup: { type: String, enum: ['legacy', 'start', 'professional', 'final'], default: 'legacy' },
  principalDailyBps: { type: Number, min: 0, max: 10000, default: 0 },
  rewardDailyBps: { type: Number, min: 0, max: 10000, default: 0 },
  principalPaidDays: { type: Number, default: 0, min: 0 },
  principalPaidPoints: { type: Number, default: 0, min: 0 },
  lastPrincipalPaidAt: { type: Date, default: null },
  totalRewardCents: { type: Number, required: true, min: 0 },
  totalRewardPoints: { type: Number, required: true, min: 0 },
  dailyRewardAveragePoints: { type: Number, required: true, min: 0 },
  startAt: { type: Date, required: true },
  endAt: { type: Date, required: true },
  claimsCompleted: { type: Number, default: 0, min: 0 },
  claimedRewardPoints: { type: Number, default: 0, min: 0 },
  lastClaimAt: { type: Date, default: null },
  status: { type: String, enum: ['active', 'completed', 'cancelled'], default: 'active', index: true },
  principalReturnedAt: { type: Date, default: null }
}, { timestamps: true });

vipSubscriptionSchema.index({ user: 1, status: 1, createdAt: -1 });
vipSubscriptionSchema.index({ status: 1, endAt: 1, principalReturnedAt: 1 });

module.exports = mongoose.model('VipSubscription', vipSubscriptionSchema);
