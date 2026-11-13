'use strict';

const User = require('../models/User');
const { notifyUser } = require('./bot');

const VIP_MINING_CYCLE_NOTIFICATION_LOCK_KEY = 'vip-mining-cycle-notification';

function cycleMessage(language) {
  if (language === 'ps') return '⛏️ د VIP ماینینګ ۶ ساعته دوره بشپړه شوه. ذخیره چارج شوې ده؛ Gramup پرانیزئ، خپل UP ترلاسه او نوی ماینینګ پیل کړئ.';
  if (language === 'en') return '⛏️ Your 6-hour VIP mining cycle is complete. Your storage is full; open Gramup to claim your UP and start a new cycle.';
  return '⛏️ چرخه ۶ساعته ماینینگ VIP شما کامل شد. مخزن پر شده است؛ وارد Gramup شوید، توکن‌ها را دریافت و چرخه جدید را شروع کنید.';
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
    if (await notifyUser(candidate.telegramId, cycleMessage(candidate.language))) notified += 1;
  }
  return { candidates: candidates.length, notified };
}

module.exports = { VIP_MINING_CYCLE_NOTIFICATION_LOCK_KEY, cycleMessage, runVipMiningCycleNotificationSweep };
