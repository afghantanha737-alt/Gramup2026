'use strict';
const mongoose = require('mongoose');

const withdrawalSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    pointsSpent: { type: Number, required: true, min: 0 },
    cryptoAmount: { type: Number, required: true, min: 0 },
    address: { type: String, required: true },
    network: { type: String, default: 'TON' },
    token: { type: String, default: 'GRAM' },
    fromAddress: { type: String, default: '' },
    txHash: { type: String, default: null },
    // Deliberately unset until a verified chain transaction is attached.
    txHashNormalized: { type: String, default: undefined, select: false },
    verified: { type: Boolean, default: false },
    verificationNote: { type: String, default: '' },
    status: {
      type: String,
      enum: ['pending', 'approved', 'processing', 'rejected', 'paid', 'cancelled'],
      default: 'pending'
    },
    adminNote: { type: String, default: '' },
    paidAt: { type: Date, default: null },
    // Channel payout receipt state is separate from the financial state. The
    // claim timestamp prevents concurrent approval handlers from posting twice.
    payoutNumber: { type: Number, default: null, min: 1 },
    payoutNotificationSent: { type: Boolean, default: false, index: true },
    payoutNotificationSentAt: { type: Date, default: null },
    payoutNotificationClaimedAt: { type: Date, default: null },
    statusHistory: {
      type: [{ status: String, at: { type: Date, default: Date.now }, note: { type: String, default: '' } }],
      default: []
    }
  },
  { timestamps: true }
);

withdrawalSchema.index(
  { txHashNormalized: 1 },
  { unique: true, partialFilterExpression: { txHashNormalized: { $type: 'string' } } }
);
// Private withdrawal history is always read by owner, newest first.
withdrawalSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Withdrawal', withdrawalSchema);
