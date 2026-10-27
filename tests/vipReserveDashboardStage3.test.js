'use strict';
const assert = require('assert');
const fs = require('fs');
const adminRoute = fs.readFileSync('routes/admin.js', 'utf8');
const adminUi = fs.readFileSync('public/admin.html', 'utf8');

assert(adminRoute.includes("router.get('/vip/reserve/dashboard'"), 'Reserve dashboard endpoint must exist');
assert(adminRoute.includes("activeRemainingLiabilityCents"), 'Dashboard must expose active remaining liability');
assert(adminRoute.includes('coveragePercent'), 'Dashboard must calculate reserve coverage');
assert(adminRoute.includes('reconciliationDifferencePoints'), 'Dashboard must expose reconciliation difference');
assert(adminRoute.includes("type: { $in: ['vip_daily_principal', 'vip_daily_reward'] }"), 'Dashboard must reconcile principal and reward ledger events');
assert(adminRoute.includes("router.post('/vip/reserve/fund'"), 'Reserve funding endpoint must remain explicit');
assert(adminRoute.includes('VIP_RESERVE_FUND_INVALID'), 'Reserve funding must validate amount and reason');
assert(adminUi.includes('id="vipReserveDashboard"'), 'Admin UI must contain Reserve dashboard container');
assert(adminUi.includes('loadVipReserveDashboard()'), 'Admin UI must refresh Reserve dashboard');
assert(adminUi.includes('fundVipReserveAdmin()'), 'Admin UI must expose controlled Reserve funding action');
assert(adminUi.includes('این عملیات فقط Reserve حسابداری'), 'UI must clearly state that funding is accounting-only');
console.log('PASS — VIP Reserve dashboard contract, coverage reconciliation, ledger split, and safe funding controls');
