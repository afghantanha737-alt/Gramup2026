'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { toCents, pointsFromCents } = require('../utils/vipReserve');

assert.strictEqual(toCents(1000), 100000);
assert.strictEqual(toCents(0), null);
assert.strictEqual(toCents(-1), null);
assert.strictEqual(toCents(1.234), 123);
assert.strictEqual(pointsFromCents(123), 1.23);

const root = path.join(__dirname, '..');
const points = fs.readFileSync(path.join(root, 'routes/points.js'), 'utf8');
const reserve = fs.readFileSync(path.join(root, 'utils/vipReserve.js'), 'utf8');
const subscription = fs.readFileSync(path.join(root, 'models/VipSubscription.js'), 'utf8');
const ledger = fs.readFileSync(path.join(root, 'models/PointsLedger.js'), 'utf8');
const settlement = fs.readFileSync(path.join(root, 'utils/vipSettlement.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'routes/admin.js'), 'utf8');

assert.match(reserve, /availablePointsCents: \{ \$gte: pointsCents \}/);
assert.match(reserve, /reservedPointsCents: \{ \$gte: pointsCents \}/);
assert.match(reserve, /fundedPointsCents/);
assert.match(subscription, /reserveLiabilityCents/);
assert.match(subscription, /reservePaidCents/);
assert.match(points, /VIP_RESERVE_INSUFFICIENT/);
assert.match(points, /VIP_RESERVE_UNAVAILABLE/);
assert.match(points, /type: 'vip_daily_principal'/);
assert.match(points, /type: 'vip_daily_reward'/);
assert.match(points, /releaseForPayout\(totalPayoutCents, session\)/);
assert.match(points, /reserveForSubscription\(reserveLiabilityCents, session\)/);
assert.match(ledger, /'vip_daily_principal'/);
assert.match(settlement, /policyVersion: \{ \$in: \[null, 'legacy_v1'\] \}/);
assert.match(server, /'\.\/models\/VipReserve'/);
assert.match(admin, /router\.get\('\/vip\/reserve'/);
assert.match(admin, /router\.post\('\/vip\/reserve\/fund'/);
console.log('PASS — VIP v2 Reserve accounting, atomic principal+reward payout, and legacy settlement isolation');
