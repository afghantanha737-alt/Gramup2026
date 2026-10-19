'use strict';
const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  direction: { type: String, enum: ['gram_to_points'], required: true },
  status: { type: String, enum: ['pending', 'confirmed', 'rejected'], default: 'pending', index: true },
  reference: { type: String, required: true, unique: true, index: true },
  amount: { type: Number, required: true, min: 0 },
  amountRaw: { type: String, required: true },
  expectedPoints: { type: Number, required: true, min: 1 },
  rateSnapshot: { type: Number, required: true, min: 0 },
  depositAddressSnapshot: { type: String, required: true },
  walletAddressSnapshot: { type: String, required: true },
  submittedTxHash: { type: String, default: '' },
  txHash: { type: String, default: '' },
  txHashNormalized: { type: String, default: undefined, select: false },
  sourceAddress: { type: String, default: '' },
  verificationNote: { type: String, default: '' },
  verifiedAt: { type: Date, default: null },
  creditedAt: { type: Date, default: null }
}, { timestamps: true });

schema.index({ user: 1, status: 1, createdAt: -1 });
schema.index({ user: 1 }, { unique: true, partialFilterExpression: { status: 'pending' } });
schema.index({ txHashNormalized: 1 }, { unique: true, partialFilterExpression: { txHashNormalized: { $type: 'string' } } });

schema.set('toJSON', { transform(_doc, ret) { delete ret.txHashNormalized; return ret; } });
module.exports = mongoose.model('GramSwapIntent', schema);
