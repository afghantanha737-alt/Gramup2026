'use strict';
// VIP prices are the published, fixed Points values; they do not float with
// the configurable GRAM conversion rate. GRAM equivalents are display metadata.
const VIP_PRICE_GRAMS = Object.freeze([1, 3, 5, 10, 20, 35, 50, 70, 85, 100]);
const VIP_PRICE_POINTS = Object.freeze([10000, 30000, 50000, 100000, 200000, 350000, 500000, 700000, 850000, 1000000]);
function catalogIndex(planNumber) {
  const number = Number(planNumber);
  return Number.isInteger(number) && number >= 1 && number <= VIP_PRICE_POINTS.length ? number - 1 : -1;
}
function gramsForVipPlan(planNumber) {
  const index = catalogIndex(planNumber);
  return index < 0 ? null : VIP_PRICE_GRAMS[index];
}
function pricePointsForVipPlan(planNumber) {
  const index = catalogIndex(planNumber);
  return index < 0 ? null : VIP_PRICE_POINTS[index];
}
function pricingForVipPlan(planNumber) {
  const index = catalogIndex(planNumber);
  return index < 0 ? null : {
    planNumber: Number(planNumber),
    grams: VIP_PRICE_GRAMS[index],
    pricePoints: VIP_PRICE_POINTS[index]
  };
}
module.exports = {
  VIP_PRICE_GRAMS,
  VIP_PRICE_POINTS,
  gramsForVipPlan,
  pricePointsForVipPlan,
  pricingForVipPlan
};
