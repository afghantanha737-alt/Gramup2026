'use strict';

const crypto = require('crypto');
const express = require('express');
const router = express.Router();
require('../utils/asyncHandler').wrapRouter(router);
const { requireUnifiedAuth } = require('../utils/unifiedAuth');
const { sensitiveRateLimit } = require('../utils/apiSecurity');
const User = require('../models/User');
const OnboardingChallenge = require('../models/OnboardingChallenge');

const auth = requireUnifiedAuth(process.env.BOT_TOKEN);
const ONBOARDING_VERSION = 'onboarding-v2';
const TERMS_VERSION = 'gramup-terms-v1';
const ANTI_BOT_VERSION = 'pow-sha256-v1';
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const POW_DIFFICULTY = 4;

function walletState(user) {
  const wallet = user?.connectedWallet || {};
  if (!wallet.address) return { state: 'not_connected', address: '', network: '', proofVerifiedAt: null };
  const verified = Boolean(wallet.proofVerifiedAt && (wallet.canonicalAddress || wallet.address) && ['TON_MAINNET', '-239'].includes(String(wallet.network || '')));
  return {
    state: verified ? 'verified' : 'connected_unverified',
    address: String(wallet.address || ''),
    network: String(wallet.network || ''),
    proofVerifiedAt: wallet.proofVerifiedAt || null
  };
}

function onboardingStatus(user) {
  const termsAccepted = String(user?.termsAcceptedVersion || '') === TERMS_VERSION && Boolean(user?.termsAcceptedAt);
  const antiBotVerified = String(user?.antiBotVerificationVersion || '') === ANTI_BOT_VERSION && Boolean(user?.antiBotVerifiedAt);
  return {
    success: true,
    onboardingVersion: ONBOARDING_VERSION,
    completedAt: user?.onboardingVersion === ONBOARDING_VERSION ? (user.onboardingCompletedAt || null) : null,
    antiBot: { status: antiBotVerified ? 'verified' : 'required', version: ANTI_BOT_VERSION, verifiedAt: user?.antiBotVerifiedAt || null },
    terms: { required: !termsAccepted, currentVersion: TERMS_VERSION, acceptedVersion: user?.termsAcceptedVersion || '', acceptedAt: user?.termsAcceptedAt || null },
    wallet: walletState(user)
  };
}

function normalizeCounter(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  if (!/^(0|[1-9][0-9]{0,12})$/.test(text)) return null;
  return text;
}

function validProofOfWork(nonce, counter, difficulty) {
  const normalizedCounter = normalizeCounter(counter);
  const normalizedDifficulty = Number(difficulty);
  if (!nonce || !normalizedCounter || !Number.isInteger(normalizedDifficulty) || normalizedDifficulty < 3 || normalizedDifficulty > 8) return false;
  const digest = crypto.createHash('sha256').update(`${String(nonce)}:${normalizedCounter}`).digest('hex');
  return digest.startsWith('0'.repeat(normalizedDifficulty));
}

router.get('/status', auth, async (req, res) => {
  const user = await User.findById(req.dbUser._id).lean();
  if (!user) return res.status(404).json({ success: false, code: 'USER_NOT_FOUND', message: 'کاربر پیدا نشد.' });
  return res.json(onboardingStatus(user));
});

router.post('/antibot/challenge', auth, sensitiveRateLimit('onboarding', { ipMaxRequests: 12, userMaxRequests: 6 }), async (req, res) => {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
  const challenge = await OnboardingChallenge.create({
    user: req.dbUser._id,
    challengeId: crypto.randomUUID(),
    nonce: crypto.randomBytes(24).toString('base64url'),
    difficulty: POW_DIFFICULTY,
    issuedAt: now,
    expiresAt
  });
  return res.json({
    success: true,
    provider: 'proof_of_work',
    version: ANTI_BOT_VERSION,
    challengeId: challenge.challengeId,
    nonce: challenge.nonce,
    difficulty: challenge.difficulty,
    expiresAt: challenge.expiresAt.toISOString()
  });
});

