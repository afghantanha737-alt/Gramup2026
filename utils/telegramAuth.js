'use strict';

const crypto = require('crypto');
const User = require('../models/User');
const { hashNetworkIdentifier, hashDeviceIdentifier, assessReferralRisk } = require('./referralRisk');
const { linkReferral } = require('./referralSystem');
const { referralIdentifierQuery } = require('./referralCore');
const { isVerifiedAllowedPhone } = require('./telegramPhoneContact');

/**
 * initData ارسالی از Telegram WebApp را طبق مستندات رسمی تلگرام
 * با استفاده از HMAC-SHA256 اعتبارسنجی می‌کند.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-web-app
 */
function verifyInitData(initData, botToken) {
  if (!initData || typeof initData !== 'string' || !botToken) return null;

  const params = new URLSearchParams(initData);
  const parameterNames = [...params.keys()];
  if (new Set(parameterNames).size !== parameterNames.length) return null;
  const hash = params.get('hash');
  const authDateText = params.get('auth_date');
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash) || !/^\d{1,12}$/.test(authDateText || '')) return null;
  const authDate = Number(authDateText);
  if (!Number.isSafeInteger(authDate) || authDate <= 0) return null;
  params.delete('hash');

  const pairs = [];
  for (const [key, value] of params.entries()) {
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const expected = Buffer.from(computedHash, 'hex');
  const received = Buffer.from(hash, 'hex');
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) return null;

  const configuredMaxAge = Number(process.env.INIT_DATA_MAX_AGE || 86400);
  const maxAgeSeconds = Number.isFinite(configuredMaxAge) && configuredMaxAge > 0 ? configuredMaxAge : 86400;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (nowSeconds - authDate > maxAgeSeconds || authDate > nowSeconds) return null;

  let user = null;
  try {
    user = JSON.parse(params.get('user') || 'null');
  } catch {
    user = null;
  }
  if (!user || typeof user !== 'object' || !Number.isSafeInteger(Number(user.id)) || Number(user.id) <= 0) return null;

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
      // Two tabs can authenticate the same new Telegram account concurrently;
      // the unique telegramId index chooses one creator, and the other reloads it.
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

  // لینک start_param در تلگرام ممکن است در اولین درخواست به‌علت موقت‌بودن
  // دیتابیس کامل نشود؛ لینک تا تأیید Contact در حساب تازه نگهداری می‌شود.
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

function requireTelegramAuth(botToken) {
  return async function telegramAuthMiddleware(req, res, next) {
    try {
      const initData = req.get('X-Telegram-Init-Data') || req.query.initData || (req.body && req.body.initData) || '';
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
  generateReferralCode
};
