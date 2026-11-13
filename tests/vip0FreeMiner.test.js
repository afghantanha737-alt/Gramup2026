'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const VipPlan = require('../models/VipPlan');
const VipSubscription = require('../models/VipSubscription');
const User = require('../models/User');
const PointsLedger = require('../models/PointsLedger');
const Transaction = require('../models/Transaction');
const { VIP0_POLICY_VERSION } = require('../utils/vipPolicy');
const { getVipMiningDailyRatePoints, calculateVipSubscriptionAccrual, calculateVipMiningStatus } = require('../utils/vipMining');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const pointsRoute = read('routes/points.js');
const adminRoute = read('routes/admin.js');
const adminUi = read('public/admin.html');
const app = read('public/js/app.js');
const i18n = read('public/js/i18n.js');
const index = read('public/index.html');
const planModel = read('models/VipPlan.js');
const settlement = read('utils/vipSettlement.js');

assert.equal(VIP0_POLICY_VERSION, 'vip0_free_v1');
assert.match(planModel, /planNumber: 0, pricePoints: 0, monthlyRewardPercent: 0, durationDays: 100/);
assert.match(planModel, /dailyMiningRatePoints: 10, enabled: true, comingSoon: false/);
assert.match(planModel, /filter\(plan => plan\.planNumber >= 1\)/,
  'startup reconciliation must not overwrite admin-managed VIP0 duration/rate settings');

const plan = new VipPlan({
  planNumber: 0,
  pricePoints: 0,
  monthlyRewardPercent: 0,
  durationDays: 100,
  policyVersion: VIP0_POLICY_VERSION,
  productGroup: 'free',
  dailyMiningRatePoints: 10,
  enabled: true,
  comingSoon: false
});
assert.equal(plan.validateSync(), undefined, 'VIP0 is valid at zero cost with a daily mining rate');

const startAt = new Date(1_800_000_000_000);
const endAt = new Date(startAt.getTime() + 100 * 86_400_000);
const subscriptionData = {
  user: new mongoose.Types.ObjectId(),
  planNumber: 0,
  pricePoints: 0,
  monthlyRewardPercent: 0,
  durationDays: 100,
  policyVersion: VIP0_POLICY_VERSION,
  productGroup: 'free',
  principalDailyBps: 0,
  rewardDailyBps: 0,
  reserveLiabilityCents: 0,
  reservePaidCents: 0,
  totalRewardCents: 100_000,
  totalRewardPoints: 1000,
  dailyRewardAveragePoints: 10,
  startAt,
  endAt,
  status: 'active'
};
const subscription = new VipSubscription(subscriptionData);
assert.equal(subscription.validateSync(), undefined, 'VIP0 subscription is valid with a zero price');
assert.equal(getVipMiningDailyRatePoints(subscriptionData), 10);
const firstDay = calculateVipSubscriptionAccrual(subscriptionData, new Date(startAt.getTime() + 86_400_000));
assert.equal(firstDay.earnedPoints, 10, 'VIP0 accrues 10 UP for the first full day');
const liveMining = calculateVipMiningStatus([subscriptionData], new Date(startAt.getTime() + 86_400_000));
assert.equal(liveMining.activeMinerCount, 1);
assert.equal(liveMining.dailyRate, 10);
const matured = calculateVipSubscriptionAccrual(subscriptionData, new Date(endAt.getTime() + 86_400_000));
assert.equal(matured.earnedPoints, 1000, 'the full fixed liability remains claimable at maturity');

assert.equal(User.schema.path('vip0Claimed').instance, 'Boolean');
assert.equal(User.schema.path('vip0ClaimedAt').instance, 'Date');
assert.ok(PointsLedger.schema.path('type').enumValues.includes('vip_free_claim'));
assert.ok(Transaction.TRANSACTION_TYPES.includes('vip_free_claim'));
assert.ok(VipSubscription.schema.indexes().some(([keys, options]) =>
  keys.user === 1 && keys.planNumber === 1 && options.unique === true
  && options.partialFilterExpression?.planNumber === 0),
  'a partial unique index provides a second account-level VIP0 subscription guard');

