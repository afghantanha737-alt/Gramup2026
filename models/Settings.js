'use strict';
const mongoose = require('mongoose');
const { DEFAULT_REFERRAL_LEVEL_RATES, DEFAULT_REFERRAL_INITIAL_REWARD_POINTS } = require('../utils/referralCore');

const settingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: 'global' },
    rate: { type: Number, default: 0.0001 },
    minWithdrawPoints: { type: Number, default: 1000 },
    dailyCheckInPoints: { type: Number, default: 10 },
    streakBonusPoints: { type: Number, default: 2 },
    gramUsdPrice: { type: Number, default: 0, min: 0 },
    // Retained for compatibility; v4 only credits on an authenticated manual Claim.
    dailyAutoCheckinEnabled: { type: Boolean, default: false },
    dailyReminderEnabled: { type: Boolean, default: true },
    dailyReminderHourUtc: { type: Number, default: 2, min: 0, max: 23 },
    dailyReminderMinuteUtc: { type: Number, default: 30, min: 0, max: 59 },
    dailyReminderTimezone: { type: String, default: 'Asia/Kabul' },
    dailyReminderLocalHour: { type: Number, default: 7, min: 0, max: 23 },
    dailyReminderLocalMinute: { type: Number, default: 0, min: 0, max: 59 },
    dailyReminderPolicyVersion: { type: Number, default: 4, min: 1 },
    dailyReminderAudience: { type: String, enum: ['all', 'active'], default: 'all' },
    dailyReminderMessage: { type: String, default: '' },
    dailyReminderLastRunAt: { type: Date, default: null },
    dailyReminderLastSentCount: { type: Number, default: 0 },
    dailyReminderLastFailedCount: { type: Number, default: 0 },
    dailyAutoCheckinLastCreditedCount: { type: Number, default: 0, min: 0 },
    dailyAutoCheckinLastCreditedPoints: { type: Number, default: 0, min: 0 },
    dailyAutoCheckinLastFailedCount: { type: Number, default: 0, min: 0 },
    dailyAutoCheckinLastAlreadyClaimedCount: { type: Number, default: 0, min: 0 },
    dailyAutoCheckinLastBannedCount: { type: Number, default: 0, min: 0 },
    dailyReminderLastStatus: { type: String, default: '' },
    dailyReminderLastError: { type: String, default: '' },
    weeklyLeaderboardEnabled: { type: Boolean, default: true },
    weeklyLeaderboardPrizes: { type: [Number], default: () => [500, 250, 100] },
    // حالت تعمیرات برای محیط‌های تست/به‌روزرسانی؛ کاربران مجاز همچنان می‌توانند وارد شوند.
    maintenanceEnabled: { type: Boolean, default: false },
    maintenanceAllowedTelegramIds: { type: [String], default: () => [] },
    // Native GRAM deposits stay disabled until an administrator supplies the project's TON Mainnet wallet.
    depositEnabled: { type: Boolean, default: false },
    depositNetwork: { type: String, enum: ['TON_MAINNET'], default: 'TON_MAINNET' },
    depositWalletAddress: { type: String, default: '' },
    minimumDepositGram: { type: Number, default: 1, min: 0 },
    // Fixed by the current referral policy; retained for backwards compatibility.
    referralInitialRewardPoints: { type: Number, default: DEFAULT_REFERRAL_INITIAL_REWARD_POINTS, min: 0, max: 1000000 },
    // A newly accepted invitee receives this one-time welcome credit; zero disables it.
    referralWelcomeRewardPoints: { type: Number, default: 5, min: 0, max: 1000000 },
    referralLevelRates: { type: [Number], default: () => [...DEFAULT_REFERRAL_LEVEL_RATES] },
    // VIP v2 is enabled only by the controlled migration after Reserve readiness review.
    vipPolicyVersion: { type: String, enum: ['legacy_v1', 'v2_100d'], default: 'legacy_v1' },
    vipPolicyEffectiveAt: { type: Date, default: null },
    vipNewPurchasesEnabled: { type: Boolean, default: false },
    vipPayoutsEnabled: { type: Boolean, default: false },
    luckySpinEnabled: { type: Boolean, default: true },
    luckySpinRequiredStreak: { type: Number, default: 7, min: 7, max: 365 },
    // Legacy settings may still contain 24; spinPolicy ignores cooldown and admin writes accept only 0.
    luckySpinCooldownHours: { type: Number, default: 0, min: 0, max: 24 },
    luckySpinPrizes: {
      type: [{ _id: false, id: String, kind: { type: String, enum: ['points', 'gram', 'boost', 'none'] }, amount: { type: Number, min: 0 }, label: { type: String, default: '' }, probability: { type: Number, min: 0, max: 100 } }],
      default: () => [
        { id: 'hashrate_boost_10_1h', kind: 'boost', amount: 10, label: '10% Mining Hashrate Boost · 1h', probability: 35 },
        { id: 'up_50', kind: 'points', amount: 50, label: '+50 UP', probability: 25 },
        { id: 'up_100', kind: 'points', amount: 100, label: '+100 UP', probability: 15 },
        { id: 'up_250', kind: 'points', amount: 250, label: '+250 UP', probability: 10 },
        { id: 'gram_005', kind: 'gram', amount: 0.05, label: '+0.05 GRAM', probability: 5 },
        { id: 'try_again', kind: 'none', amount: 0, label: 'Try Again', probability: 10 }
      ]
    }
  },
  { timestamps: true }
);

settingsSchema.statics.getGlobal = async function getGlobal() {
  let doc = await this.findOne({ key: 'global' });
  if (!doc) doc = await this.create({ key: 'global' });
  return doc;
};

module.exports = mongoose.model('Settings', settingsSchema);
