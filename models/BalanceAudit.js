'use strict';
const mongoose = require('mongoose');

const balanceAuditSchema = new mongoose.Schema({
  actionId: { type: String, required: true, unique: true, index: true },
  batchId: { type: String, default: '', index: true },
  adminId: { type: String, required: true },
  actor: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  action: { type: String, enum: ['add', 'subtract', 'set', 'zero', 'account_status'], required: true },
  currency: { type: String, enum: ['points', 'usdt', 'account'], required: true },
  before: { type: Number, default: null },
  change: { type: Number, default: null },
  after: { type: Number, default: null },
  statusBefore: { type: String, default: '' },
  statusAfter: { type: String, default: '' },
  reason: { type: String, required: true, maxlength: 500 },
  transactionId: { type: String, default: '' }
}, { timestamps: true });

balanceAuditSchema.index({ userId: 1, createdAt: -1 });
balanceAuditSchema.index({ batchId: 1, createdAt: -1 });

module.exports = mongoose.model('BalanceAudit', balanceAuditSchema);
