'use strict';

/**
 * لیست کوتاه و پرکاربرد منطقه‌های زمانی برای انتخاب در پنل ادمین (یادآوری روزانه).
 * از Intl.DateTimeFormat خود Node استفاده می‌شود، نه یک کتابخانه‌ی جدید.
 */
const COMMON_TIMEZONES = [
  { id: 'UTC', label: 'UTC' },
  { id: 'Asia/Kabul', label: 'کابل (افغانستان), UTC+4:30' },
  { id: 'Asia/Tehran', label: 'تهران (ایران), UTC+3:30' },
  { id: 'Asia/Karachi', label: 'کراچی/اسلام‌آباد (پاکستان), UTC+5' },
  { id: 'Asia/Dubai', label: 'دبی (امارات), UTC+4' },
  { id: 'Asia/Kolkata', label: 'دهلی (هند), UTC+5:30' },
  { id: 'Europe/Istanbul', label: 'استانبول (ترکیه), UTC+3' },
  { id: 'Europe/Moscow', label: 'مسکو (روسیه), UTC+3' },
  { id: 'Europe/London', label: 'لندن (بریتانیا)' },
  { id: 'Europe/Berlin', label: 'برلین (اروپای مرکزی)' },
  { id: 'America/New_York', label: 'نیویورک (آمریکا)' }
];

function isValidTimezone(id) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: id });
    return true;
  } catch (error) {
    return false;
  }
}

/** ساعت محلی (۰ تا ۲۳) یک لحظه‌ی UTC مشخص را در یک منطقه‌ی زمانی برمی‌گرداند */
function localHourAt(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hour12: false }).formatToParts(date);
  const hourPart = parts.find(p => p.type === 'hour');
  // ساعت ۲۴ در بعضی locale/DTFها برای نیمه‌شب برمی‌گردد؛ به ۰ نگاشت می‌شود
  const h = Number(hourPart ? hourPart.value : NaN);
  return h === 24 ? 0 : h;
}

/**
 * برای «ساعت محلی هدف» در یک منطقه‌ی زمانی، معادل ساعت UTC را برای لحظه‌ی داده‌شده پیدا می‌کند
 * (با DST هم درست کار می‌کند چون واقعاً offset همان روز را از Intl می‌گیرد، نه جدول ثابت).
 * چون بعضی مناطق نیم‌ساعتی هستند (کابل +۴:۳۰)، اگر هیچ ساعت صحیح UTC دقیقاً برابر نشود،
 * نزدیک‌ترین ساعت را برمی‌گرداند (چون شکل ذخیره‌شده فقط «ساعت صحیح UTC» است).
 */
function targetUtcHour(localHour, timeZone, referenceDate = new Date()) {
  if (timeZone === 'UTC' || !isValidTimezone(timeZone)) return localHour;

  let best = 0;
  let bestDiff = 24;
  for (let utcHour = 0; utcHour < 24; utcHour += 1) {
    const probe = new Date(Date.UTC(
      referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), referenceDate.getUTCDate(), utcHour, 0, 0
    ));
    const gotLocal = localHourAt(probe, timeZone);
    const diff = Math.min(Math.abs(gotLocal - localHour), 24 - Math.abs(gotLocal - localHour));
    if (diff < bestDiff) { bestDiff = diff; best = utcHour; }
    if (diff === 0) return utcHour;
  }
  return best;
}

function targetUtcTime(localHour, localMinute, timeZone, referenceDate = new Date()) {
  if (!Number.isInteger(localHour) || localHour < 0 || localHour > 23
    || !Number.isInteger(localMinute) || localMinute < 0 || localMinute > 59
    || !isValidTimezone(timeZone)) throw new Error('Invalid local reminder time');
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });
  const start = Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), referenceDate.getUTCDate());
  for (let minutes = 0; minutes < 1440; minutes += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(start + minutes * 60000))
      .filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
    if (parts.hour === localHour && parts.minute === localMinute) {
      return { hour: Math.floor(minutes / 60), minute: minutes % 60 };
    }
  }
  throw new Error('The selected local time does not exist on this date');
}

module.exports = { COMMON_TIMEZONES, isValidTimezone, localHourAt, targetUtcHour, targetUtcTime };
