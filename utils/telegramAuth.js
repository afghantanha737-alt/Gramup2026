'use strict';

const crypto = require('crypto');
const User = require('../models/User');
const { hashNetworkIdentifier, hashDeviceIdentifier, assessReferralRisk } = require('./referralRisk');
const { linkReferral } = require('./referralSystem');
const { referralIdentifierQuery } = require('./referralCore');
const { isVerifiedAllowedPhone } = require('./telegramPhoneContact');

const MAX_INIT_DATA_AGE_SECONDS = 24 * 60 * 60;
const MAX_INIT_DATA_LENGTH = 32 * 1024;
const MAX_USER_JSON_LENGTH = 8 * 1024;
const MAX_USER_STRING_LENGTH = 512;

function hasPlainObjectShape(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isBoundedString(value, maxLength = MAX_USER_STRING_LENGTH) {
  return typeof value === 'string' && value.length <= maxLength;
}

function parseTelegramUser(rawUser) {
  if (typeof rawUser !== 'string' || !rawUser || rawUser.length > MAX_USER_JSON_LENGTH) return null;

  let user;
  try {
    user = JSON.parse(rawUser);
  } catch {
    return null;
  }

  if (!hasPlainObjectShape(user)) return null;
  if (!Number.isSafeInteger(user.id) || user.id <= 0) return null;
  // Telegram's WebApp User schema requires first_name. Reject malformed or
  // unexpectedly typed fields instead of coercing attacker-controlled values.
  if (!isBoundedString(user.first_name) || user.first_name.length === 0 || user.first_name.length > 64) return null;
  for (const field of ['last_name', 'username', 'language_code', 'photo_url']) {
    if (Object.prototype.hasOwnProperty.call(user, field) && !isBoundedString(user[field])) return null;
  }
  for (const field of ['is_bot', 'is_premium', 'added_to_attachment_menu', 'allows_write_to_pm']) {
    if (Object.prototype.hasOwnProperty.call(user, field) && typeof user[field] !== 'boolean') return null;
  }
  return user;
}

/**
 * Validate Telegram WebApp initData using Telegram's documented HMAC-SHA256
 * construction. The signed header/body value is the only accepted Telegram
 * credential; callers must not use URL query parameters as a fallback.
 */
function verifyInitData(initData, botToken) {
  if (typeof initData !== 'string' || !initData || initData.length > MAX_INIT_DATA_LENGTH) return null;
  if (typeof botToken !== 'string' || !botToken) return null;

  let params;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return null;
  }

  const parameterNames = [...params.keys()];
  if (!parameterNames.length || new Set(parameterNames).size !== parameterNames.length) return null;

  const hash = params.get('hash');
  const authDateText = params.get('auth_date');
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash) || !/^\d{1,12}$/.test(authDateText || '')) return null;
  const authDate = Number(authDateText);
  if (!Number.isSafeInteger(authDate) || authDate <= 0) return null;

  const user = parseTelegramUser(params.get('user'));
  if (!user) return null;

  params.delete('hash');
  const pairs = [];
  for (const [key, value] of params.entries()) pairs.push(`${key}=${value}`);
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken, 'utf8').digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString, 'utf8').digest();
  const receivedHash = Buffer.from(hash, 'hex');
  if (computedHash.length !== receivedHash.length || !crypto.timingSafeEqual(computedHash, receivedHash)) return null;

  const nowSeconds = Math.floor(Date.now() / 1000);
  // A deployment environment may choose a stricter age, but can never weaken
  // Telegram's 24-hour replay bound.
  const configuredMaxAge = Number(process.env.INIT_DATA_MAX_AGE);
  const maxAgeSeconds = Number.isFinite(configuredMaxAge) && configuredMaxAge > 0
    ? Math.min(MAX_INIT_DATA_AGE_SECONDS, Math.floor(configuredMaxAge))
    : MAX_INIT_DATA_AGE_SECONDS;
  if (authDate > nowSeconds || nowSeconds - authDate > maxAgeSeconds) return null;

  return {
    user,
    startParam: params.get('start_param') || null,
    authDate
  };
}

