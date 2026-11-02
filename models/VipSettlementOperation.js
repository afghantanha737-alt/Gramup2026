'use strict';
const mongoose = require('mongoose');

const vipSettlementOperationSchema = new mongoose.Schema({
  idempotencyKey: { type: String, required: true, unique: true, minlength: 8, maxlength: 120 },
  requestHash: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
  actor: { type: String, required: true, maxlength: 120 },
  adminId: { type: String, required: true, maxlength: 200 },
  mode: { type: String, enum: ['dry_run', 'execute'], required: true },
  status: { type: String, enum: ['processing', 'completed', 'failed'], required: true, default: 'processing' },
  asOf: { type: Date, required: true },
  limit: { type: Number, required: true, min: 1, max: 500 },
  report: { type: mongoose.Schema.Types.Mixed, default: null },
  completedAt: { type: Date, default: null },
  errorCode: { type: String, default: '' }
}, { timestamps: true, minimize: false });

vipSettlementOperationSchema.index({ createdAt: -1 });

module.exports = mongoose.model('VipSettlementOperation', vipSettlementOperationSchema);
