'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  DAY_MS,
  calculateTotalRewardCents,
  dailyRewardCents,
  pointsFromCents,
  calculateDaysRemaining,
  calculateDaysCompleted
} = require('../utils/vipRewards');
const { VIP_PRICE_GRAMS, VIP_PRICE_POINTS, pricePointsForVipPlan } = require('../utils/vipPricing');
const { newVipPolicyForPlan, dailyPointsCentsFromBps, periodRewardPercentForPlan } = require('../utils/vipPolicy');

function sum(values) { return values.reduce((total, value) => total + value, 0); }

const plans = [
  { planNumber: 1, price: 1000, monthlyRate: 5, days: 30, expectedTotal: 5000 },
  { planNumber: 2, price: 2000, monthlyRate: 6, days: 30, expectedTotal: 12000 },
  { planNumber: 3, price: 3000, monthlyRate: 7, days: 30, expectedTotal: 21000 },
  { planNumber: 4, price: 5000, monthlyRate: 8, days: 30, expectedTotal: 40000 },
  { planNumber: 5, price: 10000, monthlyRate: 9, days: 30, expectedTotal: 90000 },
  { planNumber: 6, price: 20000, monthlyRate: 10, days: 30, expectedTotal: 200000 },
  { planNumber: 7, price: 35000, monthlyRate: 11, days: 30, expectedTotal: 385000 },
  { planNumber: 8, price: 50000, monthlyRate: 12, days: 30, expectedTotal: 600000 },
  { planNumber: 9, price: 75000, monthlyRate: 13, days: 30, expectedTotal: 975000 },
  { planNumber: 10, price: 100000, monthlyRate: 15, days: 30, expectedTotal: 1500000 }
];
for (const plan of plans) {
  const totalCents = calculateTotalRewardCents(plan.price, plan.monthlyRate, plan.days);
  assert.strictEqual(totalCents, plan.expectedTotal, `VIP ${plan.planNumber} total reward cents`);
  const daily = Array.from({ length: plan.days }, (_, index) => dailyRewardCents(totalCents, plan.days, index));
  assert.strictEqual(daily.length, 30);
  assert.ok(daily.every(value => value >= 1), 'each daily claim must pay at least one cent');
  assert.strictEqual(sum(daily), totalCents, 'daily rounding must never overpay or underpay total reward');
}
assert.strictEqual(pointsFromCents(167), 1.67);
assert.strictEqual(pointsFromCents(5000), 50);
assert.strictEqual(calculateTotalRewardCents(1000, 5, 30), 5000);
assert.strictEqual(calculateTotalRewardCents(1000, 0, 30), null);
assert.strictEqual(calculateTotalRewardCents(0, 5, 30), null);
assert.strictEqual(dailyRewardCents(5000, 30, 30), null);
assert.strictEqual(dailyRewardCents(5000, 30, -1), null);
assert.strictEqual(calculateDaysRemaining(new Date(3 * DAY_MS), new Date(0)), 3);
assert.strictEqual(calculateDaysRemaining(new Date(2.5 * DAY_MS), new Date(0)), 3);
assert.strictEqual(calculateDaysCompleted(new Date(0), 30, new Date(2.9 * DAY_MS)), 2);

