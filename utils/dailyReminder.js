'use strict';

// عمداً lazy require می‌شوند (داخل خود تابع)، نه اینجا در بالای فایل: این‌طور
// tests/dailyReminder.test.js می‌تواند shouldRunNow/utcDayKey را بدون نیاز به
// دیتابیس یا نصب‌بودن mongoose تست کند.

function utcDayKey(date = new Date()) {
  return Math.floor(date.getTime() / 86400000);
}

/** بخش خالص (بدون دیتابیس) تصمیم‌گیری — آیا همین الان باید یادآوری اجرا شود؟ */
function shouldRunNow(settings, now = new Date()) {
  if (!settings.dailyReminderEnabled) return false;
  return now.getUTCHours() === settings.dailyReminderHourUtc;
}

/** متن نهایی پیام: اگر ادمین متن سفارشی نوشته همان، وگرنه متن پیش‌فرض چندزبانه */
function reminderMessageFor(settings, lang) {
  const { botText } = require('./botMessages');
  const custom = String(settings.dailyReminderMessage || '').trim();
  return custom || botText('dailyReminder', lang);
}

function streakAtRiskMessageFor(lang) {
  const messages = {
    fa: '⚠️ استریک شما در خطر است! امروز وارد شوید تا استریکتان حفظ شود.',
    ps: '⚠️ ستاسو پرله‌پسې ورځې له خطر سره مخ دي! نن ننوځئ چې خپل سټریک وساتئ.',
    en: '⚠️ Your streak is at risk! Check in today to keep it alive.'
  };
  return messages[lang] || messages.fa;
}

/**
 * یادآوری ورود روزانه: فقط داخل «ساعت تنظیم‌شده‌ی UTC» به کاربرانی که امروز
 * هنوز ورود روزانه نزده‌اند و امروز قبلاً یادآوری نگرفته‌اند فرستاده می‌شود.
 * این تابع هر چند دقیقه (نه هر ساعت دقیق) صدا زده می‌شود؛ چک lastReminderSentAt
 * تضمین می‌کند حتی با چند بار اجرا در همان ساعت، پیام تکراری نرود.
 * پیش از ارسال، علامت «ارسال شد» ذخیره می‌شود (نه بعد از آن)، تا اگر ارسال
 * دسته‌جمعی وسط کار قطع شود، دفعه‌ی بعد همان کاربران دوباره spam نشوند؛
 * قیمت این تصمیم این است که اگر notifyUser واقعاً شکست بخورد (مثلاً کاربر
 * ربات را بلاک کرده)، همان روز دوباره تلاش نمی‌شود — که قابل قبول است.
 *
 * «کاربر فعال» (audience=active) چون هیچ فیلد اختصاصی «آخرین بازدید کلی اپ» در
 * مدل کاربر وجود ندارد، با updatedAt کاربر (که تقریباً با هر تعامل واقعی —
 * پوینت/تسک و... — عوض می‌شود) در ۳۰ روز اخیر تخمین زده می‌شود.
 */
async function runDailyReminderSweep(now = new Date(), dependencies = {}) {
  const User = dependencies.User || require('../models/User');
  const Settings = dependencies.Settings || require('../models/Settings');
  const notifyUser = dependencies.notifyUser || require('./bot').notifyUser;

  const settings = await Settings.getGlobal();

  if (!shouldRunNow(settings, now)) {
    return { sent: 0, skipped: settings.dailyReminderEnabled ? 'wrong_hour' : 'disabled' };
  }

  const startOfToday = new Date(utcDayKey(now) * 86400000);

  const filter = {
    isBanned: false,
    telegramBlockedAt: null,
    $and: [
      { $or: [{ lastCheckIn: null }, { lastCheckIn: { $lt: startOfToday } }] },
      { $or: [{ lastReminderSentAt: null }, { lastReminderSentAt: { $lt: startOfToday } }] }
    ]
  };
  if (settings.dailyReminderAudience === 'active') {
    const activeSince = new Date(now.getTime() - 30 * 86400000);
    filter.$and.push({ updatedAt: { $gte: activeSince } });
  }

  let candidates;
  try {
    candidates = await User.find(filter, '_id telegramId language streak').lean();
  } catch (error) {
    await Settings.updateOne({}, {
      $set: { dailyReminderLastRunAt: now, dailyReminderLastStatus: 'error', dailyReminderLastError: String(error.message || error).slice(0, 300) }
    });
    throw error;
  }

  if (!candidates.length) {
    await Settings.updateOne({}, {
      $set: { dailyReminderLastRunAt: now, dailyReminderLastSentCount: 0, dailyReminderLastStatus: 'ok', dailyReminderLastError: '' }
    });
    return { sent: 0, skipped: 'no_candidates' };
  }

  const BATCH_SIZE = 20;
  const DELAY_MS = 1100;
  let sent = 0;
  let lastError = '';
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    const claimed = (await Promise.all(batch.map(async user => {
      // This conditional claim is shared with the check-in notification sweep.
      // Never overwrite a marker another job already acquired for this UTC day.
      const claim = await User.updateOne({
        _id: user._id,
        isBanned: false,
        telegramBlockedAt: null,
        $and: [
          { $or: [{ lastCheckIn: null }, { lastCheckIn: { $lt: startOfToday } }] },
          { $or: [{ lastReminderSentAt: null }, { lastReminderSentAt: { $exists: false } }, { lastReminderSentAt: { $lt: startOfToday } }] }
        ]
      }, { $set: { lastReminderSentAt: now } });
      return claim.modifiedCount ? user : null;
    }))).filter(Boolean);

    if (!claimed.length) {
      if (i + BATCH_SIZE < candidates.length) await new Promise(resolve => setTimeout(resolve, DELAY_MS));
      continue;
    }

    const results = await Promise.allSettled(
      claimed.map(u => notifyUser(
        u.telegramId,
        Number(u.streak) >= 3 ? streakAtRiskMessageFor(u.language) : reminderMessageFor(settings, u.language)
      ))
    );
    results.forEach(r => {
      if (r.status === 'fulfilled' && r.value) sent += 1;
      if (r.status === 'rejected') lastError = String(r.reason && r.reason.message || r.reason).slice(0, 300);
    });
    if (i + BATCH_SIZE < candidates.length) {
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }
  }

  await Settings.updateOne({}, {
    $set: {
      dailyReminderLastRunAt: now,
      dailyReminderLastSentCount: sent,
      dailyReminderLastStatus: lastError ? 'partial' : 'ok',
      dailyReminderLastError: lastError
    }
  });

  return { sent, total: candidates.length };
}

/** ارسال یک پیام آزمایشی به یک آیدی عددی تلگرام مشخص (دکمه‌ی «ارسال Test» در پنل ادمین) */
async function sendTestReminder(telegramId, lang = 'fa') {
  const Settings = require('../models/Settings');
  const { notifyUser } = require('./bot');
  const settings = await Settings.getGlobal();
  return notifyUser(telegramId, reminderMessageFor(settings, lang));
}

module.exports = { runDailyReminderSweep, sendTestReminder, reminderMessageFor, streakAtRiskMessageFor, utcDayKey, shouldRunNow };
