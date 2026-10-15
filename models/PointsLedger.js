'use strict';
const mongoose = require('mongoose');

/**
 * هر ردیف این کالکشن یک رویداد تغییر موجودی (پوینت یا GRAM) کاربر است.
 * هدف: صفحه‌ی «تاریخچه‌ی تراکنش‌ها» در پروفایل کاربر — که نشان می‌دهد
 * امتیازش دقیقاً از کجا آمده و کجا خرج شده، بدون نیاز به حدس زدن از
 * روی چند کالکشن جدا (Task/Withdrawal/...).
 */
const pointsLedgerSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: {
      type: String,
      enum: [
        'task',            // پاداش تکمیل تسک
        'checkin',         // پاداش ورود روزانه
        'ad_reward',       // پاداش تماشای اختیاری تبلیغ AdsGram
        'spin',            // برد پوینت از گردونه شانس
        'referral_bonus',  // پاداش دعوت دوست (وقتی دعوت‌شده به حد نصاب تسک برسد)
        'referral_initial', // پاداش اولیه‌ی اتصال Referral
        'referral_commission', // کمیسیون چندسطحی بر درآمد اصلی
        'leaderboard_reward', // جایزه رتبه برتر leaderboard هفتگی
        'exchange_out',    // کسر شده در تبدیل (پوینت->GRAM یا GRAM->پوینت)
        'exchange_in',     // اضافه شده در تبدیل
        'withdraw',        // کسر GRAM بابت درخواست برداشت
        'deposit',         // واریز تاییدشده GRAM روی TON Mainnet
        'vip_purchase',    // خرید اشتراک VIP با پوینت
        'vip_daily_reward', // پاداش روزانه‌ی دوره VIP
        'vip_principal_return', // بازگشت اصل پوینت پس از پایان دوره VIP
        'admin_adjust'     // اصلاح دستی توسط ادمین (مثلاً بازگشت وجه بعد از رد برداشت)
      ],
      required: true
    },
    currency: { type: String, enum: ['points', 'gram'], default: 'points' },
    // مقدار با علامت: مثبت یعنی اضافه شدن، منفی یعنی کسر شدن
    amount: { type: Number, required: true },
    // شناسه یکتای اختیاری برای جلوگیری از ثبت دوباره‌ی یک رویداد مالی
    sourceId: { type: String, default: undefined },
    transactionId: { type: String, default: undefined },
    referralLevel: { type: Number, default: null, min: 1, max: 10 },
    sourceUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    recipientUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    commissionRatePercent: { type: Number, default: null, min: 0, max: 100 },
    earningTransactionId: { type: String, default: '' },
    description: { type: String, default: '' },
    // موجودی همان ارز بلافاصله بعد از این رویداد (برای نمایش در UI، اختیاری)
    balanceAfter: { type: Number, default: null }
  },
  { timestamps: true }
);

pointsLedgerSchema.index({ user: 1, createdAt: -1 });
pointsLedgerSchema.index({ createdAt: 1, currency: 1, type: 1 });
pointsLedgerSchema.index({ user: 1, currency: 1, createdAt: 1 });
pointsLedgerSchema.index({ currency: 1, type: 1, createdAt: 1 });
pointsLedgerSchema.index({ sourceId: 1 }, { unique: true, sparse: true });
pointsLedgerSchema.index({ transactionId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('PointsLedger', pointsLedgerSchema);
