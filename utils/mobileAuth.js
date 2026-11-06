'use strict';
const crypto = require('crypto');
const MobileAuthChallenge = require('../models/MobileAuthChallenge');
const MobileSession = require('../models/MobileSession');
const User = require('../models/User');

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function randomToken(bytes = 32) { return crypto.randomBytes(bytes).toString('base64url'); }
function hashToken(token) { return crypto.createHash('sha256').update(String(token)).digest('hex'); }
function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function createMobileChallenge() {
  const challengeId = crypto.randomUUID();
  const token = randomToken(32);
  await MobileAuthChallenge.create({
    challengeId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS)
  });
  return { challengeId, token, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) };
}

async function findChallenge(challengeId, token) {
  if (!challengeId || !token) return null;
  const challenge = await MobileAuthChallenge.findOne({ challengeId, tokenHash: hashToken(token) });
  if (!challenge || challenge.expiresAt <= new Date() || challenge.status === 'expired') return null;
  return challenge;
}

async function verifyMobileChallenge(payload, telegramId) {
  const raw = String(payload || '');
  if (!raw.startsWith('mobile_')) return false;
  const token = raw.slice('mobile_'.length);
  if (token.length < 20 || !telegramId) return false;
  const challenge = await MobileAuthChallenge.findOneAndUpdate(
    { tokenHash: hashToken(token), status: 'pending', expiresAt: { $gt: new Date() } },
    { $set: { status: 'verified', telegramId: String(telegramId), verifiedAt: new Date() } },
    { new: true }
  );
  return Boolean(challenge);
}

async function consumeMobileChallenge(challengeId, token, userAgent = '') {
  const challenge = await findChallenge(challengeId, token);
  if (!challenge || challenge.status !== 'verified' || !challenge.telegramId) return null;
  const user = await User.findOne({ telegramId: String(challenge.telegramId) });
  if (!user || user.isBanned) return null;
  const claimed = await MobileAuthChallenge.findOneAndUpdate(
    { _id: challenge._id, status: 'verified', consumedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { status: 'consumed', consumedAt: new Date() } },
    { new: true }
  );
  if (!claimed) return null;
  const accessToken = randomToken(48);
  try {
    await MobileSession.create({ user: user._id, tokenHash: hashToken(accessToken), expiresAt: new Date(Date.now() + SESSION_TTL_MS), userAgent: String(userAgent || '').slice(0, 300) });
  } catch (error) {
    await MobileAuthChallenge.updateOne({ _id: claimed._id, status: 'consumed' }, { $set: { status: 'verified', consumedAt: null } }).catch(() => {});
    throw error;
  }
  return { accessToken, expiresAt: new Date(Date.now() + SESSION_TTL_MS), user };
}

async function getMobileSession(req) {
  const header = String(req.get('authorization') || '');
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return null;
  const session = await MobileSession.findOne({ tokenHash: hashToken(match[1]), revokedAt: null, expiresAt: { $gt: new Date() } }).populate('user');
  if (!session || !session.user || session.user.isBanned) return null;
  session.lastUsedAt = new Date();
  await session.save();
  return session;
}

function requireMobileAuth() {
  return async (req, res, next) => {
    try {
      const session = await getMobileSession(req);
      if (!session) return res.status(401).json({ success: false, code: 'MOBILE_AUTH_REQUIRED', message: 'ورود موبایل لازم است.' });
      req.mobileSession = session;
      req.dbUser = session.user;
      next();
    } catch (error) { next(error); }
  };
}

module.exports = { createMobileChallenge, findChallenge, verifyMobileChallenge, consumeMobileChallenge, getMobileSession, requireMobileAuth, hashToken, safeEqual, CHALLENGE_TTL_MS, SESSION_TTL_MS };
