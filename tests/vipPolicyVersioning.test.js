'use strict';
const assert = require('assert');
const fs = require('fs');
const {
  LEGACY_VIP_POLICY_VERSION,
  NEW_VIP_POLICY_VERSION,
  NEW_VIP_DURATION_DAYS,
  groupForPlan,
  newVipPolicyForPlan,
  policyForSubscription,
  dailyPointsCentsFromBps
} = require('../utils/vipPolicy');
const VipPlan = require('../models/VipPlan');
const VipSubscription = require('../models/VipSubscription');

assert.strictEqual(groupForPlan(1), 'start');
assert.strictEqual(groupForPlan(3), 'start');
assert.strictEqual(groupForPlan(4), 'professional');
assert.strictEqual(groupForPlan(7), 'professional');
assert.strictEqual(groupForPlan(8), 'final');
assert.strictEqual(groupForPlan(10), 'final');
assert.strictEqual(groupForPlan(11), null);

const policy = newVipPolicyForPlan(1, new Date('2026-10-27T00:00:00Z'));
assert.deepStrictEqual({
  policyVersion: policy.policyVersion,
  productGroup: policy.productGroup,
  durationDays: policy.durationDays,
  principalDailyBps: policy.principalDailyBps,
  rewardDailyBps: policy.rewardDailyBps
}, {
  policyVersion: NEW_VIP_POLICY_VERSION,
  productGroup: 'start',
  durationDays: NEW_VIP_DURATION_DAYS,
  principalDailyBps: 100,
  rewardDailyBps: 10
});
assert.strictEqual(dailyPointsCentsFromBps(1000, 100), 1000, '1% of 1000 Points = 10.00 Points, stored as cents');
assert.strictEqual(dailyPointsCentsFromBps(1000, 10), 100, '0.10% of 1000 Points = 1.00 Point, stored as cents');
assert.strictEqual(policyForSubscription({ durationDays: 30 }).policyVersion, LEGACY_VIP_POLICY_VERSION);
assert.strictEqual(VipPlan.schema.path('policyVersion').defaultValue, LEGACY_VIP_POLICY_VERSION);
assert.strictEqual(VipSubscription.schema.path('policyVersion').defaultValue, LEGACY_VIP_POLICY_VERSION);

const points = fs.readFileSync('routes/points.js', 'utf8');
assert.ok(points.includes('VIP_NEW_POLICY_NOT_ACTIVE'));
assert.ok(points.includes('policyEffectiveAt'));
assert.ok(points.includes('principalDailyBps'));
assert.ok(points.includes('rewardDailyBps'));
assert.ok(points.includes('policyVersion'));
const settings = fs.readFileSync('models/Settings.js', 'utf8');
assert.ok(settings.includes('vipNewPurchasesEnabled: { type: Boolean, default: false }'));
assert.ok(settings.includes("vipPolicyVersion: { type: String, enum: ['legacy_v1', 'v2_100d']"));
console.log('PASS — VIP legacy compatibility, policy snapshots, grouped v2 rates, and disabled-by-default gate');
