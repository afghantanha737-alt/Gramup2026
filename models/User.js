'use strict';
const mongoose = require('mongoose');
const referralRewardClaimSchema = require('./ReferralRewardClaim');

const userSchema = new mongoose.Schema(
  {
    telegramId: { type: String, required: true, unique: true, index: true },
    username: { type: String, default: '' },
    firstName: { type: String, default: '' },
    lastName: { type: String, default: '' },
    photoUrl: { type: String, default: '' },

    points: { type: Number, default: 0, min: 0 },
    gramBalance: { type: Number, default: 0, min: 0 },
    streak: { type: Number, default: 0, min: 0 },
    totalCheckins: { type: Number, default: 0, min: 0 },
    lastCheckIn: { type: Date, default: null },

    // AdsGram rewarded ads (optional, user-initiated)
    adViewsDayKey: { type: Number, default: null },
    adViewsToday: { type: Number, default: 0, min: 0 },
    lastAdRewardAt: { type: Date, default: null },
    totalAdViews: { type: Number, default: 0, min: 0 },
    miningBoostExpiresAt: { type: Date, default: null },

    referralCode: { type: String, required: true, unique: true, index: true },
    referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    referralInitialRewardEligible: { type: Boolean, default: false },
    accountReviewStatus: { type: String, enum: ['normal', 'under_review', 'restricted', 'fraud_review'], default: 'normal', index: true },
    // فقط HMAC هش شبکه ذخیره می‌شود؛ IP خام هرگز در دیتابیس ثبت نمی‌شود.
    signupIpHash: { type: String, default: '' },
    referralRiskScore: { type: Number, default: 0, min: 0 },
    referralRiskFlags: { type: [String], default: [] },
    referralRiskBlocked: { type: Boolean, default: false },
    invitedCount: { type: Number, default: 0, min: 0 },
    // دعوت‌شده‌ای که حداقل یک تسک approved تکمیل کرده است
    activeInvitedCount: { type: Number, default: 0, min: 0 },
    // برای جلوگیری از افزایش دوباره activeInvitedCount در درخواست‌های هم‌زمان
    activeReferralIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: [] },
    // فقط برای سازگاری با رکوردهای قدیمی؛ پاداش ثابت ۵۰ در Referral v2 غیرفعال است.
    referralBonusAwarded: { type: Boolean, default: false },
    // وضعیت اعتبار Referral دعوت‌شده: تا تکمیل ۳ تسک، ۲ روز فعالیت و ۷ روز انتظار، pending است.
    referralEligibilityStatus: { type: String, enum: ['pending', 'eligible', 'blocked'], default: 'pending', index: true },
    referralEligibilityReasons: { type: [String], default: [] },
    referralEligibleAt: { type: Date, default: null },
    // claimهای مرحله‌ای دعوت دوستان؛ شرط یکتا در findOneAndUpdate سمت API
    // تضمین می‌کند هر مرحله فقط یک‌بار قابل دریافت باشد.
    referralRewardClaims: { type: [referralRewardClaimSchema], default: [] },

    walletAddress: { type: String, default: '' },
    language: { type: String, enum: ['fa', 'ps', 'en'], default: 'fa' },
    isBanned: { type: Boolean, default: false },
    // اگر تلگرام 403 بدهد (ربات بلاک شده یا حساب غیرفعال است)، از ارسال‌های بعدی حذف می‌شود.
    telegramBlockedAt: { type: Date, default: null },
    // آخرین باری که یادآوری ورود روزانه برایش ارسال شد (برای جلوگیری از ارسال تکراری در همان روز)
    lastReminderSentAt: { type: Date, default: null }
  },
  { timestamps: true }
);

userSchema.index({ isBanned: 1, points: -1 });
userSchema.index({ isBanned: 1, createdAt: -1 });
userSchema.index({ referralRiskScore: -1, createdAt: -1 });
userSchema.index({ referredBy: 1, createdAt: -1 });
userSchema.index({ referredBy: 1, referralEligibilityStatus: 1, createdAt: -1 });
userSchema.index({ isBanned: 1, telegramBlockedAt: 1 });

module.exports = mongoose.model('User', userSchema);
