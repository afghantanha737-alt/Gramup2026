'use strict';
const mongoose = require('mongoose');
const LINEAR_MIN_GRAM = 1;
const LINEAR_MAX_GRAM = 50;
function defaultPriceGram(planNumber) {
  return Number((LINEAR_MIN_GRAM + (Number(planNumber) - 1) * (LINEAR_MAX_GRAM - LINEAR_MIN_GRAM) / 9).toFixed(6));
}
const vipPlanSchema = new mongoose.Schema({
  planNumber: { type: Number, required: true, min: 1, max: 10, unique: true, index: true },
  pricePoints: { type: Number, min: 0, default: null },
  priceGram: { type: Number, min: 0.000001, max: 100000000, default: null },
  pricingCurrency: { type: String, enum: ['points', 'gram'], default: 'gram' },
  monthlyRewardPercent: { type: Number, required: true, min: 0, max: 100 },
  durationDays: { type: Number, required: true, min: 1, max: 3650 },
  enabled: { type: Boolean, default: false, index: true },
  comingSoon: { type: Boolean, default: true },
  catalogVersion: { type: Number, default: 2 }
}, { timestamps: true });
vipPlanSchema.index({ enabled: 1, comingSoon: 1, planNumber: 1 });
const DEFAULT_VIP_PLANS = [
  // Legacy catalog reference retained for migration/audit: planNumber: 1, pricePoints: 1000, monthlyRewardPercent: 5; planNumber: 10, pricePoints: 100000, monthlyRewardPercent: 15.
  { planNumber: 1, priceGram: 1, monthlyRewardPercent: 5, durationDays: 100, enabled: true, comingSoon: false },
  { planNumber: 2, priceGram: defaultPriceGram(2), monthlyRewardPercent: 6, durationDays: 100, enabled: true, comingSoon: false },
  { planNumber: 3, priceGram: defaultPriceGram(3), monthlyRewardPercent: 7, durationDays: 100, enabled: true, comingSoon: false },
  { planNumber: 4, priceGram: defaultPriceGram(4), monthlyRewardPercent: 8, durationDays: 100, enabled: true, comingSoon: false },
  { planNumber: 5, priceGram: defaultPriceGram(5), monthlyRewardPercent: 9, durationDays: 100, enabled: true, comingSoon: false },
  { planNumber: 6, priceGram: defaultPriceGram(6), monthlyRewardPercent: 10, durationDays: 100, enabled: true, comingSoon: false },
  { planNumber: 7, priceGram: defaultPriceGram(7), monthlyRewardPercent: 11, durationDays: 100, enabled: true, comingSoon: false },
  { planNumber: 8, priceGram: defaultPriceGram(8), monthlyRewardPercent: 12, durationDays: 100, enabled: true, comingSoon: false },
  { planNumber: 9, priceGram: defaultPriceGram(9), monthlyRewardPercent: 13, durationDays: 100, enabled: true, comingSoon: false },
  { planNumber: 10, priceGram: 50, monthlyRewardPercent: 15, durationDays: 100, enabled: true, comingSoon: false }
];
vipPlanSchema.statics.ensureDefaults = async function ensureDefaults() {
  for (const plan of DEFAULT_VIP_PLANS) {
    await this.updateOne(
      { planNumber: plan.planNumber, priceGram: { $exists: false } },
      {
        $set: { ...plan, pricingCurrency: 'gram' },
        $setOnInsert: { catalogVersion: 2 }
      },
      { upsert: true }
    );
  }
};
vipPlanSchema.statics.defaultPriceGram = defaultPriceGram;
module.exports = mongoose.model('VipPlan', vipPlanSchema);
