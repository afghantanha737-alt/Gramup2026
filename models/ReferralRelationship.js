'use strict';
const mongoose = require('mongoose');

const referralRelationshipSchema = new mongoose.Schema({
  referrerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  referredUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  level: { type: Number, required: true, min: 1, max: 10 },
  status: { type: String, enum: ['active', 'under_review', 'restricted', 'fraud_review', 'blocked'], default: 'active', index: true },
  initialRewardStatus: { type: String, enum: ['not_applicable', 'pending', 'paid', 'legacy_exempt'], default: 'not_applicable' },
  initialRewardTransactionId: { type: String, default: '' },
  welcomeRewardStatus: { type: String, enum: ['not_applicable', 'pending', 'paid', 'legacy_exempt'], default: 'not_applicable' },
  welcomeRewardTransactionId: { type: String, default: '' },
  statusReason: { type: String, default: '' },
  source: { type: String, enum: ['signup', 'migration', 'earning'], default: 'signup' }
}, { timestamps: true });

referralRelationshipSchema.index({ referrerId: 1, referredUserId: 1 }, { unique: true });
referralRelationshipSchema.index({ referredUserId: 1, level: 1 });

module.exports = mongoose.model('ReferralRelationship', referralRelationshipSchema);
