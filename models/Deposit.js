'use strict';
const mongoose = require('mongoose');

const depositSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reference: { type: String, required: true, unique: true },
  network: { type: String, enum: ['TON_MAINNET'], default: 'TON_MAINNET', required: true },
  token: { type: String, enum: ['GRAM', 'USDT'], default: 'USDT', required: true },
  assetType: { type: String, enum: ['native_gram', 'jetton_usdt'], default: 'jetton_usdt', required: true },
  depositAddressSnapshot: { type: String, required: true },
  walletAddressSnapshot: { type: String, default: '' },
  minimumDepositSnapshot: { type: Number, required: true, min: 0 },
  requestedAmount: { type: Number, default: null, min: 0 },
  requestedAmountRaw: { type: String, default: '' },
  amount: { type: Number, default: null, min: 0 },
  amountRaw: { type: String, default: '' },
  submittedBoc: { type: String, default: '', maxlength: 20000 },
  submittedTxHash: { type: String, default: '' },
  txHash: { type: String, default: '' },
  txHashNormalized: { type: String, default: undefined, select: false },
  sourceAddress: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'verifying', 'confirmed', 'rejected', 'cancelled'], default: 'pending', index: true },
  verificationNote: { type: String, default: '' },
  verifiedAt: { type: Date, default: null },
  creditedAt: { type: Date, default: null }
}, { timestamps: true });

depositSchema.index({ user: 1, status: 1, createdAt: -1 });
// Keep this index name distinct from the legacy `user_1` index already present
// in some deployments with a narrower `status: 'pending'` filter.
depositSchema.index({ user: 1 }, {
  name: 'active_deposit_per_user',
  unique: true,
  partialFilterExpression: { status: { $in: ['pending', 'verifying'] } }
});
depositSchema.index({ txHashNormalized: 1 }, {
  unique: true,
  partialFilterExpression: { txHashNormalized: { $type: 'string' } }
});

depositSchema.set('toJSON', {
  transform(_doc, ret) {
    delete ret.txHashNormalized;
    return ret;
  }
});

module.exports = mongoose.model('Deposit', depositSchema);
