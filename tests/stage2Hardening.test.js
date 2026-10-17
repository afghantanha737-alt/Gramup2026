'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

async function main() {
  // Deterministic UTC check-in boundaries, independent of the host timezone.
  const { utcDayKey, wasUtcYesterday } = require('../utils/utcDay');
  assert.strictEqual(utcDayKey(null), null);
  assert.strictEqual(utcDayKey(''), null);
  assert.strictEqual(wasUtcYesterday('2026-10-01T23:59:59-07:00', '2026-10-02T00:00:00+04:30'), false, 'timestamps map to UTC calendar days, not written local dates');
  assert.strictEqual(wasUtcYesterday('2026-10-01T23:59:59Z', '2026-10-02T00:00:00Z'), true);
  assert.strictEqual(wasUtcYesterday('2026-10-01T10:00:00Z', '2026-10-01T23:00:00Z'), false, 'same UTC day is not yesterday');
  assert.strictEqual(wasUtcYesterday('2026-10-01T10:00:00Z', '2026-10-03T10:00:00Z'), false, 'missed day breaks consecutive streak');

  // Capacity boundary and the exact atomic database predicate used on each claim.
  const { isTaskCapacityAvailable, taskCapacityFilter } = require('../utils/taskCapacity');
  const maximum = 7;
  assert.strictEqual(isTaskCapacityAvailable({ completedCount: maximum - 1, maxCompletions: maximum }), true);
  assert.strictEqual(isTaskCapacityAvailable({ completedCount: maximum, maxCompletions: maximum }), false);
  assert.strictEqual(isTaskCapacityAvailable({ completedCount: maximum + 1, maxCompletions: maximum }), false);
  let concurrentlyCompleted = maximum - 1;
  const concurrentClaims = await Promise.all(Array.from({ length: 12 }, async () => {
    await Promise.resolve();
    if (!isTaskCapacityAvailable({ completedCount: concurrentlyCompleted, maxCompletions: maximum })) return false;
    concurrentlyCompleted += 1;
    return true;
  }));
  assert.strictEqual(concurrentClaims.filter(Boolean).length, 1, 'only the final available slot can be claimed concurrently');
  assert.strictEqual(concurrentlyCompleted, maximum);
  const capacityFilter = taskCapacityFilter('task-id', new Date('2026-10-04T00:00:00Z'));
  assert.ok(capacityFilter.$and.some(clause => clause.$or?.some(term => term.$expr?.$lt?.[0] === '$completedCount' && term.$expr?.$lt?.[1] === '$maxCompletions')));

  const { normalizeTaskUrl } = require('../utils/taskUrl');
  assert.strictEqual(normalizeTaskUrl('https://t.me/gramup'), 'https://t.me/gramup');
  assert.strictEqual(normalizeTaskUrl('javascript:alert(1)'), null);
  assert.strictEqual(normalizeTaskUrl('data:text/html,hi'), null);
  assert.strictEqual(normalizeTaskUrl('tg://resolve?domain=foo'), null);
  assert.strictEqual(normalizeTaskUrl('ftp://example.com'), null);

  // Telegram initData: real HMAC, time boundaries, required auth_date/user and duplicate-key rejection.
  const { verifyInitData } = require('../utils/telegramAuth');
  const token = '123456:unit-test-token-not-real';
  const makeInitData = (authDate, extra = []) => {
    const pairs = [['auth_date', String(authDate)], ['query_id', 'test-query'], ['user', JSON.stringify({ id: 123456, first_name: 'Test' })], ...extra];
    const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).sort().join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
    const hash = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
    return `${pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}&hash=${hash}`;
  };
  const now = Math.floor(Date.now() / 1000);
  assert.ok(verifyInitData(makeInitData(now), token));
  assert.strictEqual(verifyInitData(makeInitData(now + 1), token), null, 'future auth_date is rejected');
  assert.strictEqual(verifyInitData(makeInitData(now - 90000), token), null, 'expired auth_date is rejected');
  assert.strictEqual(verifyInitData('user=%7B%22id%22%3A1%7D', token), null, 'missing auth_date/hash is rejected');
  assert.strictEqual(verifyInitData(makeInitData(now, [['auth_date', String(now)]]), token), null, 'duplicate parameters are rejected');
  const invalidHash = makeInitData(now).replace(/hash=[a-f0-9]+/i, `hash=${'0'.repeat(64)}`);
  assert.strictEqual(verifyInitData(invalidHash, token), null, 'invalid HMAC is rejected');

  // Referral eligibility uses the existing policy thresholds as the source of truth.
  const { evaluateReferralEligibility } = require('../utils/referralEligibility');
  const nowDate = new Date('2026-10-04T12:00:00Z');
  const eligibleUser = { createdAt: new Date(nowDate.getTime() - 8 * 86400000), referralRiskScore: 0 };
  const eligibleTasks = [
    { status: 'approved', createdAt: new Date('2026-10-01T01:00:00Z') },
    { status: 'approved', createdAt: new Date('2026-10-01T13:00:00Z') },
    { status: 'approved', createdAt: new Date('2026-10-02T01:00:00Z') }
  ];
  assert.strictEqual(evaluateReferralEligibility(eligibleUser, eligibleTasks, nowDate).eligible, true);
  assert.strictEqual(evaluateReferralEligibility(eligibleUser, eligibleTasks.slice(0, 2), nowDate).eligible, false);
  assert.strictEqual(evaluateReferralEligibility({ ...eligibleUser, referralRiskScore: 50 }, eligibleTasks, nowDate).eligible, false);
  assert.strictEqual(evaluateReferralEligibility({ ...eligibleUser, createdAt: nowDate }, eligibleTasks, nowDate).eligible, false);

  // Reconciliation fixture spanning ledger currencies and earn/spend categories.
  const { buildDiscrepancy, isDiscrepant } = require('../utils/financialAudit');
  const fixtureLedger = [
    { currency: 'points', amount: -30, type: 'spin' },
    { currency: 'points', amount: 20, type: 'task' },
    { currency: 'points', amount: 10, type: 'referral_commission' },
    { currency: 'gram', amount: 2, type: 'deposit' },
    { currency: 'gram', amount: -0.5, type: 'withdraw' }
  ];
  const ledgerSums = fixtureLedger.reduce((sums, entry) => ({ ...sums, [entry.currency]: (sums[entry.currency] || 0) + entry.amount }), {});
  const reconciled = buildDiscrepancy({ _id: 'stage2-fixture', points: 0, gramBalance: 1.5 }, ledgerSums);
  assert.strictEqual(isDiscrepant(reconciled), false);
  assert.strictEqual(isDiscrepant(buildDiscrepancy({ _id: 'stage2-fixture', points: 1, gramBalance: 1.5 }, ledgerSums)), true);

  // Withdrawal idempotency: fake transactional persistence exercises retry, rollback, payload conflict and race.
  const operationPath = require.resolve('../models/IdempotencyOperation');
  const Operation = require(operationPath);
  const originalFindOne = Operation.findOne;
  const originalSave = Operation.prototype.save;
  const transactionPath = require.resolve('../utils/mongoTransaction');
  const transactionModule = require(transactionPath);
  const originalTransaction = transactionModule.withMongoTransaction;
  const records = new Map();
  const recordKey = doc => `${String(doc.userId)}|${doc.scope}|${doc.key}`;
  Operation.findOne = filter => ({ lean: async () => records.get(`${String(filter.userId)}|${filter.scope}|${filter.key}`) || null });
  Operation.prototype.save = async function fakeSave() {
    const key = recordKey(this);
    const existing = records.get(key);
    if (existing && existing !== this) { const error = new Error('duplicate'); error.code = 11000; throw error; }
    records.set(key, this);
    this.isNew = false;
    return this;
  };
  transactionModule.withMongoTransaction = async work => {
    const snapshot = new Map(records);
    try { return await work({}); }
    catch (error) { records.clear(); for (const [key, value] of snapshot) records.set(key, value); throw error; }
  };
  try {
    delete require.cache[require.resolve('../utils/idempotency')];
    const { executeIdempotently } = require('../utils/idempotency');
    const userId = '0123456789abcdef01234567';
    let executions = 0;
    const key = 'withdraw-test-key-01';
    const body = { amount: 2, address: 'wallet-address-123' };
    const first = await executeIdempotently({ userId, scope: 'withdraw', key, body, execute: async () => { executions += 1; return { status: 201, body: { withdrawalId: 'withdrawal-1' } }; } });
    const replay = await executeIdempotently({ userId, scope: 'withdraw', key, body, execute: async () => { executions += 1; return { status: 201, body: {} }; } });
    assert.strictEqual(first.replayed, false);
    assert.strictEqual(replay.replayed, true);
    assert.deepStrictEqual(replay.body, first.body);
    assert.strictEqual(executions, 1, 'duplicate retry has one financial execution');
    await assert.rejects(executeIdempotently({ userId, scope: 'withdraw', key, body: { ...body, amount: 3 }, execute: async () => ({ body: {} }) }), error => error.code === 'IDEMPOTENCY_KEY_REUSED');

    const failedKey = 'withdraw-failed-key-01';
    await assert.rejects(executeIdempotently({ userId, scope: 'withdraw', key: failedKey, body, execute: async () => { throw new Error('transient'); } }), /transient/);
    const retried = await executeIdempotently({ userId, scope: 'withdraw', key: failedKey, body, execute: async () => ({ status: 201, body: { withdrawalId: 'withdrawal-2' } }) });
    assert.strictEqual(retried.replayed, false, 'failed transaction leaves no tombstone and retry can execute');

    const concurrentKey = 'withdraw-concurrent-01';
    let releaseFirst;
    const firstGate = new Promise(resolve => { releaseFirst = resolve; });
    let concurrentExecutions = 0;
    const concurrentWork = executeIdempotently({ userId, scope: 'withdraw', key: concurrentKey, body, execute: async () => { concurrentExecutions += 1; await firstGate; return { status: 201, body: { withdrawalId: 'withdrawal-3' } }; } });
    await new Promise(resolve => setTimeout(resolve, 0));
    const secondWork = executeIdempotently({ userId, scope: 'withdraw', key: concurrentKey, body, execute: async () => { concurrentExecutions += 1; return { status: 201, body: {} }; } });
    await new Promise(resolve => setTimeout(resolve, 80));
    releaseFirst();
    const [concurrentA, concurrentB] = await Promise.all([concurrentWork, secondWork]);
    assert.strictEqual(concurrentExecutions, 1, 'concurrent duplicate key executes one logical operation');
    assert.deepStrictEqual(concurrentA.body, concurrentB.body);
  } finally {
    Operation.findOne = originalFindOne;
    Operation.prototype.save = originalSave;
    transactionModule.withMongoTransaction = originalTransaction;
  }

  // Durable webhook claim must rely on unique database insertion and treat duplicate IDs as no-op.
  const { claimWebhookUpdate } = require('../utils/webhookDedup');
  const seen = new Set();
  const fakeUpdateModel = { create: async document => { if (seen.has(document.updateId)) { const error = new Error('duplicate'); error.code = 11000; throw error; } seen.add(document.updateId); return document; } };
  assert.deepStrictEqual(await claimWebhookUpdate(101, 'message', fakeUpdateModel), { claimed: true });
  assert.deepStrictEqual(await claimWebhookUpdate(101, 'message', fakeUpdateModel), { claimed: false, duplicate: true });
  assert.deepStrictEqual(await claimWebhookUpdate('bad', 'message', fakeUpdateModel), { claimed: false, invalid: true });

  // Shared job lock allows only one concurrent owner across instances.
  const { withDistributedJobLock } = require('../utils/distributedJobLock');
  const locks = new Map();
  const fakeLockModel = {
    collection: { findOneAndUpdate: async (filter, update) => {
      const current = locks.get(filter._id);
      if (current && current.leaseUntil > filter.leaseUntil.$lte) { const error = new Error('duplicate'); error.code = 11000; throw error; }
      const value = { _id: filter._id, ...update.$set };
      locks.set(filter._id, value);
      return { value };
    } },
    updateOne: async (filter, update) => { const current = locks.get(filter._id); if (current?.owner === filter.owner) Object.assign(current, update.$set); },
    deleteOne: async filter => { const current = locks.get(filter._id); if (current?.owner === filter.owner) locks.delete(filter._id); }
  };
  let unlock;
  const waitForRelease = new Promise(resolve => { unlock = resolve; });
  const firstLock = withDistributedJobLock('single-job', () => waitForRelease, { Model: fakeLockModel, leaseMs: 3000 });
  await new Promise(resolve => setTimeout(resolve, 0));
  const secondLock = await withDistributedJobLock('single-job', async () => 'should-not-run', { Model: fakeLockModel, leaseMs: 3000 });
  assert.strictEqual(secondLock.locked, false);
  unlock('done');
  assert.strictEqual((await firstLock).locked, true);

  // Existing schemas/indexes and source contracts.
  const source = rel => fs.readFileSync(path.join(root, rel), 'utf8');
  assert.ok(source('models/TelegramWebhookUpdate.js').includes('unique: true'));
  assert.ok(source('models/Settings.js').includes('unique: true'));
  assert.ok(source('models/VipPlan.js').includes('$setOnInsert'));
  assert.ok(source('routes/points.js').includes("scope: 'withdraw'"));
  assert.ok(source('routes/points.js').includes('nextCursor'));
  assert.ok(source('routes/tasks.js').includes('taskCapacityFilter'));
  assert.ok(source('utils/referralSystem.js').includes("origin.referralEligibilityStatus === 'eligible'"));
  assert.ok(source('utils/referralSystem.js').includes('originEligible'));
  assert.ok(source('routes/telegramWebhook.js').includes('claimWebhookUpdate'));
  assert.ok(source('server.js').includes('verifyMongoTransactionCapability'));
  assert.ok(source('server.js').includes('withDistributedJobLock'));
  assert.ok(source('routes/leaderboard.js').includes("{ isBanned: false }"));
  assert.ok(!source('public/js/app.js').includes('initData=${'));
  const appSource = source('public/js/app.js');
  const safeTaskHelper = appSource.match(/function safeTaskHttpUrl\(value\) \{[\s\S]*?\n\}/);
  assert.ok(safeTaskHelper, 'task renderer helper must be declared before runtime use');
  const safeTaskHttpUrl = new Function(`${safeTaskHelper[0]}; return safeTaskHttpUrl;`)();
  assert.strictEqual(safeTaskHttpUrl('https://t.me/gramup'), 'https://t.me/gramup');
  assert.strictEqual(safeTaskHttpUrl('javascript:alert(1)'), '');
  assert.strictEqual(safeTaskHttpUrl('tg://resolve?domain=gramup'), '');
  assert.strictEqual(safeTaskHttpUrl('https://user:pass@example.com'), '');
  assert.ok(/app\.js\?v=/.test(source('public/index.html')));
  assert.ok(source('server.js').includes("['index.html', 'app.js'].includes(path.basename(filePath))"));
  assert.ok(source('public/js/app.js').includes('X-Telegram-Init-Data'));
  assert.ok(source('public/js/app.js').includes('getPendingIdempotencyKey("withdraw")'));
  assert.ok(!source('public/js/app.js').includes('idempotencyKeyFor("withdraw")'));
  assert.ok(source('public/js/app.js').includes('clearDefinitiveIdempotencyFailure("withdraw"'));
  assert.ok(source('public/js/app.js').includes('tasks_load_error'));
  assert.ok(source('public/js/app.js').includes('history_load_error'));
  assert.ok(source('public/js/app.js').includes('navigationListenersInstalled'));
  assert.ok(source('public/js/app.js').includes('if (!isCurrentRender()) return;'));
  console.log('ALL PASS — Stage 2 hardening unit and source-contract regression checks');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
