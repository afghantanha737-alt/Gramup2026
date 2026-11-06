'use strict';

/**
 * متن‌های پیام‌های ربات (نه رابط کاربری وب) — با توجه به زبان انتخابی هر کاربر (user.language).
 * جدا از public/js/i18n.js نگه داشته شده چون این‌ها روی سرور اجرا می‌شوند، نه در مرورگر.
 */
const MESSAGES = {
  welcome: {
    fa: name => `سلام ${name} 👋\nبه Gramup خوش آمدی!\nبا انجام تسک‌ها، دعوت دوستان و ورود روزانه، UP جمع کن و به GRAM تبدیلش کن.`,
    ps: name => `سلام ${name} 👋\nGramup ته ښه راغلاست!\nد دندو ترسره کولو، ملګرو بلنې او ورځني ننوتلو سره UP راټول کړئ او GRAM ته یې بدل کړئ.`,
    en: name => `Hi ${name} 👋\nWelcome to Gramup!\nComplete tasks, invite friends and check in daily to earn UP and convert it to GRAM.`
  },
  taskNew: {
    fa: (title, reward, sponsorName) => `🎯 ${sponsorName ? 'تسک اسپانسری جدید' : 'تسک جدید'} اضافه شد!\n\n${title}${sponsorName ? `\nاسپانسر: ${sponsorName}` : ''}\nپاداش: ${reward} UP\n\nهمین حالا از تب «تسک‌ها» انجامش بده.`,
    ps: (title, reward, sponsorName) => `🎯 ${sponsorName ? 'نوې سپانسر شوې دنده' : 'نوې دنده'} اضافه شوه!\n\n${title}${sponsorName ? `\nاسپانسر: ${sponsorName}` : ''}\nپاداش: ${reward} UP\n\nاوس مهال یې د «دندې» ټب څخه ترسره کړئ.`,
    en: (title, reward, sponsorName) => `🎯 ${sponsorName ? 'New sponsored task' : 'New task'} added!\n\n${title}${sponsorName ? `\nSponsor: ${sponsorName}` : ''}\nReward: ${reward} UP\n\nDo it now from the Tasks tab.`
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
    fa: (name, points, balance) => `🎉 تبریک! ${name} تسک‌های لازم رو تکمیل کرد و ${points} UP پاداش دعوت به حسابت اضافه شد.\nموجودی فعلی: ${balance} UP.`,
    ps: (name, points, balance) => `🎉 مبارک شه! ${name} اړینې دندې بشپړې کړې او ${points} UP د بلنې ګټه ستاسو حساب ته اضافه شوه.\nاوسنی بیلانس: ${balance} UP.`,
    en: (name, points, balance) => `🎉 Congrats! ${name} completed the required tasks and you earned ${points} UP as a referral bonus.\nCurrent UP balance: ${balance} UP.`
  },
  referralInitial: {
    fa: (name, points, level = 1, commission = 10, registeredAt = new Date(), rates = [10, 5, 3, 1]) => {
      const [l1 = 10, l2 = 5, l3 = 3, l4 = 1] = Array.isArray(rates) ? rates : [];
      return `🎉 دعوت جدید ثبت شد! ${name} عضو Gramup شد و ${points} UP واقعاً به حسابت اضافه شد.\nسطح دعوت: ${level} (Level ${level}) — نرخ این رابطه: ${commission}٪\nنرخ‌های واقعی کمیسیون: L1 ${l1}٪، L2 ${l2}٪، L3 ${l3}٪، L4 و عمیق‌تر ${l4}٪.\nدامنه درآمد واجد شرایط: فقط درآمد اصلی از تسک‌های تأییدشده، ورود روزانه و جایزهٔ لیدربورد؛ پاداش‌ها و کمیسیون‌های Referral، گردونه، تبدیل، برداشت و تعدیل ادمین شامل نیستند.\nزمان ثبت: ${formatKabulDateTime(registeredAt, 'fa')}`;
    },
    ps: (name, points, level = 1, commission = 10, registeredAt = new Date(), rates = [10, 5, 3, 1]) => {
      const [l1 = 10, l2 = 5, l3 = 3, l4 = 1] = Array.isArray(rates) ? rates : [];
      return `🎉 نوې بلنه ثبت شوه! ${name} د Gramup غړی شو او ${points} UP واقعاً ستاسو حساب ته زیات شول.\nد بلنې کچه: ${level} (Level ${level}) — د دې اړیکې نرخ: ${commission}٪\nد کمېسیون واقعي نرخونه: L1 ${l1}٪، L2 ${l2}٪، L3 ${l3}٪، L4 او ژورې کچې ${l4}٪.\nد وړ عاید ساحه: یوازې د تایید شویو دندو، ورځني ننوتلو او غوره‌لیست اصلي عاید؛ د بلنې انعامونه او کمېسیونونه، چرخ، بدلون، ایستل او د اډمین تعدیل نه شاملېږي.\nد ثبت وخت: ${formatKabulDateTime(registeredAt, 'ps')}`;
    },
    en: (name, points, level = 1, commission = 10, registeredAt = new Date(), rates = [10, 5, 3, 1]) => {
      const [l1 = 10, l2 = 5, l3 = 3, l4 = 1] = Array.isArray(rates) ? rates : [];
      return `🎉 New invitation confirmed! ${name} joined Gramup and exactly ${points} UP were added to your account.\nReferral level: ${level} (Level ${level}) — this relationship's rate: ${commission}%\nEffective commission rates: L1 ${l1}%, L2 ${l2}%, L3 ${l3}%, L4 and deeper ${l4}%.\nEligible-income scope: only original earnings from approved tasks, daily check-ins, and leaderboard rewards; referral rewards/commissions, spins, conversions, withdrawals, and admin adjustments are excluded.\nRegistered: ${formatKabulDateTime(registeredAt, 'en')}`;
    }
  },
  referralCommissionEarned: {
    fa: (points, level, rate) => `کمیسیون دعوت به موجودی شما اضافه شد: ${points} UP.\nسطح دعوت: ${level} — نرخ: ${rate}٪.\nاین کمیسیون فقط از درآمد اصلی واجد شرایط محاسبه شده است.`,
    ps: (points, level, rate) => `د بلنې کمېسیون ستاسو بیلانس ته زیات شو: ${points} UP.\nد بلنې کچه: ${level} — نرخ: ${rate}٪.\nدا کمېسیون یوازې له وړ اصلي عاید څخه محاسبه شوی دی.`,
    en: (points, level, rate) => `Referral commission added: ${points} UP.\nReferral level: ${level} — rate: ${rate}%.\nThis commission was calculated only from eligible original earnings.`
  },
  dailyStreakExpiryWarning: {
    fa: (day, points, streak) => `کمتر از یک ساعت تا پایان روز UTC باقی مانده است.\nپاداش ورود روزانه امروز ${points} UP است (روز ${day} چرخه).\nبا ثبت دستی ورود، استریک ${streak} روزهٔ خود را حفظ کنید. این پیام هیچ پاداشی را خودکار ثبت نمی‌کند.`,
    ps: (day, points, streak) => `د UTC ورځې تر پای ته له یو ساعت څخه کم وخت پاتې دی.\nستاسو د نن ورځې د ننوتلو انعام ${points} UP دی (د دورې ${day}مه ورځ).\nپه لاسي ننوتلو خپل ${streak} ورځنی سټریک وساتئ. دا پیغام په خپله هېڅ انعام نه ثبتوي.`,
    en: (day, points, streak) => `Less than one hour remains before the UTC day resets.\nToday's daily check-in reward is ${points} UP (cycle day ${day}).\nClaim manually to keep your ${streak}-day streak. This message never claims a reward automatically.`
  },
  dailyCheckinReady: {
    fa: (day, points, streak) => `⏰ پاداش ورود روزانه آماده است.\nامروز روز ${day} چرخهٔ شماست و با ثبت ورود ${points} UP دریافت می‌کنید.\nاستریک فعلی: ${streak} روز.`,
    ps: (day, points, streak) => `⏰ ستاسو د ورځني ننوتلو انعام چمتو دی.\nنن ستاسو د دورې ${day} ورځ ده او د ننوتلو په ثبتولو ${points} UP ترلاسه کوئ.\nاوسنی سټریک: ${streak} ورځې.`,
    en: (day, points, streak) => `⏰ Your daily check-in reward is ready.\nToday is Day ${day} of your cycle and checking in will award ${points} UP.\nCurrent streak: ${streak} days.`
  },
  dailyReminder: {
    fa: () => `⏰ یادت نره امروز وارد Gramup بشی و پاداش روزانه‌ت رو بگیری!\nاستریکت رو از دست نده — پاداش‌های هفت‌روزه‌ات را کامل کن.`,
    ps: () => `⏰ مه هېروئ چې نن Gramup ته ننوځئ او خپله ورځنۍ ګټه ترلاسه کړئ!\nخپل پرله‌پسې ورځې مه ورکوئ — د اوو ورځو د انعام پړاو بشپړ کړئ.`,
    en: () => `⏰ Don't forget to check in on Gramup today and claim your daily reward!\nKeep your streak alive — complete the seven-day reward cycle.`
  },
  dailyReminderPersonalized: {
    fa: (day, points, streak) => `⏰ یادآوری Daily Check\nامروز روز ${day} چرخه شماست و با ورود امروز ${points} UP دریافت می‌کنید.\nاستریک فعلی شما: ${streak} روز. همین حالا وارد Gramup شوید و پاداش‌تان را بگیرید.`,
    ps: (day, points, streak) => `⏰ د ورځني Check یادونه\nنن ستاسو د دورې ${day} ورځ ده او د ننوتلو سره ${points} UP ترلاسه کوئ.\nستاسو اوسنی سټریک: ${streak} ورځې. همدا اوس Gramup ته ننوځئ او خپله ګټه واخلئ.`,
    en: (day, points, streak) => `⏰ Daily Check reminder\nToday is Day ${day} of your cycle and you can claim ${points} UP by checking in.\nYour current streak: ${streak} days. Open Gramup now and claim your reward.`
  },
  leaderboardReward: {
    fa: (rank, points, week) => `🏆 تبریک! شما رتبه ${rank} لیدربورد هفتگی را کسب کردید.\n\n${points} UP جایزه هفته ${week} به حسابتان اضافه شد.`,
    ps: (rank, points, week) => `🏆 مبارک شه! تاسو د اونیز غوره لیست ${rank} مقام ترلاسه کړ.\n\n${points} UP د ${week} اونۍ جایزه ستاسو حساب ته اضافه شوه.`,
    en: (rank, points, week) => `🏆 Congratulations! You finished #${rank} on the weekly leaderboard.\n\n${points} UP for week ${week} were added to your account.`
  },
  weeklyChallengeStart: {
    fa: () => '🎯 Weekly Challenge شروع شد!\n\nچالش هفتگی جدید آغاز شده است.\nهمین حالا وارد شوید و برای کسب رتبه و جایزه تلاش کنید.',
    ps: () => '🎯 Weekly Challenge پیل شو!\n\nنوی اوونیزه ننګونه پیل شوې ده.\nهمدا اوس داخل شئ او د مقام او پاداش لپاره هڅه وکړئ.',
    en: () => '🎯 Weekly Challenge has started!\n\nA new weekly challenge is now live.\nJoin now and compete for the leaderboard rewards.'
  }
};

function formatKabulDateTime(value, language = 'en') {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const locale = language === 'fa' ? 'fa-AF' : language === 'ps' ? 'ps-AF' : 'en-GB';
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'Asia/Kabul', dateStyle: 'medium', timeStyle: 'short', hour12: false
  }).format(date);
}

function botText(key, lang, ...args) {
  const set = MESSAGES[key];
  if (!set) return '';
  const fn = set[lang] || set.fa;
  return fn(...args);
}

module.exports = { botText };
