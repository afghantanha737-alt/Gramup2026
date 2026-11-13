'use strict';

const User = require('../models/User');
const { notifyUser, buildWebAppReplyMarkup } = require('./bot');

const VIP_MINING_CYCLE_NOTIFICATION_LOCK_KEY = 'vip-mining-cycle-notification';
const MINER_REMINDER_MUTE_CALLBACK_DATA = 'vip_mining_mute_reminders';

function safeLanguage(language) {
  return ['fa', 'ps', 'en'].includes(String(language || '').toLowerCase())
    ? String(language).toLowerCase()
    : 'en';
}

function cycleMessage(language) {
  if (language === 'ps') return '⛏️ ستاسو د ۶ ساعته ماینینګ دوره بشپړه شوه. ذخیره ډکه ده؛ Gramup پرانیزئ، خپل UP واخلئ او نوی ماینینګ پیل کړئ.';
  if (language === 'en') return '⛏️ Your 6-hour mining cycle is complete. Your storage is full; open Gramup to claim your UP and start a new cycle.';
  return '⛏️ چرخه ۶ساعته ماینینگ شما کامل شد. مخزن پر شده است؛ وارد Gramup شوید، توکن‌ها را دریافت و چرخه جدید را شروع کنید.';
}

function cycleReplyMarkup(language, webAppUrl) {
  const lang = safeLanguage(language);
  const claimText = lang === 'fa' ? '⛏ جمع کردن UP' : lang === 'ps' ? '⛏ UP را ټولول' : '⛏ Claim UP';
  const muteText = lang === 'fa' ? '🔕 خاموش کردن یادآوریها' : lang === 'ps' ? '🔕 یادونې بندول' : '🔕 Mute reminders';
  const claimMarkup = buildWebAppReplyMarkup(claimText, webAppUrl);
  return {
    inline_keyboard: [
      [claimMarkup.inline_keyboard[0][0]],
      [{ text: muteText, callback_data: MINER_REMINDER_MUTE_CALLBACK_DATA }]
    ]
  };
}

async function runVipMiningCycleNotificationSweep(now = new Date()) {
  const candidates = await User.find({
    isBanned: { $ne: true },
    botReminderEnabled: { $ne: false },
    telegramBlockedAt: null,
    telegramId: { $exists: true, $nin: ['', null] },
    vipMiningCycleEndsAt: { $lte: now },
    $or: [
      { vipMiningCycleNotifiedAt: null },
      { vipMiningCycleNotifiedAt: { $exists: false } },
      { $expr: { $lt: ['$vipMiningCycleNotifiedAt', '$vipMiningCycleEndsAt'] } }
    ]
  }).select('_id telegramId language vipMiningCycleEndsAt').limit(500).lean();
  let notified = 0;
  for (const candidate of candidates) {
    const claimed = await User.findOneAndUpdate({
      _id: candidate._id,
      vipMiningCycleEndsAt: candidate.vipMiningCycleEndsAt,
      $or: [
        { vipMiningCycleNotifiedAt: null },
        { vipMiningCycleNotifiedAt: { $exists: false } },
        { $expr: { $lt: ['$vipMiningCycleNotifiedAt', '$vipMiningCycleEndsAt'] } }
      ]
    }, { $set: { vipMiningCycleNotifiedAt: candidate.vipMiningCycleEndsAt } }, { new: true }).lean();
    if (!claimed) continue;
    if (await notifyUser(candidate.telegramId, cycleMessage(candidate.language), {
      reply_markup: cycleReplyMarkup(candidate.language, process.env.APP_URL)
    })) notified += 1;
  }
  return { candidates: candidates.length, notified };
}

module.exports = {
  VIP_MINING_CYCLE_NOTIFICATION_LOCK_KEY,
  MINER_REMINDER_MUTE_CALLBACK_DATA,
  cycleMessage,
  cycleReplyMarkup,
  runVipMiningCycleNotificationSweep
};
