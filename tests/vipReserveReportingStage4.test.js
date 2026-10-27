'use strict';
const assert = require('assert');
const fs = require('fs');
const { buildVipReserveWorkbook, reportRange, REPORT_MAX_DAYS } = require('../utils/vipReserveReport');

assert.strictEqual(reportRange({ dateFrom: '2026-10-01', dateTo: '2026-10-10' }).fromKey, '2026-10-01');
assert.strictEqual(reportRange({ dateFrom: '2026-10-01', dateTo: '2026-10-10' }).toKey, '2026-10-10');
assert.throws(() => reportRange({ dateFrom: '2025-01-01', dateTo: '2026-10-10' }), error => error.code === 'VIP_REPORT_DATE_RANGE_TOO_LARGE');
assert.throws(() => reportRange({ dateFrom: '2026-10-10', dateTo: '2026-10-01' }), error => error.code === 'VIP_REPORT_DATE_RANGE_INVALID');
assert(REPORT_MAX_DAYS <= 366, 'report range must remain bounded');
assert(fs.readFileSync('routes/admin.js', 'utf8').includes("router.get('/vip/reserve/report'"));
assert(fs.readFileSync('routes/admin.js', 'utf8').includes("router.get('/vip/reserve/export.xlsx'"));

(async () => {
  const workbook = await buildVipReserveWorkbook({
    generatedAt: '2026-10-27T00:00:00.000Z',
    range: { from: '2026-10-01', to: '2026-10-02', days: 2 },
    reserve: { availablePoints: 100, reservedPoints: 50, paidPoints: 10, fundedPoints: 160 },
    current: { activeSubscriptions: 1, remainingLiabilityPoints: 50 },
    period: { subscriptions: 1, ledgerTotals: {} },
    plans: [{ planNumber: 1, subscriptions: 1, liabilityPoints: 50, paidPoints: 0, rewardPoints: 5 }],
    daily: [{ date: '2026-10-01', principal: 1, reward: 2, principalReturn: 0, total: 3, events: 2 }],
    funding: [],
    policy: { version: 'v2_100d', payoutsEnabled: false }
  });
  assert.deepStrictEqual(workbook.worksheets.map(sheet => sheet.name), ['Summary', 'Daily Ledger', 'Plan Cohorts', 'Reserve Funding']);
  const buffer = await workbook.xlsx.writeBuffer();
  assert(buffer.length > 1000, 'XLSX buffer must contain a real workbook');
  console.log('PASS — bounded Reserve reports, XLSX workbook sheets, and export route contract');
})().catch(error => { console.error(error); process.exitCode = 1; });
