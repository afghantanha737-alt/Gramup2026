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
  phoneContactRequest: {
    fa: () => 'برای ادامهٔ ورود، شمارهٔ خودتان را با دکمهٔ زیر از طریق Telegram به اشتراک بگذارید. فقط شماره‌های +93 و +98 پذیرفته می‌شوند. شمارهٔ کامل ذخیره نمی‌شود؛ فقط کد کشور و زمان تأیید ثبت می‌شود.',
    ps: () => 'د ننوتلو د دوام لپاره، د لاندې تڼۍ له لارې خپل د Telegram Contact شریک کړئ. یوازې د +93 او +98 شمېرې منل کېږي. بشپړه شمېره نه ساتل کېږي؛ یوازې د هېواد کوډ او د تایید وخت ثبتېږي.',
    en: () => 'To continue signing in, share your own Telegram contact with the button below. Only +93 and +98 numbers are accepted. Your full number is not stored; only the country code and verification time are recorded.'
  },
  phoneShareButton: {
    fa: () => 'اشتراک شمارهٔ خودم',
    ps: () => 'خپل شمېره شریکول',
    en: () => 'Share my phone number'
  },
  phoneContactNotSelf: {
    fa: () => 'لطفاً Contact خودتان را با دکمهٔ اشتراک‌گذاری تلگرام بفرستید؛ شمارهٔ شخص دیگری پذیرفته نمی‌شود.',
    ps: () => 'مهرباني وکړئ د Telegram د شریکولو تڼۍ له لارې خپل Contact واستوئ؛ د بل چا شمېره نه منل کېږي.',
    en: () => 'Please share your own contact using Telegram’s share button. Someone else’s number cannot be used.'
  },
  phoneContactUnsupported: {
    fa: () => 'استفاده از Gramup فقط برای شماره‌های +93 و +98 امکان‌پذیر است. این شماره تأیید نمی‌شود و حساب شما مسدود نشده است؛ اگر شمارهٔ مجاز دیگری دارید، Contact خودتان را دوباره با دکمهٔ زیر بفرستید.',
    ps: () => 'Gramup یوازې د +93 او +98 شمېرو لپاره کار کوي. دا شمېره نه تاییدېږي او ستاسو حساب نه دی بند شوی؛ که بله منل شوې شمېره لرئ، خپل Contact د لاندې تڼۍ له لارې بیا واستوئ.',
    en: () => 'Gramup is available only for +93 and +98 numbers. This number cannot be verified, but your account has not been blocked; if you have another eligible number, share your own contact again with the button below.'
  },
  phoneContactVerified: {
    fa: () => '✅ شمارهٔ شما با موفقیت تأیید شد. حالا می‌توانید به Gramup برگردید.',
    ps: () => '✅ ستاسو شمېره تایید شوه. اوس بېرته Gramup ته ستنېدای شئ.',
    en: () => '✅ Your phone number is verified. You can now return to Gramup.'
  },
  phoneContactNotRegistered: {
    fa: () => 'ابتدا Gramup را باز کنید و سپس دوباره برای تأیید شماره تلاش کنید.',
    ps: () => 'لومړی Gramup پرانیزئ، بیا د شمېرې د تایید هڅه وکړئ.',
    en: () => 'Open Gramup first, then try phone verification again.'
  },
  taskNew: {
    fa: (title, reward, sponsorName) => `🎯 ${sponsorName ? 'تسک اسپانسری جدید' : 'تسک جدید'} اضافه شد!\n\n${title}${sponsorName ? `\nاسپانسر: ${sponsorName}` : ''}\nپاداش: ${reward} پوینت\n\nهمین حالا از تب «تسک‌ها» انجامش بده.`,
    ps: (title, reward, sponsorName) => `🎯 ${sponsorName ? 'نوې سپانسر شوې دنده' : 'نوې دنده'} اضافه شوه!\n\n${title}${sponsorName ? `\nاسپانسر: ${sponsorName}` : ''}\nپاداش: ${reward} پوائنټ\n\nاوس مهال یې د «دندې» ټب څخه ترسره کړئ.`,
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
  referralInitial: {
    fa: (name, points, level = 1, commission = 10, registeredAt = new Date(), rates = [10, 5, 3, 1]) => {
      const [l1 = 10, l2 = 5, l3 = 3, l4 = 1] = Array.isArray(rates) ? rates : [];
      return `🎉 دعوت جدید ثبت شد! ${name} عضو Gramup شد و ${points} پوینت واقعاً به حسابت اضافه شد.\nسطح دعوت: ${level} (Level ${level}) — نرخ این رابطه: ${commission}٪\nنرخ‌های واقعی کمیسیون: L1 ${l1}٪، L2 ${l2}٪، L3 ${l3}٪، L4 و عمیق‌تر ${l4}٪.\nدامنه درآمد واجد شرایط: فقط درآمد اصلی از تسک‌های تأییدشده، ورود روزانه و جایزهٔ لیدربورد؛ پاداش‌ها و کمیسیون‌های Referral، گردونه، تبدیل، برداشت و تعدیل ادمین شامل نیستند.\nزمان ثبت: ${formatKabulDateTime(registeredAt, 'fa')}`;
    },
    ps: (name, points, level = 1, commission = 10, registeredAt = new Date(), rates = [10, 5, 3, 1]) => {
      const [l1 = 10, l2 = 5, l3 = 3, l4 = 1] = Array.isArray(rates) ? rates : [];
      return `🎉 نوې بلنه ثبت شوه! ${name} د Gramup غړی شو او ${points} پوائنټونه واقعاً ستاسو حساب ته زیات شول.\nد بلنې کچه: ${level} (Level ${level}) — د دې اړیکې نرخ: ${commission}٪\nد کمېسیون واقعي نرخونه: L1 ${l1}٪، L2 ${l2}٪، L3 ${l3}٪، L4 او ژورې کچې ${l4}٪.\nد وړ عاید ساحه: یوازې د تایید شویو دندو، ورځني ننوتلو او غوره‌لیست اصلي عاید؛ د بلنې انعامونه او کمېسیونونه، چرخ، بدلون، ایستل او د اډمین تعدیل نه شاملېږي.\nد ثبت وخت: ${formatKabulDateTime(registeredAt, 'ps')}`;
    },
    en: (name, points, level = 1, commission = 10, registeredAt = new Date(), rates = [10, 5, 3, 1]) => {
      const [l1 = 10, l2 = 5, l3 = 3, l4 = 1] = Array.isArray(rates) ? rates : [];
      return `🎉 New invitation confirmed! ${name} joined Gramup and exactly ${points} points were added to your account.\nReferral level: ${level} (Level ${level}) — this relationship's rate: ${commission}%\nEffective commission rates: L1 ${l1}%, L2 ${l2}%, L3 ${l3}%, L4 and deeper ${l4}%.\nEligible-income scope: only original earnings from approved tasks, daily check-ins, and leaderboard rewards; referral rewards/commissions, spins, conversions, withdrawals, and admin adjustments are excluded.\nRegistered: ${formatKabulDateTime(registeredAt, 'en')}`;
    }
  },
  referralCommissionEarned: {
    fa: (points, level, rate) => `کمیسیون دعوت به موجودی شما اضافه شد: ${points} پوینت.\nسطح دعوت: ${level} — نرخ: ${rate}٪.\nاین کمیسیون فقط از درآمد اصلی واجد شرایط محاسبه شده است.`,
    ps: (points, level, rate) => `د بلنې کمېسیون ستاسو بیلانس ته زیات شو: ${points} پوائنټونه.\nد بلنې کچه: ${level} — نرخ: ${rate}٪.\nدا کمېسیون یوازې له وړ اصلي عاید څخه محاسبه شوی دی.`,
    en: (points, level, rate) => `Referral commission added: ${points} points.\nReferral level: ${level} — rate: ${rate}%.\nThis commission was calculated only from eligible original earnings.`
  },
  dailyStreakExpiryWarning: {
    fa: (day, points, streak) => `کمتر از یک ساعت تا پایان روز UTC باقی مانده است.\nپاداش ورود روزانه امروز ${points} پوینت است (روز ${day} چرخه).\nبا ثبت دستی ورود، استریک ${streak} روزهٔ خود را حفظ کنید. این پیام هیچ پاداشی را خودکار ثبت نمی‌کند.`,
    ps: (day, points, streak) => `د UTC ورځې تر پای ته له یو ساعت څخه کم وخت پاتې دی.\nستاسو د نن ورځې د ننوتلو انعام ${points} پوائنټونه دی (د دورې ${day}مه ورځ).\nپه لاسي ننوتلو خپل ${streak} ورځنی سټریک وساتئ. دا پیغام په خپله هېڅ انعام نه ثبتوي.`,
    en: (day, points, streak) => `Less than one hour remains before the UTC day resets.\nToday's daily check-in reward is ${points} points (cycle day ${day}).\nClaim manually to keep your ${streak}-day streak. This message never claims a reward automatically.`
  },
  dailyCheckinReady: {
    fa: (day, points, streak) => `⏰ پاداش ورود روزانه آماده است.\nامروز روز ${day} چرخهٔ شماست و با ثبت ورود ${points} پوینت دریافت می‌کنید.\nاستریک فعلی: ${streak} روز.`,
    ps: (day, points, streak) => `⏰ ستاسو د ورځني ننوتلو انعام چمتو دی.\nنن ستاسو د دورې ${day} ورځ ده او د ننوتلو په ثبتولو ${points} پوائنټونه ترلاسه کوئ.\nاوسنی سټریک: ${streak} ورځې.`,
    en: (day, points, streak) => `⏰ Your daily check-in reward is ready.\nToday is Day ${day} of your cycle and checking in will award ${points} points.\nCurrent streak: ${streak} days.`
  },
  dailyReminder: {
    fa: () => `⏰ یادت نره امروز وارد Gramup بشی و پاداش روزانه‌ت رو بگیری!\nاستریکت رو از دست نده — پاداش‌های هفت‌روزه‌ات را کامل کن.`,
    ps: () => `⏰ مه هېروئ چې نن Gramup ته ننوځئ او خپله ورځنۍ ګټه ترلاسه کړئ!\nخپل پرله‌پسې ورځې مه ورکوئ — د اوو ورځو د انعام پړاو بشپړ کړئ.`,
    en: () => `⏰ Don't forget to check in on Gramup today and claim your daily reward!\nKeep your streak alive — complete the seven-day reward cycle.`
  },
  dailyReminderPersonalized: {
    fa: (day, points, streak) => `⏰ یادآوری Daily Check\nامروز روز ${day} چرخه شماست و با ورود امروز ${points} پوینت دریافت می‌کنید.\nاستریک فعلی شما: ${streak} روز. همین حالا وارد Gramup شوید و پاداش‌تان را بگیرید.`,
    ps: (day, points, streak) => `⏰ د ورځني Check یادونه\nنن ستاسو د دورې ${day} ورځ ده او د ننوتلو سره ${points} پوائنټه ترلاسه کوئ.\nستاسو اوسنی سټریک: ${streak} ورځې. همدا اوس Gramup ته ننوځئ او خپله ګټه واخلئ.`,
    en: (day, points, streak) => `⏰ Daily Check reminder\nToday is Day ${day} of your cycle and you can claim ${points} points by checking in.\nYour current streak: ${streak} days. Open Gramup now and claim your reward.`
  },
  leaderboardReward: {
    fa: (rank, points, week) => `🏆 تبریک! شما رتبه ${rank} لیدربورد هفتگی را کسب کردید.\n\n${points} پوینت جایزه هفته ${week} به حسابتان اضافه شد.`,
    ps: (rank, points, week) => `🏆 مبارک شه! تاسو د اونیز غوره لیست ${rank} مقام ترلاسه کړ.\n\n${points} پوائنټ د ${week} اونۍ جایزه ستاسو حساب ته اضافه شوه.`,
    en: (rank, points, week) => `🏆 Congratulations! You finished #${rank} on the weekly leaderboard.\n\n${points} reward points for week ${week} were added to your account.`
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
