'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const auditModule = require('../utils/vipEntitlementAudit');

const fixture = {
  generatedAt: '2026-11-07T00:00:00.000Z',
  readOnly: true,
  collections: ['users', 'vipsubscriptions'],
  vipSubscriptions: {
    total: 12,
    byStatus: { active: 7, completed: 5 },
    currentlyEligibleActiveMiners: 7,
    eligibleMinerCountDistributionByUser: { '7': 1 },
    activeButPastEndDate: 0,
    activeButClaimsCounterAtDuration: 0,
    activeButReserveLiabilityFullyPaid: 0,
    completedBeforeEndWithUnpaidLiability: 0,
    startEndBsonTypes: [{ startAt: 'date', endAt: 'date', count: 12 }]
  },
  legacy: { usersWithFutureVipGoldUntil: 1 },
  purchaseLedger: { transactionRecordsByStatus: { posted: 12 }, pointsLedgerRecordsByStatus: {} }
};
auditModule.buildVipEntitlementAudit = async () => fixture;

const router = require('../routes/admin');
const adminSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'admin.js'), 'utf8');
const panelSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
const authPosition = adminSource.indexOf('router.use(requireAdmin);');
const endpointPosition = adminSource.indexOf("router.get('/audit-vip-entitlements'");
assert.ok(authPosition >= 0 && endpointPosition > authPosition,
  'the audit endpoint must be registered after the router-wide admin authentication middleware');
assert.match(panelSource, /VIP &amp; Miners Audit/);
assert.match(panelSource, /api\("\/api\/admin\/audit-vip-entitlements"\)/);
assert.match(panelSource, /id="vipEntitlementAuditJson"/);
assert.match(panelSource, /navigator\.clipboard\.writeText\(value\)/);

const layer = router.stack.find(item => item.route?.path === '/audit-vip-entitlements' && item.route.methods.get);
assert.ok(layer, 'GET /api/admin/audit-vip-entitlements should be registered');
const handler = layer.route.stack.at(-1).handle;

(async () => {
  let cacheControl = '';
  let body;
  await handler({}, {
    set(name, value) { if (name.toLowerCase() === 'cache-control') cacheControl = value; return this; },
    json(value) { body = value; return this; }
  }, error => { throw error; });
  assert.equal(cacheControl, 'no-store', 'audit output must not be cached by browsers or proxies');
  assert.deepEqual(body, { success: true, ...fixture });
  assert.equal(body.readOnly, true);
  console.log('PASS — VIP entitlement audit endpoint is admin-gated, no-store, and read-only');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
