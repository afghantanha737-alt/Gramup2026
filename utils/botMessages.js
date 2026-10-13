'use strict';

/**
 * متن‌های پیام‌های ربات (نه رابط کاربری وب) — با توجه به زبان انتخابی هر کاربر (user.language).
 * جدا از public/js/i18n.js نگه داشته شده چون این‌ها روی سرور اجرا می‌شوند، نه در مرورگر.
 */
const MESSAGES = {
  welcome: {
    fa: name => `سلام ${name} 👋\nبه Gramup خوش آمدی!\nبا انجام تسک‌ها، دعوت دوستان و ورود روزانه، پوینت جمع کن و به GRAM تبدیلش کن.`,
    ps: name => `سلام ${name} 👋\nGramup ته ښه راغلاست!\nد دندو ترسره کولو، ملګرو بلنې او ورځني ننوتلو سره پوائنټونه راټول کړئ او GRAM ته یې بدل کړئ.`,
    en: name => `Hi ${name} 👋\nWelcome to Gramup!\nComplete tasks, invite friends and check in daily to earn points and convert them to GRAM.`
  },
  taskNew: {
    fa: (title, reward, sponsorName) => `🎯 ${sponsorName ? 'تسک اسپانسری جدید' : 'تسک جدید'} اضافه شد!\n\n${title}${sponsorName ? `\nاسپانسر: ${sponsorName}` : ''}\nپاداش: ${reward} پوینت\n\nهمین حالا از تب «تسک‌ها» انجامش بده.`,
    ps: (title, reward, sponsorName) => `🎯 ${sponsorName ? 'نوې سپانسر شوې دنده' : 'نوې دنده'} اضافه شوه!\n\n${title}${sponsorName ? `\nسپانسر: ${sponsorName}` : ''}\nپاداش: ${reward} پوائنټ\n\nاوس مهال یې د «دندې» ټب څخه ترسره کړئ.`,
    en: (title, reward, sponsorName) => `🎯 ${sponsorName ? 'New sponsored task' : 'New task'} added!\n\n${title}${sponsorName ? `\nSponsor: ${sponsorName}` : ''}\nReward: ${reward} points\n\nDo it now from the Tasks tab.`
  },
  withdrawalApproved: {
    fa: (amount, token, txHash) => `✅ برداشت شما تایید و پرداخت شد!\n\nمبلغ: ${amount} ${token}\nTxID: ${txHash}\n\nمی‌تونی تراکنش رو تو تاریخچه‌ی کیف‌پولت هم ببینی.`,
    ps: (amount, token, txHash) => `✅ ستاسو ایستل تایید او تادیه شو!\n\nمقدار: ${amount} ${token}\nTxID: ${txHash}\n\nتاسو دا ټرانزکشن د خپل والټ تاریخچه کې هم لیدلی شئ.`,
    en: (amount, token, txHash) => `✅ Your withdrawal was approved and paid!\n\nAmount: ${amount} ${token}\nTxID: ${txHash}\n\nYou can also see it in your wallet history.`
  },
  withdrawalRejected: {
    fa: reason => `❌ درخواست برداشت شما رد شد و GRAM به موجودی حسابت برگشت.${reason ? `\nدلیل: ${reason}` : ''}`,
    ps: reason => `❌ ستاسو د ایستلو غوښتنه رد شوه او GRAM ستاسو حساب ته بیرته ورغلل.${reason ? `\nدلیل: ${reason}` : ''}`,
    en: reason => `❌ Your withdrawal request was rejected and the GRAM was refunded to your balance.${reason ? `\nReason: ${reason}` : ''}`
  },
  withdrawalSubmitted: {
    fa: (amount, token) => `💰 درخواست برداشت شما ثبت شد.\n\nمبلغ: ${amount} ${token}\nوضعیت: در انتظار بررسی\n\nدرخواست شما برای بررسی دستی ارسال شده است.`,
    ps: (amount, token) => `💰 ستاسو د ایستلو غوښتنه ثبت شوه.\n\nمقدار: ${amount} ${token}\nوضعیت: د کتنې په تمه\n\nستاسو غوښتنه د لاسي کتنې لپاره لیږل شوې.`,
    en: (amount, token) => `💰 Your withdrawal request was submitted.\n\nAmount: ${amount} ${token}\nStatus: Pending review\n\nYour request has been sent for manual review.`
  },
  withdrawalStatusApproved: {
    fa: amount => `✅ درخواست برداشت شما تأیید شد.\n\nمبلغ: ${amount}\n\nدرخواست شما برای پرداخت تأیید شده است.`,
    ps: amount => `✅ ستاسو د ایستلو غوښتنه تایید شوه.\n\nمقدار: ${amount}\n\nستاسو غوښتنه د تادیې لپاره تایید شوې ده.`,
    en: amount => `✅ Your withdrawal request was approved.\n\nAmount: ${amount}\n\nYour request has been approved for payment.`
  },
  withdrawalStatusProcessing: {
    fa: amount => `⏳ پرداخت برداشت شما در حال پردازش است.\n\nمبلغ: ${amount}\n\nپس از تکمیل پرداخت، وضعیت درخواست شما به‌روزرسانی خواهد شد.`,
    ps: amount => `⏳ ستاسو د ایستلو تادیه پروسس کیږي.\n\nمقدار: ${amount}\n\nد تادیې له بشپړیدو وروسته، ستاسو د غوښتنې حالت به تازه شي.`,
    en: amount => `⏳ Your withdrawal payment is being processed.\n\nAmount: ${amount}\n\nYour request status will update once payment is complete.`
  },
  withdrawalStatusCancelled: {
    fa: (amount, reason) => `⚠️ درخواست برداشت شما لغو شد.\n\nمبلغ: ${amount}${reason ? `\nدلیل: ${reason}` : ''}\n\nGRAM به موجودی حسابت برگشت.`,
    ps: (amount, reason) => `⚠️ ستاسو د ایستلو غوښتنه لغوه شوه.\n\nمقدار: ${amount}${reason ? `\nدلیل: ${reason}` : ''}\n\nGRAM ستاسو حساب ته بیرته ورغلل.`,
    en: (amount, reason) => `⚠️ Your withdrawal request was cancelled.\n\nAmount: ${amount}${reason ? `\nReason: ${reason}` : ''}\n\nThe GRAM was refunded to your balance.`
  },
  referralBonus: {
    fa: (name, points, balance) => `🎉 تبریک! ${name} تسک‌های لازم رو تکمیل کرد و ${points} پوینت پاداش دعوت به حسابت اضافه شد.\nموجودی فعلی: ${balance} پوینت.`,
    ps: (name, points, balance) => `🎉 مبارک شه! ${name} اړینې دندې بشپړې کړې او ${points} پوائنټ د بلنې ګټه ستاسو حساب ته اضافه شوه.\nاوسنی بیلانس: ${balance} پوائنټ.`,
    en: (name, points, balance) => `🎉 Congrats! ${name} completed the required tasks and you earned ${points} referral bonus points.\nCurrent balance: ${balance} points.`
  },
  dailyReminder: {
    fa: () => `⏰ یادت نره امروز وارد Gramup بشی و پاداش روزانه‌ت رو بگیری!\nاستریکت رو از دست نده — پاداش‌های هفت‌روزه‌ات را کامل کن.`,
    ps: () => `⏰ مه هېروئ چې نن Gramup ته ننوځئ او خپله ورځنۍ ګټه ترلاسه کړئ!\nخپل پرله‌پسې ورځې مه ورکوئ — هره ۷ ورځې یو وړیا د ګردونې چانس ترلاسه کوئ.`,
    en: () => `⏰ Don't forget to check in on Gramup today and claim your daily reward!\nKeep your streak alive — complete the seven-day reward cycle.`
  },
  leaderboardReward: {
    fa: (rank, points, week) => `🏆 تبریک! شما رتبه ${rank} لیدربورد هفتگی را کسب کردید.\n\n${points} پوینت جایزه هفته ${week} به حسابتان اضافه شد.`,
    ps: (rank, points, week) => `🏆 مبارک شه! تاسو د اونیز غوره لیست ${rank} مقام ترلاسه کړ.\n\n${points} پوائنټ د ${week} اونۍ جایزه ستاسو حساب ته اضافه شوه.`,
    en: (rank, points, week) => `🏆 Congratulations! You finished #${rank} on the weekly leaderboard.\n\n${points} reward points for week ${week} were added to your account.`
  }
};

function botText(key, lang, ...args) {
  const set = MESSAGES[key];
  if (!set) return '';
  const fn = set[lang] || set.fa;
  return fn(...args);
}

module.exports = { botText };
