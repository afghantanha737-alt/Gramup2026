'use strict';
const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  payload: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  consumedAt: { type: Date, default: null },
  verifiedAddress: { type: String, default: '' },
  verifiedPublicKey: { type: String, default: '' }
}, { timestamps: true });

// Keep this as a normal index. Existing production databases may already
// contain expiresAt_1 as a non-TTL index; changing its options at startup
// would stop the entire server. Expired challenges are rejected by the query.
schema.index({ expiresAt: 1 });
schema.index({ payload: 1 }, { unique: true });
schema.index({ user: 1, consumedAt: 1, createdAt: -1 });

module.exports = mongoose.model('TonProofChallenge', schema);
