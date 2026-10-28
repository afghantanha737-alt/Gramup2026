'use strict';

const mongoose = require('mongoose');
const { NEW_VIP_POLICY_VERSION } = require('../utils/vipPolicy');
const { pricePointsForVipPlan } = require('../utils/vipPricing');

const vipPlanSchema = new mongoose.Schema({
  planNumber: { type: Number, required: true, min: 1, max: 10, unique: true, index: true },
  pricePoints: { type: Number, required: true, min: 0, max: 100000000 },
  monthlyRewardPercent: { type: Number, required: true, min: 0, max: 100 },
  durationDays: { type: Number, required: true, min: 1, max: 3650 },
  policyVersion: { type: String, enum: ['legacy_v1', 'v2_100d'], default: NEW_VIP_POLICY_VERSION, index: true },
  productGroup: { type: String, enum: ['legacy', 'start', 'professional', 'final'], default: 'legacy' },
  principalDailyBps: { type: Number, min: 0, max: 10000, default: 0 },
  rewardDailyBps: { type: Number, min: 0, max: 10000, default: 0 },
  enabled: { type: Boolean, default: false, index: true },
  comingSoon: { type: Boolean, default: true }
}, { timestamps: true });

vipPlanSchema.index({ enabled: 1, comingSoon: 1, planNumber: 1 });

const DEFAULT_VIP_PLANS = [
  { planNumber: 1, pricePoints: pricePointsForVipPlan(1), monthlyRewardPercent: 5, durationDays: 100, policyVersion: 'v2_100d', productGroup: 'start', principalDailyBps: 100, rewardDailyBps: 10, enabled: true, comingSoon: false },
  { planNumber: 2, pricePoints: pricePointsForVipPlan(2), monthlyRewardPercent: 6, durationDays: 100, policyVersion: 'v2_100d', productGroup: 'start', principalDailyBps: 100, rewardDailyBps: 10, enabled: true, comingSoon: false },
  { planNumber: 3, pricePoints: pricePointsForVipPlan(3), monthlyRewardPercent: 7, durationDays: 100, policyVersion: 'v2_100d', productGroup: 'start', principalDailyBps: 100, rewardDailyBps: 10, enabled: true, comingSoon: false },
  { planNumber: 4, pricePoints: pricePointsForVipPlan(4), monthlyRewardPercent: 8, durationDays: 100, policyVersion: 'v2_100d', productGroup: 'professional', principalDailyBps: 100, rewardDailyBps: 15, enabled: false, comingSoon: true },
  { planNumber: 5, pricePoints: pricePointsForVipPlan(5), monthlyRewardPercent: 9, durationDays: 100, policyVersion: 'v2_100d', productGroup: 'professional', principalDailyBps: 100, rewardDailyBps: 15, enabled: false, comingSoon: true },
  { planNumber: 6, pricePoints: pricePointsForVipPlan(6), monthlyRewardPercent: 10, durationDays: 100, policyVersion: 'v2_100d', productGroup: 'professional', principalDailyBps: 100, rewardDailyBps: 15, enabled: false, comingSoon: true },
  { planNumber: 7, pricePoints: pricePointsForVipPlan(7), monthlyRewardPercent: 11, durationDays: 100, policyVersion: 'v2_100d', productGroup: 'professional', principalDailyBps: 100, rewardDailyBps: 15, enabled: false, comingSoon: true },
  { planNumber: 8, pricePoints: pricePointsForVipPlan(8), monthlyRewardPercent: 12, durationDays: 100, policyVersion: 'v2_100d', productGroup: 'final', principalDailyBps: 100, rewardDailyBps: 20, enabled: false, comingSoon: true },
  { planNumber: 9, pricePoints: pricePointsForVipPlan(9), monthlyRewardPercent: 13, durationDays: 100, policyVersion: 'v2_100d', productGroup: 'final', principalDailyBps: 100, rewardDailyBps: 20, enabled: false, comingSoon: true },
  { planNumber: 10, pricePoints: pricePointsForVipPlan(10), monthlyRewardPercent: 15, durationDays: 100, policyVersion: 'v2_100d', productGroup: 'final', principalDailyBps: 100, rewardDailyBps: 20, enabled: false, comingSoon: true }
];

vipPlanSchema.statics.ensureDefaults = async function ensureDefaults() {
  await this.bulkWrite(DEFAULT_VIP_PLANS.map(plan => ({
    updateOne: {
      filter: { planNumber: plan.planNumber },
      update: { $setOnInsert: plan },
      upsert: true
    }
  })), { ordered: true });
};

module.exports = mongoose.model('VipPlan', vipPlanSchema);
