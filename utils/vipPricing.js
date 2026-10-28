'use strict';

// Official catalog ladder expressed in GRAM. The first three plans are the
// Starter tier (1–5 GRAM); plans 4–7 are the proportional Professional tier;
// plans 8–10 finish the ladder at VIP 10 = 100 GRAM.
const VIP_PRICE_GRAMS = Object.freeze([1, 3, 5, 10, 20, 35, 50, 70, 85, 100]);

function gramsForVipPlan(planNumber) {
  const number = Number(planNumber);
  if (!Number.isInteger(number) || number < 1 || number > VIP_PRICE_GRAMS.length) return null;
  return VIP_PRICE_GRAMS[number - 1];
}

function pointsForGrams(grams, rate) {
  const value = Number(grams);
  const conversionRate = Number(rate);
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(conversionRate) || conversionRate <= 0) return null;
  const points = Math.round(value / conversionRate);
  return Number.isSafeInteger(points) && points > 0 ? points : null;
}

function pricePointsForVipPlan(planNumber, rate) {
  const grams = gramsForVipPlan(planNumber);
  return grams == null ? null : pointsForGrams(grams, rate);
}

function pricingForVipPlan(planNumber, rate) {
  const grams = gramsForVipPlan(planNumber);
  const pricePoints = grams == null ? null : pointsForGrams(grams, rate);
  return grams == null || pricePoints == null ? null : { planNumber: Number(planNumber), grams, pricePoints };
}

module.exports = {
  VIP_PRICE_GRAMS,
  gramsForVipPlan,
  pointsForGrams,
  pricePointsForVipPlan,
  pricingForVipPlan
};
