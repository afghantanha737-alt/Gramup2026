'use strict';

const crypto = require('crypto');
const VipSubscription = require('../models/VipSubscription');
const VipSettlementOperation = require('../models/VipSettlementOperation');
const { settleLegacyVipSubscriptionInSession, legacySettlementFilter } = require('./vipSettlement');
const { withMongoTransaction } = require('./mongoTransaction');
const { recordAdminLogRequired } = require('./adminLog');

const EXECUTION_ENV = 'ENABLE_MANUAL_VIP_SETTLEMENT';
const CONFIRMATION = 'SETTLE_LEGACY_VIP';
const KEY_PATTERN = /^[A-Za-z0-9:_-]{8,120}$/;

function isExecutionEnabled(env = process.env) {
  return env[EXECUTION_ENV] === 'true';
}

function validateKey(value) {
  const key = String(value || '').trim();
  return KEY_PATTERN.test(key) ? key : null;
}

function requestHash({ asOf, limit }) {
  const hashAsOf = asOf == null ? 'server-now' : new Date(asOf).toISOString();
  return crypto.createHash('sha256').update(JSON.stringify({ mode: 'execute', asOf: hashAsOf, limit })).digest('hex');
}

function normalizeLimit(value) {
  return Math.min(500, Math.max(1, Math.floor(Number(value) || 100)));
}

function publicCandidate(row) {
  return {
    subscriptionId: String(row._id),
    planNumber: row.planNumber,
    pricePoints: row.pricePoints,
    endAt: row.endAt,
    status: row.status,
    policyVersion: row.policyVersion || 'legacy_v1',
    reconciliationStatus: row.reconciliationStatus || 'eligible'
  };
}

async function dryRun({ asOf = new Date(), limit = 100 } = {}) {
  const now = new Date(asOf);
  if (!Number.isFinite(now.getTime())) throw new Error('A valid asOf date is required.');
  const boundedLimit = normalizeLimit(limit);
  const base = { policyVersion: { $in: [null, 'legacy_v1'] }, principalReturnedAt: null, endAt: { $lte: now } };
  const eligible = legacySettlementFilter({ now });
  const [candidates, candidateCount, reviewCount, activeCount, cancelledCount] = await Promise.all([
    VipSubscription.find(eligible).select('_id planNumber pricePoints endAt status policyVersion reconciliationStatus').sort({ endAt: 1 }).limit(boundedLimit).lean(),
    VipSubscription.countDocuments(eligible),
    VipSubscription.countDocuments({ ...base, reconciliationStatus: 'needs_review' }),
    VipSubscription.countDocuments({ ...base, status: 'active' }),
    VipSubscription.countDocuments({ ...base, status: 'cancelled' })
  ]);
  const totalPoints = candidates.reduce((sum, row) => sum + Number(row.pricePoints || 0), 0);
  return {
    mode: 'dry_run',
    asOf: now.toISOString(),
    limit: boundedLimit,
    candidateCount,
    returnedCount: candidates.length,
    truncated: candidateCount > candidates.length,
    totalPointsInReturnedCandidates: totalPoints,
    excludedNeedsReviewCount: reviewCount,
    activeExpiredCount: activeCount,
    cancelledExpiredCount: cancelledCount,
    candidates: candidates.map(publicCandidate)
  };
}

async function executeAuthorized({ actor, adminId, idempotencyKey, confirmation, asOf = null, limit = 100, env = process.env } = {}) {
  if (!isExecutionEnabled(env)) {
    const error = new Error('Manual VIP settlement is disabled.');
    error.code = 'MANUAL_VIP_SETTLEMENT_DISABLED';
    error.statusCode = 403;
    throw error;
  }
  if (confirmation !== CONFIRMATION) {
    const error = new Error('Explicit settlement confirmation is required.');
    error.code = 'SETTLEMENT_CONFIRMATION_REQUIRED';
    error.statusCode = 400;
    throw error;
  }
  const key = validateKey(idempotencyKey);
  if (!key) {
    const error = new Error('A unique Idempotency-Key is required.');
    error.code = 'SETTLEMENT_IDEMPOTENCY_KEY_REQUIRED';
    error.statusCode = 400;
    throw error;
  }
  const now = asOf == null ? new Date() : new Date(asOf);
  if (!Number.isFinite(now.getTime())) throw new Error('A valid asOf date is required.');
  const boundedLimit = normalizeLimit(limit);
  const hash = requestHash({ asOf: asOf == null ? null : now, limit: boundedLimit });
  const existing = await VipSettlementOperation.findOne({ idempotencyKey: key }).lean();
  if (existing) {
    if (existing.requestHash !== hash) {
      const error = new Error('This settlement Idempotency-Key was reused with different parameters.');
      error.code = 'SETTLEMENT_KEY_REUSED';
      error.statusCode = 409;
      throw error;
    }
    if (existing.status === 'completed') return { ...existing.report, replayed: true };
    const error = new Error('This settlement operation is already processing.');
    error.code = 'SETTLEMENT_ALREADY_PROCESSING';
    error.statusCode = 409;
    throw error;
  }

  try {
    return await withMongoTransaction(async session => {
      const operation = new VipSettlementOperation({
        idempotencyKey: key,
        requestHash: hash,
        actor: String(actor || 'ادمین').slice(0, 120),
        adminId: String(adminId || '').slice(0, 200),
        mode: 'execute',
        status: 'processing',
        asOf: now,
        limit: boundedLimit
      });
      await operation.save({ session });

      const candidates = await VipSubscription.find(legacySettlementFilter({ now }))
        .select('_id')
        .sort({ endAt: 1 })
        .limit(boundedLimit)
        .session(session)
        .lean();
      const results = [];
      for (const candidate of candidates) {
        results.push(await settleLegacyVipSubscriptionInSession(candidate._id, now, session));
      }
      const report = {
        mode: 'execute',
        asOf: now.toISOString(),
        limit: boundedLimit,
        scanned: results.length,
        settled: results.filter(item => item.settled).length,
        alreadyRecorded: results.filter(item => item.alreadyRecorded).length,
        skipped: results.filter(item => item.skipped).length,
        totalPointsSettled: results.reduce((sum, item) => sum + Number(item.amount || 0), 0),
        results: results.map(item => ({
          subscriptionId: item.subscriptionId || '',
          settled: Boolean(item.settled),
          alreadyRecorded: Boolean(item.alreadyRecorded),
          skipped: Boolean(item.skipped),
          amount: item.amount || 0
        }))
      };
      operation.status = 'completed';
      operation.report = report;
      operation.completedAt = new Date();
      await operation.save({ session });
      await recordAdminLogRequired({
        actor,
        action: 'vip_legacy_settlement_execute',
        targetType: 'vip_settlement_operation',
        targetId: operation._id,
        details: `idempotencyKey=${key}; scanned=${report.scanned}; settled=${report.settled}; points=${report.totalPointsSettled}`
      }, session);
      return report;
    });
  } catch (error) {
    if (error?.code === 11000) {
      const replay = await VipSettlementOperation.findOne({ idempotencyKey: key }).lean();
      if (replay?.requestHash === hash && replay.status === 'completed') return { ...replay.report, replayed: true };
    }
    throw error;
  }
}

module.exports = {
  CONFIRMATION,
  EXECUTION_ENV,
  isExecutionEnabled,
  validateKey,
  dryRun,
  executeAuthorized
};
