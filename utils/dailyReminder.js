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
  const hour = Number(settings.dailyReminderHourUtc);
  const minute = Number(settings.dailyReminderMinuteUtc ?? 0);
  return now.getUTCHours() === hour && now.getUTCMinutes() === minute;
}

function kabulDayStart(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kabul', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  return new Date(Date.UTC(values.year, values.month - 1, values.day) - (4.5 * 60 * 60 * 1000));
}

/** متن شخصی‌سازی‌شده: روز چرخه و پاداش همان کاربر در پیام درج می‌شود. */
function reminderMessageFor(settings, lang, streak = 0, lastCheckIn = null, now = new Date()) {
  const { botText } = require('./botMessages');
  const { DAILY_CHECKIN_REWARDS, cycleDayForStreak } = require('./dailyCheckin');
  const currentDayStart = kabulDayStart(now).getTime();
  const lastDayStart = lastCheckIn ? kabulDayStart(new Date(lastCheckIn)).getTime() : null;
  const nextStreak = lastDayStart === currentDayStart - 86400000 ? Number(streak || 0) + 1 : 1;
  const day = cycleDayForStreak(nextStreak) || 1;
  const points = DAILY_CHECKIN_REWARDS[day - 1];
  const custom = String(settings.dailyReminderMessage || '').trim();
  const fallback = botText('dailyReminderPersonalized', lang, day, points, Math.max(0, Number(streak) || 0));
  if (!custom) return fallback;
  const rendered = custom
    .replaceAll('{day}', String(day))
    .replaceAll('{points}', String(points))
    .replaceAll('{streak}', String(Math.max(0, Number(streak) || 0)));
  return rendered.includes(String(day)) || rendered.includes(String(points)) ? rendered : `${rendered}\n\n${fallback}`;
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

  const startOfToday = kabulDayStart(now);

  const filter = {
    isBanned: false,
    telegramBlockedAt: null,
    telegramId: { $exists: true, $nin: [null, ''] },
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
    candidates = await User.find(filter, '_id telegramId language streak lastCheckIn').lean();
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
        reminderMessageFor(settings, u.language, u.streak, u.lastCheckIn, now)
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

/**
 * ارسال فوری آزمایشی برای همه‌ی کاربران شروع‌کرده.
 * این مسیر عمداً lastReminderSentAt و هیچ موجودی یا وضعیت کاربر را تغییر نمی‌دهد.
 */
async function sendTestReminderToAll({ User, Settings, notifyUser, now = new Date(), onProgress } = {}) {
  User = User || require('../models/User');
  Settings = Settings || require('../models/Settings');
  if (!notifyUser) ({ notifyUser } = require('./bot'));
  const settings = await Settings.getGlobal();
  const users = await User.find({
    isBanned: false,
    telegramBlockedAt: null,
    telegramId: { $exists: true, $nin: ['', null] }
  }).select('_id telegramId language streak lastCheckIn').lean();
  const BATCH_SIZE = 20;
  const DELAY_MS = 1100;
  let sent = 0;
  let failed = 0;
  let lastError = '';
  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const batch = users.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(user => notifyUser(
      user.telegramId,
      reminderMessageFor(settings, user.language, user.streak, user.lastCheckIn, now)
    )));
    results.forEach(result => {
      if (result.status === 'fulfilled' && result.value) sent += 1;
      else {
        failed += 1;
        if (result.status === 'rejected') lastError = String(result.reason?.message || result.reason).slice(0, 300);
      }
    });
    await onProgress?.({ sent, failed, total: users.length, lastError });
    if (i + BATCH_SIZE < users.length) await new Promise(resolve => setTimeout(resolve, DELAY_MS));
  }
  return { sent, failed, total: users.length, lastError };
}

module.exports = { runDailyReminderSweep, sendTestReminder, sendTestReminderToAll, reminderMessageFor, streakAtRiskMessageFor, utcDayKey, kabulDayStart, shouldRunNow };