const claimStart = pointsRoute.indexOf("router.post('/vip/free/claim'");
const claimEnd = pointsRoute.indexOf("router.post('/vip/purchase'", claimStart);
assert.ok(claimStart >= 0 && claimEnd > claimStart, 'VIP0 has a separate free-claim endpoint');
const claimRoute = pointsRoute.slice(claimStart, claimEnd);
assert.match(claimRoute, /executeIdempotently/);
assert.match(claimRoute, /scope: 'vip0_claim'/);
assert.match(claimRoute, /vip0Claimed: \{ \$ne: true \}/,
  'distinct concurrent requests must serialize on the atomic user-row claim flag');
assert.match(claimRoute, /plan\.policyVersion !== VIP0_POLICY_VERSION/);
assert.match(claimRoute, /type: 'vip_free_claim'/);
assert.match(claimRoute, /planNumber: 0/);
assert.doesNotMatch(claimRoute, /reserveForSubscription|vipActivationTaskDefinition|\$inc:\s*\{\s*points:\s*-/,
  'free activation must not debit points, reserve a paid-plan liability, or award a paid-plan task bonus');
assert.match(claimRoute, /totalRewardCents/);
assert.match(claimRoute, /VIP0_ALREADY_CLAIMED/);

assert.match(pointsRoute, /vip0Claimed: Boolean\(user\?\.vip0Claimed\)/);
assert.match(pointsRoute, /dailyMiningRatePoints: isFreeVip0 \? miningDailyRate : null/);
assert.match(adminRoute, /input\.length !== 11/);
assert.match(adminRoute, /VIP0_POLICY_VERSION/);
assert.match(adminRoute, /dailyMiningRatePoints/);
assert.match(adminRoute, /parsed < 0 \|\| parsed > 10/);
assert.match(adminUi, /vipPlanEnabled0/);
assert.match(adminUi, /vipPlanDailyRate0/);
assert.match(adminUi, /vipPlanDays0/);
assert.match(adminUi, /VIP 0 · Free Welcome Miner/);
assert.match(adminUi, /Plan 0 · Free/);

assert.match(settlement, /policyVersion: VIP0_POLICY_VERSION/);
assert.match(settlement, /\$set: \{ status: 'completed' \}/,
  'matured free contracts close without invoking paid-plan principal return');
assert.match(app, /\.sort\(\(left, right\) => Number\(left\.planNumber\) - Number\(right\.planNumber\)\)/,
  'VIP0 renders before VIP1 in its category');
assert.match(app, /activateVip0FreePlan\(\)/);
assert.match(app, /\/api\/points\/vip\/free\/claim/);
assert.match(app, /vip0_active_remaining/);
assert.match(app, /state\.vip0Claimed = data\?\.vip0Claimed === true/);

for (const key of [
  'vip0_free', 'vip0_activate', 'vip0_activating', 'vip0_active_remaining', 'vip0_claimed',
  'vip0_unavailable', 'vip0_daily_rate_label', 'vip0_total_mining_label', 'vip0_activation_success',
  'history_type_vip_free_claim'
]) {
  assert.equal((i18n.match(new RegExp(`${key}:`, 'g')) || []).length, 3,
    `${key} must be translated for Dari, Pashto, and English`);
}
for (const code of ['VIP0_ALREADY_CLAIMED', 'VIP0_UNAVAILABLE', 'VIP0_CONFIG_INVALID']) {
  assert.equal((i18n.match(new RegExp(`${code}:`, 'g')) || []).length, 1,
    `${code} must have a shared map entry for all supported locales`);
  assert.match(i18n, new RegExp(`${code}: \\{ fa: [^,]+, ps: [^,]+, en:`));
}
assert.match(i18n, /vip0_free: "رایگان"/);
assert.match(i18n, /vip0_free: "وړیا"/);
assert.match(i18n, /vip0_activate: "Activate Free"/);
assert.match(index, /i18n\.js\?v=mining_6h_20261112_1/);
assert.match(index, /app\.js\?v=mining_6h_live_20261112_2/);

console.log('PASS — VIP0 free miner has validated terms, atomic one-time claim protections, 10 UP/day accrual, localized UI/admin controls, and expiry handling');
