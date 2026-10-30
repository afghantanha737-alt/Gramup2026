'use strict';

const mongoose = require('mongoose');

const TRANSACTION_TYPES = [
  'task',
  'checkin',
  'daily_chest',
  'ad_reward',
  'spin',
  'mining_claim',
  'mining_upgrade',
  'referral_bonus',
  'referral_initial',
  'referral_welcome',
  'referral_commission',
  'leaderboard_reward',
  'exchange_out',
  'exchange_in',
  'withdraw',
  'deposit',
  'vip_purchase',
  'vip_daily_principal',
  'vip_daily_reward',
  'vip_principal_return',
  'admin_adjust',
  'withdrawal_refund'
];

const IMMUTABLE_ERROR = 'Transaction records are append-only and cannot be mutated.';

const transactionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    currency: { type: String, enum: ['points', 'gram'], required: true, index: true },
    transactionId: { type: String, required: true, trim: true },
    sourceId: { type: String, required: true, trim: true },
    type: { type: String, enum: TRANSACTION_TYPES, required: true },
    status: { type: String, enum: ['pending', 'posted', 'reversed', 'failed'], default: 'posted', required: true, index: true },
    // Signed amount: positive credits the account, negative debits it.
    amount: { type: Number, required: true, validate: { validator: Number.isFinite, message: 'Transaction amount must be finite.' } },
    balanceBefore: { type: Number, default: null },
    balanceAfter: { type: Number, default: null },
    description: { type: String, default: '' },
    referralLevel: { type: Number, default: null, min: 1, max: 10 },
    sourceUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    recipientUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    commissionRatePercent: { type: Number, default: null, min: 0, max: 100 },
    earningTransactionId: { type: String, default: '' },
    // SHA-256 over the immutable business fields; useful for read-only reconciliation.
    integrityHash: { type: String, required: true, match: /^[a-f0-9]{64}$/ }
  },
  { timestamps: true, minimize: false }
);

// Journal identity is scoped to account and currency. This permits the same
// external source label to exist independently in points and GRAM while still
// preventing replay/double-credit for one account and currency.
transactionSchema.index({ user: 1, currency: 1, sourceId: 1 }, { unique: true });
transactionSchema.index({ user: 1, currency: 1, transactionId: 1 }, { unique: true });
transactionSchema.index({ user: 1, currency: 1, createdAt: -1 });
transactionSchema.index({ createdAt: 1, status: 1, type: 1 });

function rejectMutation(next) {
  const error = new Error(IMMUTABLE_ERROR);
  error.code = 'TRANSACTION_APPEND_ONLY';
  next(error);
}

for (const method of [
  'updateOne', 'updateMany', 'findOneAndUpdate', 'findByIdAndUpdate',
  'replaceOne', 'findOneAndReplace', 'findOneAndDelete', 'findByIdAndDelete',
  'deleteOne', 'deleteMany', 'findOneAndRemove', 'remove'
]) {
  transactionSchema.pre(method, rejectMutation);
}

transactionSchema.pre('bulkWrite', function rejectBulkMutation(next, operations) {
  const mutating = (operations || []).some(operation => {
    const name = Object.keys(operation || {})[0];
    return name && name !== 'insertOne';
  });
  if (mutating) return rejectMutation(next);
  return next();
});

transactionSchema.pre('save', function rejectResave(next) {
  if (!this.isNew) return rejectMutation(next);
  return next();
});

transactionSchema.statics.TRANSACTION_TYPES = Object.freeze([...TRANSACTION_TYPES]);
transactionSchema.statics.APPEND_ONLY_ERROR = IMMUTABLE_ERROR;

module.exports = mongoose.model('Transaction', transactionSchema);
module.exports.TRANSACTION_TYPES = TRANSACTION_TYPES;
