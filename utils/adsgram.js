'use strict';
/**
 * AdsGram — تبلیغات پاداش‌دار (Rewarded) داخل تب «روزانه».
 *
 * قوانین (مطابق https://docs.adsgram.ai/publisher/moderation):
 *  - تماشای تبلیغ کاملاً اختیاری است؛ هیچ امکان اصلی برنامه به تبلیغ وابسته نیست.
 *  - تبلیغ فقط بعد از کلیک کاربر روی دکمه «تماشای تبلیغ» نمایش داده می‌شود.
 *  - پاداش کم و واقعی است و سقف روزانه + فاصله‌ی زمانی بین دو پاداش دارد.
 *
 * تنظیمات از متغیرهای محیطی خوانده می‌شود (فایل .env):
 *  ADSGRAM_BLOCK_ID            شناسه بلاک Reward از partner.adsgram.ai (فقط عدد، مثلاً 12345)
 *  ADSGRAM_REWARD_POINTS       پاداش هر تماشای کامل (پیش‌فرض 5)
 *  ADSGRAM_DAILY_LIMIT         سقف تعداد پاداش در هر روز UTC (پیش‌فرض 10)
 *  ADSGRAM_COOLDOWN_SECONDS    حداقل فاصله بین دو پاداش (پیش‌فرض 30)
 *  ADSGRAM_REWARD_SECRET       اختیاری: اگر تنظیم شود، پاداش فقط از طریق Reward URL سرور AdsGram داده می‌شود
 */
const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/User');
const { recordLedgerRequired } = require('./ledger');
const { withMongoTransaction } = require('./mongoTransaction');

