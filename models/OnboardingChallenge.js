'use strict';

const mongoose = require('mongoose');

// A short-lived server record for the fallback proof-of-work anti-automation
// step. The browser receives the nonce but no reusable pass token is stored.
// Expiration is operational cleanup only; verification always checks expiresAt.
const onboardingChallengeSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  challengeId: { type: String, required: true, unique: true, minlength: 16, maxlength: 128 },
  nonce: { type: String, required: true, minlength: 32, maxlength: 256 },
  difficulty: { type: Number, required: true, min: 3, max: 8 },
  issuedAt: { type: Date, required: true },
  // Keep this as a normal index. Verification always checks expiresAt and
  // startup must not change an existing production index into a TTL index.
  expiresAt: { type: Date, required: true },
  consumedAt: { type: Date, default: null },
  verifiedAt: { type: Date, default: null }
}, { timestamps: true, minimize: false });

onboardingChallengeSchema.index({ expiresAt: 1 });
onboardingChallengeSchema.index({ user: 1, consumedAt: 1, expiresAt: 1 });

module.exports = mongoose.model('OnboardingChallenge', onboardingChallengeSchema);
