'use strict';

const PointsLedger = require('../models/PointsLedger');
const DefaultTransaction = require('../models/Transaction');
const { appendTransaction, hashTransaction, transactionIdFor } = require('./transactionJournal');

function queryWithSession(query, session) {
  return session && query && typeof query.session === 'function' ? query.session(session) : query;
}

function journalEnabled(PointsLedgerModel, TransactionModel, options) {
  // Journaling is default-on. A test/legacy adapter must either inject both
  // models (PointsLedgerModel + TransactionModel) or explicitly opt out; a
  // disconnected/default Transaction model is never silently ignored.
  if (options.journal === false) return false;
  return true;
}

function generatedSourceId({ user, type, amount, currency, description, balanceAfter }) {
  return `ledger:${hashTransaction({ user, type, amount: Number(amount), currency, description: String(description || ''), balanceAfter: balanceAfter == null ? null : Number(balanceAfter) })}`;
}

function validateDuplicate(existing, payload) {
  if (!existing) return;
  const fields = ['user', 'type', 'currency', 'amount'];
  const mismatch = fields.some(field => existing[field] != null && String(existing[field]) !== String(payload[field]));
  if (mismatch) {
    const error = new Error('Ledger sourceId already exists with different accounting fields.');
    error.code = 'LEDGER_IDENTITY_CONFLICT';
    throw error;
  }
}

/**
 * Records a historical ledger row. New writes are fail-closed: the canonical
 * PointsLedger row and its separate Transaction journal row are inserted with
 * the same session. Legacy callers without a real Mongoose model remain
 * compatible for offline/unit adapters and historical rows are never backfilled.
 */
async function recordLedger({
  user,
  type,
  amount,
  currency = 'points',
  description = '',
  balanceAfter = null,
  sourceId = null,
  transactionId = null,
  referralLevel = null,
  sourceUserId = null,
  recipientUserId = null,
  commissionRatePercent = null,
  earningTransactionId = '',
  session = null,
  throwOnError = false,
  PointsLedgerModel = PointsLedger,
  TransactionModel = DefaultTransaction,
  journal = undefined
}) {
  const shouldJournal = journalEnabled(PointsLedgerModel, TransactionModel, {
    journal,
    journalModelsProvided: PointsLedgerModel !== PointsLedger && TransactionModel !== DefaultTransaction
  });
  const effectiveSourceId = String(sourceId || generatedSourceId({ user, type, amount, currency, description, balanceAfter }));
  const effectiveTransactionId = String(transactionId || transactionIdFor({ user, currency, sourceId: effectiveSourceId }));

  if (shouldJournal && !session) {
    const error = new Error('New financial ledger entries must use a MongoDB session so the Transaction journal is atomic.');
    error.code = 'LEDGER_SESSION_REQUIRED';
    throw error;
  }

  try {
    const payload = {
      user,
      type,
      amount,
      currency,
      description,
      balanceAfter,
      sourceId: effectiveSourceId,
      transactionId: effectiveTransactionId
    };
    if (referralLevel != null) payload.referralLevel = referralLevel;
    if (sourceUserId) payload.sourceUserId = sourceUserId;
    if (recipientUserId) payload.recipientUserId = recipientUserId;
    if (commissionRatePercent != null) payload.commissionRatePercent = commissionRatePercent;
    if (earningTransactionId) payload.earningTransactionId = String(earningTransactionId);

    const entry = session
      ? await new PointsLedgerModel(payload).save({ session })
      : await PointsLedgerModel.create(payload);

    let transaction = null;
    if (shouldJournal) {
      const journalResult = await appendTransaction({
        Transaction: TransactionModel,
        user,
        type,
        amount,
        currency,
        sourceId: effectiveSourceId,
        transactionId: effectiveTransactionId,
        description,
        balanceBefore: balanceAfter == null ? null : Number(balanceAfter) - Number(amount),
        balanceAfter,
        referralLevel,
        sourceUserId,
        recipientUserId,
        commissionRatePercent,
        earningTransactionId,
        session
      });
      if (!journalResult.created) {
        const error = new Error('Transaction journal identity already exists after a new Ledger insert; transaction aborted.');
        error.code = 'TRANSACTION_JOURNAL_DUPLICATE_AFTER_LEDGER_INSERT';
        throw error;
      }
      transaction = journalResult.entry;
    }
    return { ok: true, created: true, entry, transaction, journaled: shouldJournal };
  } catch (error) {
    if (error?.code === 11000) {
      let query = PointsLedgerModel.findOne({ sourceId: effectiveSourceId });
      query = queryWithSession(query, session);
      let existing = await query;
      if (!existing && effectiveTransactionId) {
        query = PointsLedgerModel.findOne({ transactionId: effectiveTransactionId });
        query = queryWithSession(query, session);
        existing = await query;
      }
      if (existing) {
        validateDuplicate(existing, { user, type, currency, amount });
        return { ok: true, created: false, duplicate: true, entry: existing, journaled: false };
      }
    }
    // A journal failure must never be downgraded to a soft logging error for
    // a new real-model write, otherwise the balance could commit without it.
    if (shouldJournal || throwOnError) throw error;
    console.error('Failed to record ledger entry:', error.message || error);
    return { ok: false, created: false, error, journaled: false };
  }
}

async function recordLedgerRequired(options) {
  const { isEligibleOriginalEarn } = require('./referralCore');
  const eligible = isEligibleOriginalEarn(options);
  if (eligible && !options.session) throw new Error('Qualifying point earnings must use a MongoDB transaction so referral commissions remain atomic.');
  const result = await recordLedger({ ...options, throwOnError: true });
  if (result.created && eligible) {
    const { distributeReferralCommissions } = require('./referralSystem');
    // This remains the existing integration point: retention/referral welcome
    // code can add its own typed entry without an unverified import here.
    await distributeReferralCommissions(result.entry, options.session);
  }
  return result;
}

module.exports = { recordLedger, recordLedgerRequired, generatedSourceId };
