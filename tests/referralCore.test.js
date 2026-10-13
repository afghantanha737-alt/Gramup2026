'use strict';
const assert = require('assert');
const {
  DEFAULT_REFERRAL_LEVEL_RATES,
  DEFAULT_REFERRAL_INITIAL_REWARD_POINTS,
  normalizeReferralRates,
  isEligibleOriginalEarn,
  calculateReferralCommission,
  reviewStatusOf
} = require('../utils/referralCore');

const expectedRates = [10, 5, 3, 1, 1, 1, 1, 1, 1, 1];
assert.deepStrictEqual(normalizeReferralRates(undefined), expectedRates);
assert.deepStrictEqual(DEFAULT_REFERRAL_LEVEL_RATES, expectedRates);
assert.strictEqual(DEFAULT_REFERRAL_INITIAL_REWARD_POINTS, 10);
assert.deepStrictEqual(normalizeReferralRates([10, 5, 3, 1]), expectedRates);
assert.deepStrictEqual(normalizeReferralRates([10, 5, 3, 1, 1, 1, 1, 1, 1, 1]), expectedRates);
assert.deepStrictEqual(normalizeReferralRates([10, 5, 3, 2]), expectedRates, 'shipped legacy default maps to new fixed rates');
assert.throws(() => normalizeReferralRates([80, 30]), /fixed at 10%/);
assert.throws(() => normalizeReferralRates([10, -1]), /between 0 and 100/);
assert.throws(() => normalizeReferralRates([10, 5, 3, 1, 2]), /fixed at 1%/);
assert.strictEqual(isEligibleOriginalEarn({ type: 'task', currency: 'points', amount: 100 }), true);
assert.strictEqual(isEligibleOriginalEarn({ type: 'spin', amount: 25 }), false);
for (const type of ['referral_bonus', 'referral_initial', 'referral_commission', 'exchange_in', 'admin_adjust']) {
  assert.strictEqual(isEligibleOriginalEarn({ type, amount: 100 }), false, `${type} must not produce commissions`);
}
assert.strictEqual(isEligibleOriginalEarn({ type: 'task', currency: 'gram', amount: 100 }), false);
assert.strictEqual(isEligibleOriginalEarn({ type: 'task', amount: -10 }), false);
assert.strictEqual(calculateReferralCommission(100, 10), 10);
assert.strictEqual(calculateReferralCommission(100, 5), 5);
assert.strictEqual(calculateReferralCommission(100, 3), 3);
assert.strictEqual(calculateReferralCommission(100, 1), 1, 'Level 4+ earns one Point from a 100-Point source');
assert.strictEqual(calculateReferralCommission(99, 1), 0, 'fractional Points are rounded down');
assert.strictEqual(reviewStatusOf({ accountReviewStatus: 'normal' }), 'active');
assert.strictEqual(reviewStatusOf({ accountReviewStatus: 'under_review' }), 'under_review');
assert.strictEqual(reviewStatusOf({ referralRiskScore: 50 }), 'blocked');
assert.strictEqual(reviewStatusOf({ isBanned: true }), 'blocked');
console.log('ALL PASS — referral core policies, fixed commission math and legacy-rate compatibility');
