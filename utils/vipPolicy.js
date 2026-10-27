'use strict';

const LEGACY_VIP_POLICY_VERSION = 'legacy_v1';
const NEW_VIP_POLICY_VERSION = 'v2_100d';
const NEW_VIP_DURATION_DAYS = 100;
const NEW_VIP_GROUPS = Object.freeze({
  start: Object.freeze({ minPlan: 1, maxPlan: 3, rewardDailyBps: 10, principalDailyBps: 100 }),
  professional: Object.freeze({ minPlan: 4, maxPlan: 7, rewardDailyBps: 15, principalDailyBps: 100 }),
  final: Object.freeze({ minPlan: 8, maxPlan: 10, rewardDailyBps: 20, principalDailyBps: 100 })
});

function groupForPlan(planNumber) {
  const number = Number(planNumber);
  return Object.entries(NEW_VIP_GROUPS).find(([, group]) => number >= group.minPlan && number <= group.maxPlan)?.[0] || null;
}

function newVipPolicyForPlan(planNumber, effectiveAt = null) {
  const group = groupForPlan(planNumber);
  if (!group) return null;
  const config = NEW_VIP_GROUPS[group];
  return {
    policyVersion: NEW_VIP_POLICY_VERSION,
    policyEffectiveAt: effectiveAt ? new Date(effectiveAt) : null,
    productGroup: group,
    durationDays: NEW_VIP_DURATION_DAYS,
    principalDailyBps: config.principalDailyBps,
    rewardDailyBps: config.rewardDailyBps
  };
}

function policyForSubscription(subscription) {
  const version = String(subscription?.policyVersion || LEGACY_VIP_POLICY_VERSION);
  if (version !== NEW_VIP_POLICY_VERSION) {
    return { policyVersion: LEGACY_VIP_POLICY_VERSION, productGroup: 'legacy', durationDays: Number(subscription?.durationDays) || 0 };
  }
  return {
    policyVersion: NEW_VIP_POLICY_VERSION,
    productGroup: String(subscription.productGroup || ''),
    durationDays: Number(subscription.durationDays) || NEW_VIP_DURATION_DAYS,
    principalDailyBps: Number(subscription.principalDailyBps) || 100,
    rewardDailyBps: Number(subscription.rewardDailyBps) || 0
  };
}

function dailyPointsCentsFromBps(pricePoints, bps) {
  const priceCents = Math.round(Number(pricePoints) * 100);
  const rate = Number(bps);
  if (!Number.isSafeInteger(priceCents) || priceCents < 0 || !Number.isFinite(rate) || rate < 0) return null;
  return Math.round(priceCents * rate / 10000);
}

module.exports = {
  LEGACY_VIP_POLICY_VERSION,
  NEW_VIP_POLICY_VERSION,
  NEW_VIP_DURATION_DAYS,
  NEW_VIP_GROUPS,
  groupForPlan,
  newVipPolicyForPlan,
  policyForSubscription,
  dailyPointsCentsFromBps
};
