'use strict';
const crypto = require('crypto');

function hashNetworkIdentifier(value) {
  const input = String(value || '').trim();
  if (!input) return '';
  const secret = process.env.REFERRAL_RISK_SECRET || process.env.BOT_TOKEN || 'referral-risk-secret';
  return crypto.createHmac('sha256', secret).update(input).digest('hex');
}

function hashDeviceIdentifier(value) {
  const input = String(value || '').trim();
  if (!input) return '';
  const secret = process.env.REFERRAL_RISK_SECRET || process.env.BOT_TOKEN || 'referral-risk-secret';
  return crypto.createHmac('sha256', secret).update(`device:${input}`).digest('hex');
}

function assessReferralRisk({ referrer, signupIpHash, signupDeviceHash }) {
  const flags = [];
  let score = 0;
  if (referrer?.signupIpHash && signupIpHash && referrer.signupIpHash === signupIpHash) {
    flags.push('same_network_hash');
    score += 50;
  }
  // User-Agent یک سیگنال ضعیف است و به‌تنهایی Referral را مسدود نمی‌کند.
  if (referrer?.signupDeviceHash && signupDeviceHash && referrer.signupDeviceHash === signupDeviceHash) {
    flags.push('same_device_hash');
    score += 20;
  }
  if (referrer && referrer.isBanned) {
    flags.push('banned_referrer');
    score += 100;
  }
  return { score, flags, blocked: score >= 100 };
}

module.exports = { hashNetworkIdentifier, hashDeviceIdentifier, assessReferralRisk };
