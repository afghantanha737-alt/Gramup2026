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
        'daily_chest',     // صندوق پاداش روزانه
        'ad_reward',       // legacy historical records; new ad rewards are disabled
        'spin',            // برد پوینت از گردونه شانس
        'mining_claim',    // تسویه‌ی پوینت استخراج‌شده
        'mining_upgrade',  // هزینه‌ی ارتقای ماینر
        'referral_bonus',  // پاداش دعوت دوست (وقتی دعوت‌شده به حد نصاب تسک برسد)
        'referral_initial', // پاداش اولیه‌ی اتصال Referral
        'referral_welcome', // welcome credit created by the retention flow
        'referral_commission', // کمیسیون چندسطحی بر درآمد اصلی
        'leaderboard_reward', // جایزه رتبه برتر leaderboard هفتگی
        'exchange_out',    // کسر شده در تبدیل (پوینت->GRAM یا GRAM->پوینت)
        'exchange_in',     // اضافه شده در تبدیل
        'withdraw',        // کسر GRAM بابت درخواست برداشت
        'deposit',         // واریز تاییدشده GRAM روی TON Mainnet
        'vip_purchase',    // خرید اشتراک VIP با پوینت
        'vip_daily_principal', // پرداخت روزانه اصل سرمایه از Reserve VIP
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

const IMMUTABLE_ERROR = 'PointsLedger records are append-only and cannot be mutated.';

function rejectMutation(next) {
  const error = new Error(IMMUTABLE_ERROR);
  error.code = 'POINTS_LEDGER_APPEND_ONLY';
  next(error);
}

// Ledger history is an accounting record. Updates/deletes must be represented
// by a new signed entry (for example, an admin adjustment), never by rewriting
// history. Collection-level Mongo privileges are still required to prevent a
// privileged raw-driver writer from bypassing these application hooks.
for (const method of [
  'updateOne', 'updateMany', 'findOneAndUpdate', 'findByIdAndUpdate',
  'replaceOne', 'findOneAndReplace', 'findOneAndDelete', 'findByIdAndDelete',
  'deleteOne', 'deleteMany', 'findOneAndRemove', 'remove'
]) {
  pointsLedgerSchema.pre(method, rejectMutation);
}

pointsLedgerSchema.pre('bulkWrite', function rejectBulkMutation(next, operations) {
  const mutating = (operations || []).some(operation => {
    const name = Object.keys(operation || {})[0];
    return name && name !== 'insertOne';
  });
  if (mutating) return rejectMutation(next);
  return next();
});

pointsLedgerSchema.pre('save', function rejectResave(next) {
  if (!this.isNew) return rejectMutation(next);
  return next();
});

pointsLedgerSchema.statics.APPEND_ONLY_ERROR = IMMUTABLE_ERROR;

module.exports = mongoose.model('PointsLedger', pointsLedgerSchema);