const root = path.join(__dirname, '..');
const pointsRoute = fs.readFileSync(path.join(root, 'routes/points.js'), 'utf8');
const adminRoute = fs.readFileSync(path.join(root, 'routes/admin.js'), 'utf8');
const ledgerModel = fs.readFileSync(path.join(root, 'models/PointsLedger.js'), 'utf8');
const referralCore = fs.readFileSync(path.join(root, 'utils/referralCore.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const adminUi = fs.readFileSync(path.join(root, 'public/admin.html'), 'utf8');
const translations = fs.readFileSync(path.join(root, 'public/js/i18n.js'), 'utf8');
const vipPlanModel = fs.readFileSync(path.join(root, 'models/VipPlan.js'), 'utf8');
const vipPurchaseSection = pointsRoute.slice(
  pointsRoute.indexOf("router.post('/vip/purchase'"),
  pointsRoute.indexOf("router.post('/vip/:subscriptionId/claim'")
);

assert.match(pointsRoute, /router\.get\('\/vip\/plans'/);
assert.match(pointsRoute, /router\.post\('\/vip\/purchase'/);
assert.match(pointsRoute, /router\.post\('\/vip\/:subscriptionId\/claim'/);
assert.match(pointsRoute, /scope: 'vip_purchase'/);
assert.match(pointsRoute, /scope: 'vip_daily_claim'/);
assert.match(pointsRoute, /type: 'vip_daily_reward'/);
assert.match(pointsRoute, /type: 'vip_purchase'/);
assert.match(pointsRoute, /sourceId = `vip:\$\{subscription\._id\}:claim:\$\{claimIndex \+ 1\}`/);
assert.match(pointsRoute, /lastClaimAt\.getTime\(\) \+ DAY_MS/);
assert.match(pointsRoute, /body: \{ planNumber \}/, 'purchase request hash must cover plan ID, not client reward fields');
assert.match(pointsRoute, /calculateTotalRewardCents\(pricePoints, plan\.monthlyRewardPercent, plan\.durationDays\)/);
assert.match(vipPurchaseSection, /points: finalPoints/,
  'purchase response must include points awarded by the first-time VIP activation task');
assert.match(vipPurchaseSection, /balanceAfter: user\.points/,
  'VIP debit ledger balance must reflect the post-debit, pre-activation-reward balance');
assert.ok(vipPurchaseSection.indexOf("type: 'vip_purchase'") < vipPurchaseSection.indexOf("type: 'task'"),
  'the purchase debit ledger must be recorded before the activation reward ledger');
assert.match(adminRoute, /router\.put\('\/vip\/plans'/);
assert.match(adminRoute, /input\.length !== 10/);
assert.match(adminRoute, /pricePointsForVipPlan/);
assert.match(adminRoute, /durationDays !== 100/);
assert.match(ledgerModel, /'vip_purchase'/);
assert.match(ledgerModel, /'vip_daily_reward'/);
assert.match(ledgerModel, /'vip_principal_return'/);
assert.match(server, /VipPlan\.ensureDefaults\(\)/);
assert.match(server, /settleMaturedVipSubscriptions\(\)/);
assert.match(app, /\/api\/points\/vip\/purchase/);
assert.match(app, /\/api\/points\/vip\/\$\{encodeURIComponent\(subscriptionId\)\}\/claim/);
assert.match(app, /getPendingIdempotencyKey\(scope\)/);
assert.match(app, /vip_need_more_points/);
assert.match(app, /function setVipPlanCategory\(category\)/);
assert.match(app, /vipPlanCard--ultimate/);
assert.match(app, /isOwned \? "vip_status_owned"/);
assert.doesNotMatch(app, /vipPlanBalance/);
assert.match(app, /function renderProfileVip\(\)/);
assert.match(app, /function setVipSubscriptionFilter\(filter\)/);
assert.match(app, /subscription\.status === "active"/);
assert.match(app, /subscription\.status !== "active"/);
assert.match(app, /function claimAllVipRewards\(\)/);
assert.match(app, /await claimVipReward\(subscriptionId, \{ silent: true, bulk: true \}\)/);
assert.strictEqual((translations.match(/vip_claim_all:/g) || []).length, 3, 'Claim All label must exist in English, Persian, and Pashto');
assert.strictEqual((translations.match(/vip_subscription_filter_expired:/g) || []).length, 3, 'expired filter label must exist in all supported locales');
assert.deepStrictEqual(VIP_PRICE_GRAMS, [1, 3, 5, 10, 20, 35, 50, 70, 85, 100]);
assert.deepStrictEqual(VIP_PRICE_POINTS, [10000, 30000, 50000, 100000, 200000, 350000, 500000, 700000, 850000, 1000000]);
assert.deepStrictEqual(VIP_PRICE_POINTS.map((_, index) => pricePointsForVipPlan(index + 1)), VIP_PRICE_POINTS, 'all 10 plans must use the published fixed Points prices');
assert.strictEqual(pricePointsForVipPlan(1, 10), 10000, 'conversion-rate changes must not alter catalog prices');
assert.strictEqual(pricePointsForVipPlan(10, 0.0001), 1000000, 'VIP 10 must remain fixed at 1,000,000 Points');
assert.match(vipPlanModel, /planNumber: 10, pricePoints: pricePointsForVipPlan\(10\), monthlyRewardPercent: periodRewardPercentForPlan\(10\)/, 'catalog seed must use the fixed VIP 10 price');
assert.match(vipPlanModel, /planNumber: 1, pricePoints: pricePointsForVipPlan\(1\), monthlyRewardPercent: 10/);
assert.match(vipPlanModel, /planNumber: 2, pricePoints: pricePointsForVipPlan\(2\), monthlyRewardPercent: 10/);
assert.match(vipPlanModel, /planNumber: 3, pricePoints: pricePointsForVipPlan\(3\), monthlyRewardPercent: 10/);
assert.match(vipPlanModel, /pricePoints, monthlyRewardPercent, durationDays, policyVersion, productGroup, principalDailyBps, rewardDailyBps/);
assert.deepStrictEqual([1, 2, 3].map(periodRewardPercentForPlan), [10, 10, 10]);
assert.deepStrictEqual([4, 5, 6, 7].map(periodRewardPercentForPlan), [15, 15, 15, 15]);
assert.deepStrictEqual([8, 9, 10].map(periodRewardPercentForPlan), [20, 20, 20]);
assert.match(adminRoute, /expectedPeriodYieldPercent = periodRewardPercentForPlan\(planNumber\)/);
assert.match(adminUi, /VIP 1–3/);
assert.match(adminUi, /VIP 4–7/);
assert.match(adminUi, /VIP 8–10/);
assert.match(adminUi, /بازدهی دوره \(۱۰۰ روزه/);
assert.match(adminUi, /function setVipAdminCategory\(category\)/);
assert.match(pointsRoute, /res\.set\('Cache-Control', 'no-store'\)/);
assert.match(adminRoute, /res\.set\('Cache-Control', 'no-store'\)/);
for (const [planNumber, pricePoints] of [[1, 10000], [2, 30000], [3, 50000]]) {
  const policy = newVipPolicyForPlan(planNumber);
  const dailyCents = dailyPointsCentsFromBps(pricePoints, policy.principalDailyBps) + dailyPointsCentsFromBps(pricePoints, policy.rewardDailyBps);
  assert.strictEqual(dailyCents / 100, pricePoints / 100 + pricePoints / 1000, `VIP ${planNumber} daily payout includes principal plus 10% period yield`);
  assert.strictEqual((dailyCents * 100) / 100, pricePoints + pricePoints / 10, `VIP ${planNumber} total 100-day payout`);
}
assert.match(indexHtml, /data-tab="vip"/);
assert.strictEqual((indexHtml.match(/data-tab="(?:home|tasks|vip|wallet|profile)"/g) || []).length, 5);
assert.deepStrictEqual([...indexHtml.matchAll(/data-tab="([^"]+)"/g)].map(match => match[1]), ['home', 'tasks', 'vip', 'wallet', 'profile']);
assert.match(app, /validTabs = \["home", "tasks", "vip", "wallet", "profile"\]/);
assert.match(app, /function renderDailyCheckinCard\(\)/);
assert.match(app, /DAILY_CHECKIN_REWARDS = Object\.freeze\(\[5, 7, 9, 11, 13, 14, 15\]\)/);
assert.doesNotMatch(app, /function renderDaily\(\)/);
assert.doesNotMatch(app, /buildWheelGradient\(\)/);
assert.match(translations, /nav_vip:/);
assert.match(adminUi, /\/api\/admin\/vip\/plans/);
assert.match(referralCore, /ELIGIBLE_ORIGINAL_EARN_TYPES = Object\.freeze\(\['task', 'checkin', 'leaderboard_reward'\]\)/);
for (const key of ['menu_vip_plans', 'vip_title', 'vip_buy_confirm', 'vip_claim_button', 'vip_membership_kicker', 'vip_tier_starter', 'vip_tier_pro', 'vip_tier_ultimate', 'vip_plan_cost_label', 'vip_plan_profit_label', 'vip_plan_duration_label', 'vip_total_reward_label', 'vip_need_more_points', 'vip_status_owned', 'history_type_vip_purchase', 'history_type_vip_daily_reward', 'history_type_vip_principal_return']) {
  assert.ok(translations.includes(`${key}:`), `missing translation ${key}`);
}

console.log('ALL PASS — VIP return math, exact cent allocation, claim cadence and server-side/idempotency contracts');