router.post('/antibot/verify', auth, sensitiveRateLimit('onboarding', { ipMaxRequests: 12, userMaxRequests: 6 }), async (req, res) => {
  const challengeId = String(req.body?.challengeId || '').trim();
  const counter = normalizeCounter(req.body?.counter);
  if (!/^[0-9a-f-]{16,128}$/i.test(challengeId) || !counter) {
    return res.status(400).json({ success: false, code: 'ONBOARDING_CHALLENGE_INPUT_INVALID', message: 'اطلاعات امنیتی نامعتبر است.' });
  }
  const now = new Date();
  const challenge = await OnboardingChallenge.findOne({ user: req.dbUser._id, challengeId, consumedAt: null, expiresAt: { $gt: now } });
  if (!challenge) return res.status(409).json({ success: false, code: 'ONBOARDING_CHALLENGE_INVALID', message: 'چالش امنیتی منقضی یا مصرف شده است.' });
  if (!validProofOfWork(challenge.nonce, counter, challenge.difficulty)) {
    return res.status(401).json({ success: false, code: 'ONBOARDING_ANTIBOT_FAILED', message: 'تأیید امنیتی ناموفق بود.' });
  }
  const consumed = await OnboardingChallenge.findOneAndUpdate(
    { _id: challenge._id, consumedAt: null, expiresAt: { $gt: now } },
    { $set: { consumedAt: now, verifiedAt: now } },
    { new: true }
  );
  if (!consumed) return res.status(409).json({ success: false, code: 'ONBOARDING_CHALLENGE_REPLAYED', message: 'این چالش قبلاً استفاده شده است.' });
  const user = await User.findByIdAndUpdate(
    req.dbUser._id,
    { $set: { antiBotVerifiedAt: now, antiBotVerificationVersion: ANTI_BOT_VERSION } },
    { new: true, runValidators: true }
  );
  return res.json({ success: true, antiBot: onboardingStatus(user).antiBot });
});

router.post('/terms/accept', auth, sensitiveRateLimit('onboarding', { ipMaxRequests: 12, userMaxRequests: 6 }), async (req, res) => {
  const termsVersion = String(req.body?.termsVersion || '').trim();
  if (termsVersion !== TERMS_VERSION) {
    return res.status(409).json({ success: false, code: 'TERMS_VERSION_STALE', message: 'نسخهٔ قوانین تغییر کرده است؛ صفحه را تازه کنید.', currentVersion: TERMS_VERSION });
  }
  const now = new Date();
  const user = await User.findByIdAndUpdate(
    req.dbUser._id,
    { $set: { termsAcceptedVersion: TERMS_VERSION, termsAcceptedAt: now } },
    { new: true, runValidators: true }
  );
  return res.json({ success: true, terms: onboardingStatus(user).terms });
});

router.post('/complete', auth, sensitiveRateLimit('onboarding', { ipMaxRequests: 12, userMaxRequests: 6 }), async (req, res) => {
  const requestedVersion = String(req.body?.onboardingVersion || '').trim();
  if (requestedVersion !== ONBOARDING_VERSION) {
    return res.status(409).json({ success: false, code: 'ONBOARDING_VERSION_STALE', message: 'نسخهٔ راهنما تغییر کرده است؛ صفحه را تازه کنید.', onboardingVersion: ONBOARDING_VERSION });
  }
  const current = await User.findById(req.dbUser._id);
  if (!current) return res.status(404).json({ success: false, code: 'USER_NOT_FOUND', message: 'کاربر پیدا نشد.' });
  const status = onboardingStatus(current);
  if (status.antiBot.status !== 'verified' || status.terms.required || status.wallet.state !== 'verified') {
    return res.status(409).json({ success: false, code: 'ONBOARDING_REQUIREMENTS_INCOMPLETE', message: 'مراحل امنیت، قوانین و اتصال Wallet باید تکمیل شوند.', onboarding: status });
  }
  if (current.onboardingVersion !== ONBOARDING_VERSION || !current.onboardingCompletedAt) {
    current.onboardingVersion = ONBOARDING_VERSION;
    current.onboardingCompletedAt = new Date();
    await current.save();
  }
  return res.json(onboardingStatus(current));
});

module.exports = router;
module.exports.ONBOARDING_VERSION = ONBOARDING_VERSION;
module.exports.TERMS_VERSION = TERMS_VERSION;
module.exports.ANTI_BOT_VERSION = ANTI_BOT_VERSION;
module.exports.walletState = walletState;
module.exports.onboardingStatus = onboardingStatus;
module.exports.validProofOfWork = validProofOfWork;
module.exports.normalizeCounter = normalizeCounter;
