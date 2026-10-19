'use strict';
const express = require('express');
const router = express.Router();
require('../utils/asyncHandler').wrapRouter(router);
const { requireUnifiedAuth } = require('../utils/unifiedAuth');
const { withMembership } = require('../utils/membership');
const User = require('../models/User');
const TonProofChallenge = require('../models/TonProofChallenge');
const { createProofPayload, verifyTonProof, SUPPORTED_NETWORK, PROOF_MAX_AGE_SEC } = require('../utils/tonProof');

const auth = withMembership(requireUnifiedAuth(process.env.BOT_TOKEN));

function expectedDomain(req) {
  const configured = String(process.env.TON_PROOF_DOMAIN || '').trim().toLowerCase();
  if (configured) return configured;
  const appUrl = String(process.env.APP_URL || '').trim();
  if (appUrl) {
    try { return new URL(appUrl).hostname.toLowerCase(); } catch { /* use the configured request host below */ }
  }
  if (process.env.NODE_ENV === 'production') return '';
  return String(req.hostname || '').trim().toLowerCase();
}

function publicWallet(user) {
  const wallet = user?.connectedWallet || {};
  return {
    connected: Boolean(wallet.address),
    address: wallet.address || '',
    network: wallet.network || '',
    walletApp: wallet.walletApp || '',
    proofVerifiedAt: wallet.proofVerifiedAt || null
  };
}

router.post('/payload', auth, async (req, res) => {
  const domain = expectedDomain(req);
  if (!domain) return res.status(503).json({ success: false, code: 'TON_PROOF_DOMAIN_NOT_CONFIGURED', message: 'TON Proof هنوز برای این محیط پیکربندی نشده است.' });
  const payload = createProofPayload();
  const expiresAt = new Date(Date.now() + PROOF_MAX_AGE_SEC * 1000);
  await TonProofChallenge.create({ user: req.dbUser._id, payload, expiresAt });
  res.json({ success: true, payload, domain, network: SUPPORTED_NETWORK, expiresAt: expiresAt.toISOString() });
});

router.post('/verify', auth, async (req, res) => {
  const domain = expectedDomain(req);
  if (!domain) return res.status(503).json({ success: false, code: 'TON_PROOF_DOMAIN_NOT_CONFIGURED', message: 'TON Proof هنوز برای این محیط پیکربندی نشده است.' });
  const proof = req.body?.proof;
  const account = req.body?.account || {};
  const payload = String(proof?.payload || '').trim();
  if (!payload || !account.address || !account.walletStateInit) {
    return res.status(400).json({ success: false, code: 'TON_PROOF_INPUT_INVALID', message: 'اطلاعات TON Proof کامل نیست.' });
  }
  const challenge = await TonProofChallenge.findOne({
    user: req.dbUser._id,
    payload,
    consumedAt: null,
    expiresAt: { $gt: new Date() }
  });
  if (!challenge) return res.status(409).json({ success: false, code: 'TON_PROOF_CHALLENGE_INVALID', message: 'این TON Proof منقضی یا قبلاً استفاده شده است. Wallet را دوباره متصل کنید.' });

  let verified;
  try {
    verified = verifyTonProof({
      address: account.address,
      network: account.chain,
      walletStateInit: account.walletStateInit,
      proof,
      expectedDomain: domain,
      expectedPayload: challenge.payload
    });
  } catch (error) {
    return res.status(401).json({ success: false, code: error.message || 'TON_PROOF_INVALID', message: 'مالکیت Wallet با TON Proof تأیید نشد. Wallet را دوباره متصل کنید.' });
  }

  const consumed = await TonProofChallenge.findOneAndUpdate(
    { _id: challenge._id, consumedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { consumedAt: new Date(), verifiedAddress: verified.address, verifiedPublicKey: verified.publicKey } },
    { new: true }
  );
  if (!consumed) return res.status(409).json({ success: false, code: 'TON_PROOF_REPLAYED', message: 'این TON Proof قبلاً مصرف شده است.' });

  const now = new Date();
  const updated = await User.findOneAndUpdate(
    { _id: req.dbUser._id },
    { $set: {
      walletAddress: verified.address,
      connectedWallet: {
        address: verified.address,
        canonicalAddress: verified.address,
        network: SUPPORTED_NETWORK,
        publicKey: verified.publicKey,
        proofPublicKey: verified.publicKey,
        walletApp: String(account.walletApp || '').trim().slice(0, 80),
        connectedAt: req.dbUser.connectedWallet?.connectedAt || now,
        lastSeenAt: now,
        proofVerifiedAt: now
      }
    } },
    { new: true }
  );
  res.json({ success: true, verified: true, wallet: publicWallet(updated) });
});

module.exports = router;
