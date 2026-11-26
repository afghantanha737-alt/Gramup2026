'use strict';

/**
 * منطق خالص تسک‌های اسپانسری (بدون وابستگی به دیتابیس؛ قابل تست مستقل).
 *
 * مدل درآمد: تبلیغ‌دهنده (صاحب کانال) برای هر عضو «تاییدشده» مبلغی به دلار می‌دهد (sponsorPriceUsd)
 * و یک بودجه‌ی کل تعیین می‌کند (sponsorBudgetUsd). ظرفیت تسک = floor(بودجه ÷ قیمت هر عضو)،
 * پس وقتی بودجه‌ی تبلیغ‌دهنده تمام شد، تسک خودکار بسته می‌شود.
 * هزینه‌ی هر تکمیل = پاداش کاربر به پوینت × نرخ (USDT به‌ازای هر پوینت) × قیمت دلاری USDT.
 */

const MAX_PRICE_USD = 100;
const MAX_BUDGET_USD = 1000000;

const round6 = n => Number(Number(n).toFixed(6));

function parseDate(value) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim();
  // تاریخ ساده (YYYY-MM-DD) یعنی «تا پایان همان روز به وقت UTC»
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T23:59:59Z`) : new Date(text);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** هزینه‌ی دلاریِ پاداشی که به کاربر داده می‌شود */
function rewardCostUsd(reward, rate, usdtUsdPrice) {
  const value = Number(reward) * Number(rate) * Number(usdtUsdPrice);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * ورودی ادمین برای فیلدهای اسپانسری را اعتبارسنجی و نرمال می‌کند.
 * اگر اسپانسری نباشد فقط expiresAt (پایان زمانی) پردازش می‌شود.
 */
function normalizeSponsorInput(input, now = new Date()) {
  const body = input || {};
  const flag = body.isSponsored;
  const isSponsored = flag === true || flag === 'true' || flag === 1 || flag === '1';

  const expires = parseDate(body.expiresAt);
  if (expires === undefined) return { error: 'تاریخ پایان نامعتبر است.' };
  if (expires && expires.getTime() <= now.getTime()) return { error: 'تاریخ پایان باید در آینده باشد.' };

  if (!isSponsored) {
    return { value: { isSponsored: false, sponsorName: '', sponsorPriceUsd: 0, sponsorBudgetUsd: 0, expiresAt: expires } };
  }

  const sponsorName = String(body.sponsorName || '').trim();
  const price = Number(body.sponsorPriceUsd);
  const budget = Number(body.sponsorBudgetUsd);

  if (!sponsorName) return { error: 'نام تبلیغ‌دهنده (اسپانسر) الزامی است.' };
  if (sponsorName.length > 60) return { error: 'نام تبلیغ‌دهنده بیش از حد طولانی است.' };
  if (!Number.isFinite(price) || price <= 0 || price > MAX_PRICE_USD) {
    return { error: `قیمت هر عضو (به دلار) باید بین 0 و ${MAX_PRICE_USD} باشد.` };
  }
  if (!Number.isFinite(budget) || budget < price || budget > MAX_BUDGET_USD) {
    return { error: 'بودجه‌ی تبلیغ‌دهنده باید حداقل برابر قیمت یک عضو باشد.' };
  }

  const capacity = Math.floor(budget / price + 1e-9);
  return {
    value: {
      isSponsored: true,
      sponsorName,
      sponsorPriceUsd: round6(price),
      sponsorBudgetUsd: round6(budget),
      expiresAt: expires,
      maxCompletions: capacity // ظرفیت از روی بودجه محاسبه می‌شود
    }
  };
}

/** سود/زیان یک کمپین اسپانسری با تنظیمات فعلی */
function marginInfo({ reward, rate, usdtUsdPrice, priceUsd, budgetUsd }) {
  const canCompute = Number(rate) > 0 && Number(usdtUsdPrice) > 0;
  const costPerJoinUsd = rewardCostUsd(reward, rate, usdtUsdPrice);
  const profitPerJoinUsd = Number(priceUsd) - costPerJoinUsd;
  const capacity = Math.floor(Number(budgetUsd) / Number(priceUsd) + 1e-9);
  return {
    canCompute,
    costPerJoinUsd,
    profitPerJoinUsd,
    capacity,
    totalRevenueUsd: capacity * Number(priceUsd),
    totalCostUsd: capacity * costPerJoinUsd,
    totalProfitUsd: capacity * profitPerJoinUsd,
    isLoss: canCompute && profitPerJoinUsd < 0
  };
}

module.exports = { normalizeSponsorInput, marginInfo, rewardCostUsd, parseDate, MAX_PRICE_USD, MAX_BUDGET_USD };
