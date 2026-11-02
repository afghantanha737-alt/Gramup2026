'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const points = fs.readFileSync(path.join(root, 'routes/points.js'), 'utf8');
const reconciliation = require('../utils/vipSettlementReconciliation');
const reconciliationSource = fs.readFileSync(path.join(root, 'utils/vipSettlementReconciliation.js'), 'utf8');
const VipSubscription = require('../models/VipSubscription');

assert.doesNotMatch(server, /settleMaturedVipSubscriptions\(/, 'server startup must not call financial settlement');
assert.doesNotMatch(points, /settleMaturedVipSubscriptions\(/, 'normal VIP catalog reads must not settle liabilities');
assert.match(server, /Legacy VIP principal settlement is never a startup or timer job/);
assert.strictEqual(reconciliation.isExecutionEnabled({}), false, 'manual settlement must be disabled by default');
assert.strictEqual(reconciliation.isExecutionEnabled({ ENABLE_MANUAL_VIP_SETTLEMENT: 'true' }), true);
assert.match(reconciliationSource, /server-now/, 'requests without asOf need a stable idempotency hash');
assert.ok(VipSubscription.schema.path('reconciliationStatus'));
assert.deepStrictEqual(VipSubscription.schema.path('reconciliationStatus').enumValues, ['eligible', 'needs_review', 'settled', 'ineligible']);
assert.match(fs.readFileSync(path.join(root, 'utils/vipSettlement.js'), 'utf8'), /reconciliationStatus: \{ \$nin: \['needs_review'/);

(async () => {
  await assert.rejects(
    reconciliation.executeAuthorized({ confirmation: reconciliation.CONFIRMATION, idempotencyKey: 'safe-key-123', env: {} }),
    error => error && error.code === 'MANUAL_VIP_SETTLEMENT_DISABLED'
  );
  console.log('ALL PASS — startup settlement disabled, explicit reconciliation gated, needs_review quarantine present');
})().catch(error => { console.error(error); process.exitCode = 1; });
