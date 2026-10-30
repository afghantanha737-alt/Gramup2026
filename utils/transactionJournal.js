'use strict';

const crypto = require('crypto');
const DefaultTransaction = require('../models/Transaction');

function canonicalValue(value) {
  if (value instanceof Date) return { __type: 'date', value: value.toISOString() };
  if (Buffer.isBuffer(value)) return { __type: 'buffer', value: value.toString('base64') };
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonicalValue(value[key]);
      return result;
    }, {});
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return { __type: 'number', value: String(value) };
  if (typeof value === 'undefined') return { __type: 'undefined' };
  return value;
}

function hashTransaction(fields) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(canonicalValue(fields)))
    .digest('hex');
}

function asString(value) {
  return value == null || value === '' ? null : String(value);
}

function queryWithSession(query, session) {
  return session && query && typeof query.session === 'function' ? query.session(session) : query;
}

function identityFilter({ user, currency, sourceId, transactionId }) {
  return {
    user,
    currency,
    $or: [{ sourceId }, { transactionId }]
  };
}

function matchingEntry(existing, payload) {
  if (!existing) return false;
  const fields = ['user', 'currency', 'sourceId', 'transactionId', 'type', 'amount', 'balanceAfter'];
  return fields.every(field => {
    if (existing[field] == null) return true;
    return String(existing[field]) === String(payload[field]);
  });
}

/**
 * Append one immutable journal row. The caller must pass the same Mongo
 * session used for the balance and PointsLedger writes; failures are thrown so
 * withMongoTransaction aborts the complete financial operation.
 */
async function appendTransaction(options = {}) {
  const {
    Transaction = DefaultTransaction,
    user,
    type,
    amount,
    currency = 'points',
    sourceId,
    transactionId,
    status = 'posted',
    description = '',
    balanceBefore = null,
    balanceAfter = null,
    referralLevel = null,
    sourceUserId = null,
    recipientUserId = null,
    commissionRatePercent = null,
    earningTransactionId = '',
    session = null
  } = options;

  if (!user || !type || !['points', 'gram'].includes(currency)) {
    const error = new Error('Transaction journal identity is incomplete.');
    error.code = 'TRANSACTION_JOURNAL_INVALID';
    throw error;
  }
  if (!Number.isFinite(Number(amount))) {
    const error = new Error('Transaction journal amount must be finite.');
    error.code = 'TRANSACTION_JOURNAL_INVALID_AMOUNT';
    throw error;
  }

  const effectiveSourceId = asString(sourceId);
  const effectiveTransactionId = asString(transactionId);
  if (!effectiveSourceId || !effectiveTransactionId) {
    const error = new Error('New financial ledger entries require sourceId and transactionId for journal identity.');
    error.code = 'TRANSACTION_JOURNAL_ID_REQUIRED';
    throw error;
  }

  const immutable = {
    user,
    currency,
    sourceId: effectiveSourceId,
    transactionId: effectiveTransactionId,
    type,
    status,
    amount: Number(amount),
    balanceBefore: balanceBefore == null ? null : Number(balanceBefore),
    balanceAfter: balanceAfter == null ? null : Number(balanceAfter),
    description: String(description || ''),
    referralLevel,
    sourceUserId,
    recipientUserId,
    commissionRatePercent,
    earningTransactionId: String(earningTransactionId || '')
  };
  const payload = { ...immutable, integrityHash: hashTransaction(immutable) };

  try {
    const entry = new Transaction(payload);
    await entry.save(session ? { session } : undefined);
    return { ok: true, created: true, entry };
  } catch (error) {
    if (error?.code !== 11000) throw error;

    // A duplicate is acceptable only when it is the exact same accounting
    // identity. Any mismatch is a fail-closed integrity error.
    let query = Transaction.findOne(identityFilter({
      user,
      currency,
      sourceId: effectiveSourceId,
      transactionId: effectiveTransactionId
    }));
    query = queryWithSession(query, session);
    const existing = await query;
    if (!existing) throw error;
    if (!matchingEntry(existing, payload) || existing.integrityHash !== payload.integrityHash) {
      const conflict = new Error('Transaction journal identity already exists with different accounting fields.');
      conflict.code = 'TRANSACTION_JOURNAL_CONFLICT';
      throw conflict;
    }
    return { ok: true, created: false, duplicate: true, entry: existing };
  }
}

function transactionIdFor({ user, currency, sourceId }) {
  return `TX-${hashTransaction({ user, currency, sourceId })}`;
}

module.exports = { appendTransaction, canonicalValue, hashTransaction, transactionIdFor };
