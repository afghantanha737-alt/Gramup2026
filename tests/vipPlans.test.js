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
assert.match(adminRoute, /router\.put\('\/vip\/plans'/);
assert.match(adminRoute, /input\.length !== 10/);
assert.match(ledgerModel, /'vip_purchase'/);
assert.match(ledgerModel, /'vip_daily_reward'/);
assert.match(ledgerModel, /'vip_principal_return'/);
assert.match(server, /VipPlan\.ensureDefaults\(\)/);
assert.match(server, /settleMaturedVipSubscriptions\(\)/);
assert.match(app, /\/api\/points\/vip\/purchase/);
assert.match(app, /\/api\/points\/vip\/\$\{encodeURIComponent\(subscriptionId\)\}\/claim/);
assert.match(app, /getPendingIdempotencyKey\(scope\)/);
assert.match(app, /vip_insufficient_points/);
assert.match(app, /function renderProfileVip\(\)/);
assert.match(vipPlanModel, /planNumber: 10, pricePoints: 100000, monthlyRewardPercent: 15/, 'catalog seed must include VIP 10');
assert.match(vipPlanModel, /planNumber: 1, pricePoints: 1000, monthlyRewardPercent: 5/);
assert.match(indexHtml, /data-tab="vip"/);
assert.strictEqual((indexHtml.match(/data-tab="(?:home|tasks|vip|wallet|profile)"/g) || []).length, 5);
assert.deepStrictEqual([...indexHtml.matchAll(/data-tab="([^"]+)"/g)].map(match => match[1]), ['home', 'tasks', 'vip', 'wallet', 'profile']);
assert.match(app, /validTabs = \["home", "tasks", "vip", "wallet", "profile"\]/);
assert.match(app, /function renderDailyCheckinCard\(\)/);
assert.match(app, /DAILY_CHECKIN_REWARDS = Object\.freeze\(\[5, 7, 9, 11, 13, 14, 15\]\)/);
assert.doesNotMatch(app, /function renderDaily\(\)/);
assert.doesNotMatch(app, /buildWheelGradient\(\)/);
assert.match(translations, /nav_spin:/);
assert.match(translations, /nav_vip:/);
assert.match(adminUi, /\/api\/admin\/vip\/plans/);
assert.match(referralCore, /ELIGIBLE_ORIGINAL_EARN_TYPES = Object\.freeze\(\['task', 'checkin', 'leaderboard_reward'\]\)/);
for (const key of ['menu_vip_plans', 'vip_title', 'vip_buy_confirm', 'vip_claim_button', 'history_type_vip_purchase', 'history_type_vip_daily_reward', 'history_type_vip_principal_return']) {
  assert.ok(translations.includes(`${key}:`), `missing translation ${key}`);
}

console.log('ALL PASS — VIP return math, exact cent allocation, claim cadence and server-side/idempotency contracts');
