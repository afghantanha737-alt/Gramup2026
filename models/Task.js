'use strict';
const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    type: {
      type: String,
      enum: ['channel', 'group', 'link', 'custom'],
      default: 'link'
    },
    // 'telegram' => بررسی خودکار عضویت با ربات (نیاز به chatId)
    // 'manual'   => کاربر باید اسکرین‌شات بفرستد و ادمین تأیید کند
    verifyType: {
      type: String,
      enum: ['telegram', 'manual', 'latest_post'],
      default: 'telegram'
    },
    // Telegram Chat ID/username به‌صورت String نگهداری می‌شود تا تبدیل عددی نداشته باشد.
    // Latest Post فقط ID عددی می‌خواهد؛ هیچ پیشوند خاصی در schema اجباری نیست.
    chatId: { type: String, default: '' },
    url: { type: String, default: '' },
    // Latest Post Engagement: post IDs are observed from Telegram channel_post updates.
    requiredReaction: { type: String, default: '' },
    // System tasks are completed by a verified backend event, not by Telegram membership.
    taskKind: { type: String, enum: ['standard', 'vip_activation', 'bio_link'], default: 'standard', index: true },
    vipPlanNumber: { type: Number, min: 1, max: 10, default: null },
    cooldownHours: { type: Number, default: 3, min: 1, max: 720 },
    latestPostMessageId: { type: Number, default: null },
    latestPostDate: { type: Date, default: null },
    latestPostUpdateId: { type: Number, default: null },
    reward: { type: Number, required: true, min: 0 },
    // null یعنی بدون محدودیت ظرفیت. اگر عدد باشد، فقط همین تعداد اول
    // که تسک را با موفقیت کامل می‌کنند پاداش می‌گیرند.
    maxCompletions: { type: Number, default: null, min: 1 },
    // تعداد تکمیل‌های موفق (approved) — به‌صورت atomic در routes/tasks.js افزایش می‌یابد
    completedCount: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
    // تسک ویژه‌ی امروز؛ در لیست کاربر قبل از تسک‌های عادی نمایش داده می‌شود.
    isSpecialOfDay: { type: Boolean, default: false },

    // ---- تسک اسپانسری (درآمد): تبلیغ‌دهنده برای هر عضو تاییدشده مبلغی می‌پردازد ----
    isSponsored: { type: Boolean, default: false },
    sponsorName: { type: String, default: '', trim: true },
    sponsorPriceUsd: { type: Number, default: 0, min: 0 }, // دریافتی از تبلیغ‌دهنده به‌ازای هر عضو (دلار) — به کاربر نمایش داده نمی‌شود
    sponsorBudgetUsd: { type: Number, default: 0, min: 0 }, // بودجه‌ی کل تبلیغ‌دهنده (دلار) — ظرفیت = بودجه ÷ قیمت
    // پایان زمانی کمپین (اختیاری؛ برای هر تسکی قابل استفاده است). null = بدون پایان
    expiresAt: { type: Date, default: null }
  },
  { timestamps: true }
);

taskSchema.index({ isActive: 1, expiresAt: 1, isSpecialOfDay: -1, isSponsored: -1, createdAt: -1 });
taskSchema.index({ isActive: 1, type: 1, createdAt: -1 });
taskSchema.index({ verifyType: 1, chatId: 1 });
taskSchema.index(
  { taskKind: 1, vipPlanNumber: 1 },
  { unique: true, partialFilterExpression: { taskKind: 'vip_activation', vipPlanNumber: { $type: 'number' } } }
);
taskSchema.index({ taskKind: 1 }, { unique: true, partialFilterExpression: { taskKind: 'bio_link' }, name: 'unique_bio_link_system_task' });

module.exports = mongoose.model('Task', taskSchema);