function generateReferralCode(telegramId) {
  return `R${telegramId}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}

async function getOrCreateUser(tgUser, startParam, requestIp = '', requestUserAgent = '') {
  if (!tgUser || !tgUser.id) return null;
  const telegramId = String(tgUser.id);
  let dbUser = await User.findOne({ telegramId });
  let createdByThisRequest = false;
  const referralIdentifier = String(startParam || dbUser?.pendingReferralIdentifier || '').trim();
  const referralQuery = referralIdentifierQuery(referralIdentifier);
  let referrer = referralQuery
    ? await User.findOne(referralQuery).select('_id telegramId isBanned signupIpHash signupDeviceHash')
    : null;
  if (referrer && (referrer.isBanned || String(referrer.telegramId) === telegramId)) referrer = null;
  const referralRisk = referrer
    ? assessReferralRisk({ referrer, signupIpHash: hashNetworkIdentifier(requestIp), signupDeviceHash: hashDeviceIdentifier(requestUserAgent) })
    : { score: 0, flags: [] };

  if (!dbUser) {
    const signupIpHash = hashNetworkIdentifier(requestIp);
    const signupDeviceHash = hashDeviceIdentifier(requestUserAgent);
    try {
      dbUser = await User.create({
        telegramId,
        username: tgUser.username || '',
        firstName: tgUser.first_name || '',
        lastName: tgUser.last_name || '',
        photoUrl: tgUser.photo_url || '',
        referralCode: generateReferralCode(telegramId),
        signupIpHash,
        signupDeviceHash,
        referralRiskScore: 0,
        referralRiskFlags: []
      });
      createdByThisRequest = true;
    } catch (error) {
      if (error?.code !== 11000) throw error;
      dbUser = await User.findOne({ telegramId });
      if (!dbUser) throw error;
    }
  }
  if (!createdByThisRequest) {
    let changed = false;
    if (tgUser.username && tgUser.username !== dbUser.username) {
      dbUser.username = tgUser.username;
      changed = true;
    }
    if (tgUser.first_name && tgUser.first_name !== dbUser.firstName) {
      dbUser.firstName = tgUser.first_name;
      changed = true;
    }
    if (tgUser.last_name && tgUser.last_name !== dbUser.lastName) {
      dbUser.lastName = tgUser.last_name;
      changed = true;
    }
    if (tgUser.photo_url && tgUser.photo_url !== dbUser.photoUrl) {
      dbUser.photoUrl = tgUser.photo_url;
      changed = true;
    }
    if (dbUser.telegramBlockedAt) {
      dbUser.telegramBlockedAt = null;
      changed = true;
    }
    if (changed) await dbUser.save();
  }

  const isFreshAccount = dbUser.createdAt && Date.now() - new Date(dbUser.createdAt).getTime() < 24 * 60 * 60 * 1000;
  if (!dbUser.referredBy && referrer && (isFreshAccount || Boolean(dbUser.pendingReferralIdentifier))) {
    if (isVerifiedAllowedPhone(dbUser)) {
      await linkReferral({
        referredUserId: dbUser._id,
        referrerId: referrer._id,
        riskScore: referralRisk.score,
        riskFlags: referralRisk.flags,
        source: 'signup'
      });
      if (dbUser.pendingReferralIdentifier) {
        await User.updateOne({ _id: dbUser._id }, { $set: { pendingReferralIdentifier: '' } });
      }
      dbUser = await User.findById(dbUser._id);
    } else if (startParam && !dbUser.pendingReferralIdentifier) {
      dbUser.pendingReferralIdentifier = String(startParam).slice(0, 64);
      await dbUser.save();
    }
  }

  return dbUser;
}

function isPhoneVerificationBootstrapRequest(req) {
  const path = String(req.originalUrl || '').split('?')[0].replace(/\/$/, '');
  return new Set([
    'GET /api/auth/me',
    'PATCH /api/auth/language',
    'POST /api/auth/request-phone-contact'
  ]).has(`${req.method} ${path}`);
}

function getTelegramCredential(req) {
  const headerValue = req.get('X-Telegram-Init-Data') || '';
  const bodyValue = req.body && req.body.initData;
  if (headerValue && bodyValue != null && String(bodyValue) !== headerValue) return null;
  return headerValue || (typeof bodyValue === 'string' ? bodyValue : '');
}

function requireTelegramAuth(botToken) {
  return async function telegramAuthMiddleware(req, res, next) {
    try {
      const initData = getTelegramCredential(req);
      const verified = verifyInitData(initData, botToken);

      if (!verified || !verified.user) {
        return res.status(401).json({ success: false, message: 'احراز هویت تلگرام نامعتبر است.' });
      }

      const dbUser = await getOrCreateUser(verified.user, verified.startParam || req.query.ref || '', req.ip, req.get('user-agent') || '');
      if (!dbUser) {
        return res.status(401).json({ success: false, message: 'کاربر شناسایی نشد.' });
      }
      if (dbUser.isBanned) {
        return res.status(403).json({ success: false, message: 'حساب شما محدود شده است.' });
      }

      req.tgUser = verified.user;
      req.dbUser = dbUser;
      req.telegramStartParam = verified.startParam || '';
      if (!isVerifiedAllowedPhone(dbUser) && !isPhoneVerificationBootstrapRequest(req)) {
        return res.status(403).json({
          success: false,
          code: 'PHONE_VERIFICATION_REQUIRED',
          message: 'برای ادامه، Contact تلگرام خود را با شمارهٔ +93 یا +98 تأیید کنید.'
        });
      }
      next();
    } catch (error) {
      console.error('Telegram auth error:', error);
      res.status(500).json({ success: false, message: 'خطا در احراز هویت.' });
    }
  };
}

module.exports = {
  verifyInitData,
  getOrCreateUser,
  requireTelegramAuth,
  generateReferralCode,
  MAX_INIT_DATA_AGE_SECONDS
};
