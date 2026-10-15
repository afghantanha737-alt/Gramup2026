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

// Retain deterministic historical VIP math for legacy subscriptions and audits.
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
  assert.strictEqual(totalCents, plan.expectedTotal, `legacy plan ${plan.planNumber} reward cents`);
  const daily = Array.from({ length: plan.days }, (_, index) => dailyRewardCents(totalCents, plan.days, index));
  assert.strictEqual(daily.length, 30);
  assert.ok(daily.every(value => value >= 1));
  assert.strictEqual(sum(daily), totalCents, 'daily rounding must preserve the recorded historical total');
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
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const adminUi = fs.readFileSync(path.join(root, 'public/admin.html'), 'utf8');
const miningRoute = fs.readFileSync(path.join(root, 'routes/mining.js'), 'utf8');
const miningModel = fs.readFileSync(path.join(root, 'models/VipSubscription.js'), 'utf8');

assert.match(pointsRoute, /router\.get\('\/vip\/plans'/);
assert.match(pointsRoute, /deprecated: true/);
assert.match(pointsRoute, /router\.post\('\/vip\/purchase'/);
assert.match(pointsRoute, /code: 'VIP_REMOVED'/);
assert.match(pointsRoute, /router\.post\('\/vip\/:subscriptionId\/claim'/);
assert.doesNotMatch(app, /\/api\/points\/vip\/purchase/, 'the user interface must not offer a new VIP purchase');
assert.match(ledgerModel, /'vip_purchase'/, 'legacy financial records remain representable');
assert.match(ledgerModel, /'vip_daily_reward'/);
assert.match(ledgerModel, /'vip_principal_return'/);
assert.match(server, /settleMaturedVipSubscriptions\(\)/, 'old active subscriptions still need settlement');
assert.match(miningModel, /principalReturnedAt/);
assert.match(adminRoute, /router\.get\('\/vip\/plans'/, 'admin read-only legacy tools remain available');
assert.match(adminUi, /\/api\/admin\/vip\/plans/);
assert.match(indexHtml, /data-tab="mining"/);
assert.doesNotMatch(indexHtml, /data-tab="vip"/);
assert.match(app, /function renderMiningTab\(\)/);
assert.match(app, /\/api\/mining\/claim/);
assert.match(miningRoute, /router\.post\('\/claim'/);
assert.match(miningRoute, /router\.post\('\/upgrade'/);
assert.match(app, /getPendingIdempotencyKey\(scope\)/, 'other financial operations retain idempotency');

console.log('ALL PASS — legacy VIP math/settlement preservation, retired user purchases and Mining navigation');
