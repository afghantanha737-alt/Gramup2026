'use strict';

const mongoose = require('mongoose');
const { VIP0_POLICY_VERSION, NEW_VIP_POLICY_VERSION, periodRewardPercentForPlan } = require('../utils/vipPolicy');
const { pricePointsForVipPlan } = require('../utils/vipPricing');

const vipPlanSchema = new mongoose.Schema({
  planNumber: { type: Number, required: true, min: 0, max: 10, unique: true, index: true },
  pricePoints: { type: Number, required: true, min: 0, max: 100000000 },
  monthlyRewardPercent: { type: Number, required: true, min: 0, max: 100 },
  durationDays: { type: Number, required: true, min: 1, max: 3650 },
  policyVersion: { type: String, enum: ['legacy_v1', 'v2_100d', VIP0_POLICY_VERSION], default: NEW_VIP_POLICY_VERSION, index: true },
  productGroup: { type: String, enum: ['legacy', 'start', 'professional', 'final', 'free'], default: 'legacy' },
  dailyMiningRatePoints: { type: Number, min: 0, max: 1000, default: null },
  principalDailyBps: { type: Number, min: 0, max: 10000, default: 0 },
  rewardDailyBps: { type: Number, min: 0, max: 10000, default: 0 },
  enabled: { type: Boolean, default: false, index: true },
  comingSoon: { type: Boolean, default: true }
}, { timestamps: true });

vipPlanSchema.index({ enabled: 1, comingSoon: 1, planNumber: 1 });

const DEFAULT_VIP_PLANS = [
  { planNumber: 0, pricePoints: 0, monthlyRewardPercent: 0, durationDays: 100, policyVersion: VIP0_POLICY_VERSION, productGroup: 'free', dailyMiningRatePoints: 10, enabled: true, comingSoon: false },
  { planNumber: 1, pricePoints: pricePointsForVipPlan(1), monthlyRewardPercent: 10, durationDays: 100, policyVersion: 'v2_100d', productGroup: 'start', principalDailyBps: 100, rewardDailyBps: 10, enabled: true, comingSoon: false },
  { planNumber: 2, pricePoints: pricePointsForVipPlan(2), monthlyRewardPercent: 10, durationDays: 100, policyVersion: 'v2_100d', productGroup: 'start', principalDailyBps: 100, rewardDailyBps: 10, enabled: true, comingSoon: false },
  { planNumber: 3, pricePoints: pricePointsForVipPlan(3), monthlyRewardPercent: 10, durationDays: 100, policyVersion: 'v2_100d', productGroup: 'start', principalDailyBps: 100, rewardDailyBps: 10, enabled: true, comingSoon: false },
  { planNumber: 4, pricePoints: pricePointsForVipPlan(4), monthlyRewardPercent: periodRewardPercentForPlan(4), durationDays: 100, policyVersion: 'v2_100d', productGroup: 'professional', principalDailyBps: 100, rewardDailyBps: 15, enabled: false, comingSoon: true },
  { planNumber: 5, pricePoints: pricePointsForVipPlan(5), monthlyRewardPercent: periodRewardPercentForPlan(5), durationDays: 100, policyVersion: 'v2_100d', productGroup: 'professional', principalDailyBps: 100, rewardDailyBps: 15, enabled: false, comingSoon: true },
  { planNumber: 6, pricePoints: pricePointsForVipPlan(6), monthlyRewardPercent: periodRewardPercentForPlan(6), durationDays: 100, policyVersion: 'v2_100d', productGroup: 'professional', principalDailyBps: 100, rewardDailyBps: 15, enabled: false, comingSoon: true },
  { planNumber: 7, pricePoints: pricePointsForVipPlan(7), monthlyRewardPercent: periodRewardPercentForPlan(7), durationDays: 100, policyVersion: 'v2_100d', productGroup: 'professional', principalDailyBps: 100, rewardDailyBps: 15, enabled: false, comingSoon: true },
  { planNumber: 8, pricePoints: pricePointsForVipPlan(8), monthlyRewardPercent: periodRewardPercentForPlan(8), durationDays: 100, policyVersion: 'v2_100d', productGroup: 'final', principalDailyBps: 100, rewardDailyBps: 20, enabled: false, comingSoon: true },
  { planNumber: 9, pricePoints: pricePointsForVipPlan(9), monthlyRewardPercent: periodRewardPercentForPlan(9), durationDays: 100, policyVersion: 'v2_100d', productGroup: 'final', principalDailyBps: 100, rewardDailyBps: 20, enabled: false, comingSoon: true },
  { planNumber: 10, pricePoints: pricePointsForVipPlan(10), monthlyRewardPercent: periodRewardPercentForPlan(10), durationDays: 100, policyVersion: 'v2_100d', productGroup: 'final', principalDailyBps: 100, rewardDailyBps: 20, enabled: false, comingSoon: true }
];

vipPlanSchema.statics.ensureDefaults = async function ensureDefaults() {
  // Seed missing catalog entries first, then reconcile only published catalog
  // policy fields. Admin-controlled enabled/comingSoon flags are deliberately
  // preserved, and user subscription snapshots are never rewritten here.
  const { withMongoTransaction } = require('../utils/mongoTransaction');
  await withMongoTransaction(async session => {
    await this.bulkWrite(DEFAULT_VIP_PLANS.map(plan => ({
      updateOne: {
        filter: { planNumber: plan.planNumber },
        update: { $setOnInsert: plan },
        upsert: true
      }
    })), { ordered: true, session });
    // VIP 0's duration and daily rate are admin-managed settings. Only seed it
    // on insert; unlike paid-plan policy constants, never reset it at startup.
    await this.bulkWrite(DEFAULT_VIP_PLANS.filter(plan => plan.planNumber >= 1).map(plan => {
      const { planNumber, pricePoints, monthlyRewardPercent, durationDays, policyVersion, productGroup, principalDailyBps, rewardDailyBps } = plan;
      return {
        updateOne: {
          filter: { planNumber },
          update: { $set: { pricePoints, monthlyRewardPercent, durationDays, policyVersion, productGroup, principalDailyBps, rewardDailyBps } }
        }
      };
    }), { ordered: true, session });
  });
};

module.exports = mongoose.model('VipPlan', vipPlanSchema);
