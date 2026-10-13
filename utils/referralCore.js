'use strict';

const crypto = require('crypto');

const MAX_REFERRAL_LEVELS = 10;
const DEFAULT_REFERRAL_LEVEL_RATES = Object.freeze([10, 5, 3, 1, 1, 1, 1, 1, 1, 1]);
const DEFAULT_REFERRAL_INITIAL_REWARD_POINTS = 10;
const ELIGIBLE_ORIGINAL_EARN_TYPES = Object.freeze(['task', 'checkin', 'leaderboard_reward']);
const eligibleEarnTypes = new Set(ELIGIBLE_ORIGINAL_EARN_TYPES);

function normalizeReferralRates(value) {
  if (value == null || (Array.isArray(value) && value.length === 0)) return [...DEFAULT_REFERRAL_LEVEL_RATES];
  if (!Array.isArray(value) || value.length > MAX_REFERRAL_LEVELS) {
    throw new TypeError(`Referral rates must contain 1-${MAX_REFERRAL_LEVELS} values.`);
  }

  const rates = value.map(Number);
  if (rates.some(rate => !Number.isFinite(rate) || rate < 0 || rate > 100)) {
    throw new TypeError('Referral rates must be finite values between 0 and 100.');
  }

  // The former shipped default was [10, 5, 3, 2]. Convert only that known
  // legacy default in memory; no database write or balance adjustment occurs.
  const wasLegacyDefault = rates.length === 4 && rates[0] === 10 && rates[1] === 5 && rates[2] === 3 && rates[3] === 2;
  if (wasLegacyDefault) return [...DEFAULT_REFERRAL_LEVEL_RATES];

  const expected = [10, 5, 3, 1];
  for (let index = 0; index < Math.min(rates.length, expected.length); index += 1) {
    if (rates[index] !== expected[index]) {
      throw new TypeError('Referral commission rates are fixed at 10%, 5%, 3%, and 1% for Level 4+.');
    }
  }
  for (let index = 4; index < rates.length; index += 1) {
    if (rates[index] !== 1) {
      throw new TypeError('Referral commission rates are fixed at 1% for Level 4 and deeper.');
    }
  }

  // New and existing referrals can use the full depth without requiring a
  // settings migration. Every configured depth after Level 3 defaults to 1%.
  return [...DEFAULT_REFERRAL_LEVEL_RATES];
}

function createSignedReferralIdentifier(telegramId, secret = process.env.REFERRAL_LINK_SECRET || process.env.BOT_TOKEN || '') {
  const id = String(telegramId || '').trim();
  if (!/^\d{1,20}$/.test(id) || !secret) return '';
  const signature = crypto.createHmac('sha256', String(secret)).update(`gramup:referral:v1:${id}`).digest('hex').slice(0, 24);
  return `${id}_${signature}`;
}

function createMiniAppReferralLink(botUsername, telegramId) {
  const bot = String(botUsername || '').trim().replace(/^@/, '');
  const id = String(telegramId || '').trim();
  if (!/^[A-Za-z0-9_]{5,32}$/.test(bot) || !/^\d{1,20}$/.test(id)) return '';
  return `https://t.me/${bot}?startapp=${encodeURIComponent(id)}`;
}

function referralIdentifierQuery(value, secret = process.env.REFERRAL_LINK_SECRET || process.env.BOT_TOKEN || '') {
  let identifier = String(value || '').trim();
  if (identifier.startsWith('ref_')) identifier = identifier.slice(4);
  const signedTelegramId = /^(\d{1,20})_([a-f\d]{24})$/i.exec(identifier);
  if (signedTelegramId && secret) {
    const expected = createSignedReferralIdentifier(signedTelegramId[1], secret).split('_')[1];
    const receivedBuffer = Buffer.from(signedTelegramId[2].toLowerCase(), 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    if (receivedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(receivedBuffer, expectedBuffer)) {
      return { telegramId: signedTelegramId[1] };
    }
    return null;
  }
  if (/^\d{1,20}$/.test(identifier)) return { telegramId: identifier };
  if (/^[a-z\d]{1,64}$/i.test(identifier)) return { referralCode: identifier.toUpperCase() };
  return null;
}

function isEligibleOriginalEarn({ type, currency = 'points', amount } = {}) {
  return currency === 'points' && eligibleEarnTypes.has(type) && Number.isFinite(Number(amount)) && Number(amount) > 0;
}

function calculateReferralCommission(originalEarnedPoints, ratePercent) {
  const amount = Math.floor(Number(originalEarnedPoints) * Number(ratePercent) / 100);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function reviewStatusOf(user = {}) {
  const status = ['normal', 'under_review', 'restricted', 'fraud_review'].includes(user.accountReviewStatus)
    ? user.accountReviewStatus
    : 'normal';
  if (user.isBanned || user.referralRiskBlocked || Number(user.referralRiskScore || 0) >= 50) return 'blocked';
  return status === 'normal' ? 'active' : status;
}

module.exports = {
  DEFAULT_REFERRAL_LEVEL_RATES,
  DEFAULT_REFERRAL_INITIAL_REWARD_POINTS,
  MAX_REFERRAL_LEVELS,
  ELIGIBLE_ORIGINAL_EARN_TYPES,
  normalizeReferralRates,
  createSignedReferralIdentifier,
  createMiniAppReferralLink,
  referralIdentifierQuery,
  isEligibleOriginalEarn,
  calculateReferralCommission,
  reviewStatusOf
};
