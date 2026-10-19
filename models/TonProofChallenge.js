'use strict';
const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  payload: { type: String, required: true, unique: true, index: true },
  expiresAt: { type: Date, required: true, index: true },
  consumedAt: { type: Date, default: null, index: true },
  verifiedAddress: { type: String, default: '' },
  verifiedPublicKey: { type: String, default: '' }
}, { timestamps: true });

schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
schema.index({ user: 1, consumedAt: 1, createdAt: -1 });

module.exports = mongoose.model('TonProofChallenge', schema);