function intEnv(name, fallback, min, max) {
  const value = Number.parseInt(process.env[name], 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function getAdsConfig() {
  const blockId = String(process.env.ADSGRAM_BLOCK_ID || '').trim();
  return {
    blockId,
    enabled: /^[0-9]+$/.test(blockId),
    miningBlockId: String(process.env.ADSGRAM_MINING_BLOCK_ID || '').trim(),
    miningEnabled: /^[0-9]+$/.test(String(process.env.ADSGRAM_MINING_BLOCK_ID || '').trim()) && Boolean(String(process.env.ADSGRAM_REWARD_SECRET || '').trim()),
    rewardPoints: intEnv('ADSGRAM_REWARD_POINTS', 5, 1, 1000),
    dailyLimit: intEnv('ADSGRAM_DAILY_LIMIT', 10, 1, 100),
    cooldownSeconds: intEnv('ADSGRAM_COOLDOWN_SECONDS', 30, 0, 3600),
    rewardSecret: String(process.env.ADSGRAM_REWARD_SECRET || '').trim()
  };
}

function utcDayKey(date = new Date()) {
  return Math.floor(new Date(date).getTime() / 86400000);
}

function adsStateForUser(user, now = new Date()) {
  const config = getAdsConfig();
  const today = utcDayKey(now);
  const watchedToday = user && user.adViewsDayKey === today ? Number(user.adViewsToday) || 0 : 0;
  const last = user && user.lastAdRewardAt ? new Date(user.lastAdRewardAt).getTime() : 0;
  const nextAvailableAt = last ? last + config.cooldownSeconds * 1000 : 0;
  return {
    enabled: config.enabled,
    blockId: config.enabled ? config.blockId : '',
    miningEnabled: config.miningEnabled,
    miningBlockId: config.miningEnabled ? config.miningBlockId : '',
    rewardPoints: config.rewardPoints,
    dailyLimit: config.dailyLimit,
    watchedToday,
    remainingToday: Math.max(0, config.dailyLimit - watchedToday),
    cooldownSeconds: config.cooldownSeconds,
    nextAvailableAt: nextAvailableAt > now.getTime() ? nextAvailableAt : 0,
    serverRewardMode: Boolean(config.rewardSecret)
  };
}

function adsError(code, message, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

/** پاداش یک تماشای کامل را به‌صورت اتمیک ثبت می‌کند (سقف روزانه و cooldown رعایت می‌شود). */
async function grantAdReward(userId, source = 'client') {
  const config = getAdsConfig();
  if (!config.enabled) throw adsError('ADS_DISABLED', 'تبلیغات فعال نیست.', 400);
  if (!mongoose.isValidObjectId(userId)) throw adsError('USER_NOT_FOUND', 'کاربر پیدا نشد.', 404);

  return withMongoTransaction(async session => {
    const now = new Date();
    const today = utcDayKey(now);
    const current = await User.findById(userId).session(session);
    if (!current) throw adsError('USER_NOT_FOUND', 'کاربر پیدا نشد.', 404);

    const watchedToday = current.adViewsDayKey === today ? Number(current.adViewsToday) || 0 : 0;
    if (watchedToday >= config.dailyLimit) {
      throw adsError('ADS_DAILY_LIMIT', 'سقف پاداش تبلیغات امروز تمام شده است.', 429);
    }
    const lastAt = current.lastAdRewardAt ? new Date(current.lastAdRewardAt).getTime() : 0;
    if (lastAt && now.getTime() - lastAt < config.cooldownSeconds * 1000) {
      throw adsError('ADS_COOLDOWN', 'کمی صبر کنید و دوباره تلاش کنید.', 429);
    }

    const updated = await User.findOneAndUpdate(
      { _id: current._id, lastAdRewardAt: current.lastAdRewardAt || null },
      {
        $set: { adViewsDayKey: today, adViewsToday: watchedToday + 1, lastAdRewardAt: now },
        $inc: { points: config.rewardPoints, totalAdViews: 1 }
      },
      { new: true, session }
    );
    if (!updated) throw adsError('ADS_COOLDOWN', 'کمی صبر کنید و دوباره تلاش کنید.', 429);

    await recordLedgerRequired({
      user: updated._id,
      type: 'ad_reward',
      amount: config.rewardPoints,
      description: 'پاداش تماشای تبلیغ (AdsGram)',
      balanceAfter: updated.points,
      sourceId: `ad:${updated._id}:${today}:${watchedToday + 1}`,
      session
    });
    return { user: updated, earned: config.rewardPoints, source };
  });
}

/** بوست ماینینگ فقط از callback سروریِ احراز‌شده اعطا می‌شود؛ endpoint کلاینت اعتبار ندارد. */
async function grantMiningBoost(userId, source = 'adsgram') {
  const config = getAdsConfig();
  if (!config.miningEnabled) throw adsError('ADS_DISABLED', 'جایگاه امن تبلیغ Mining فعال نیست.', 400);
  if (!config.rewardSecret) throw adsError('ADS_REWARD_VERIFICATION_REQUIRED', 'تأیید سروری AdsGram برای بوست تنظیم نشده است.', 503);
  if (!mongoose.isValidObjectId(userId)) throw adsError('USER_NOT_FOUND', 'کاربر پیدا نشد.', 404);

  return withMongoTransaction(async session => {
    const now = new Date();
    const today = utcDayKey(now);
    const current = await User.findById(userId).session(session);
    if (!current) throw adsError('USER_NOT_FOUND', 'کاربر پیدا نشد.', 404);
    const watchedToday = current.adViewsDayKey === today ? Number(current.adViewsToday) || 0 : 0;
    if (watchedToday >= config.dailyLimit) throw adsError('ADS_DAILY_LIMIT', 'سقف پاداش تبلیغات امروز تمام شده است.', 429);
    const lastAt = current.lastAdRewardAt ? new Date(current.lastAdRewardAt).getTime() : 0;
    if (lastAt && now.getTime() - lastAt < config.cooldownSeconds * 1000) {
      throw adsError('ADS_COOLDOWN', 'کمی صبر کنید و دوباره تلاش کنید.', 429);
    }
    const oldExpiry = current.miningBoostExpiresAt ? new Date(current.miningBoostExpiresAt).getTime() : 0;
    if (oldExpiry > now.getTime()) throw adsError('ADS_BOOST_ACTIVE', 'بوست ماینینگ از قبل فعال است.', 409);

    const updated = await User.findOneAndUpdate(
      { _id: current._id, lastAdRewardAt: current.lastAdRewardAt || null, miningBoostExpiresAt: current.miningBoostExpiresAt || null },
      {
        $set: {
          adViewsDayKey: today,
          adViewsToday: watchedToday + 1,
          lastAdRewardAt: now,
          miningBoostExpiresAt: new Date(now.getTime() + 30 * 60 * 1000)
        },
        $inc: { totalAdViews: 1 }
      },
      { new: true, session }
    );
    if (!updated) throw adsError('ADS_COOLDOWN', 'درخواست تبلیغ تکراری بود؛ وضعیت را تازه کنید.', 409);
    return { user: updated, boostExpiresAt: updated.miningBoostExpiresAt, source };
  });
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (!left.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

module.exports = { getAdsConfig, adsStateForUser, grantAdReward, grantMiningBoost, safeEqual, utcDayKey };
