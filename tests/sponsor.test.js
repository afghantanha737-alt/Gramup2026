'use strict';
/** node tests/sponsor.test.js — منطق تسک‌های اسپانسری: اعتبارسنجی و محاسبه‌ی سود/زیان */
const assert = require('assert');
const { normalizeSponsorInput, marginInfo, rewardCostUsd } = require('../utils/sponsor');

// ---- normalizeSponsorInput
let r = normalizeSponsorInput({ isSponsored: false });
assert.strictEqual(r.value.isSponsored, false);
console.log('PASS  غیراسپانسری: بدون اعتبارسنجی قیمت/بودجه رد می‌شود');

r = normalizeSponsorInput({ isSponsored: true, sponsorName: '', sponsorPriceUsd: 1, sponsorBudgetUsd: 10 });
assert.ok(r.error);
r = normalizeSponsorInput({ isSponsored: true, sponsorName: 'Acme', sponsorPriceUsd: 0, sponsorBudgetUsd: 10 });
assert.ok(r.error, 'قیمت صفر نامعتبر');
r = normalizeSponsorInput({ isSponsored: true, sponsorName: 'Acme', sponsorPriceUsd: 1, sponsorBudgetUsd: 0.5 });
assert.ok(r.error, 'بودجه کمتر از قیمت یک عضو');
r = normalizeSponsorInput({ isSponsored: true, sponsorName: 'Acme', sponsorPriceUsd: 200, sponsorBudgetUsd: 1000 });
assert.ok(r.error, 'قیمت بیش از سقف مجاز');
console.log('PASS  ورودی‌های نامعتبر رد می‌شوند');

r = normalizeSponsorInput({ isSponsored: true, sponsorName: 'Acme', sponsorPriceUsd: 0.05, sponsorBudgetUsd: 10 });
assert.strictEqual(r.value.maxCompletions, 200); // 10 / 0.05
r = normalizeSponsorInput({ isSponsored: true, sponsorName: 'Acme', sponsorPriceUsd: 0.03, sponsorBudgetUsd: 10 });
assert.strictEqual(r.value.maxCompletions, 333); // floor(10/0.03)=333.33 -> 333
console.log('PASS  ظرفیت از بودجه ÷ قیمت محاسبه می‌شود (رند به پایین)');

// تاریخ پایان
r = normalizeSponsorInput({ isSponsored: false, expiresAt: '2020-01-01' });
assert.ok(r.error, 'تاریخ گذشته باید رد شود');
r = normalizeSponsorInput({ isSponsored: false, expiresAt: '2099-01-01' });
assert.ok(!r.error && r.value.expiresAt instanceof Date);
r = normalizeSponsorInput({ isSponsored: false, expiresAt: 'not-a-date' });
assert.ok(r.error, 'تاریخ نامعتبر باید رد شود');
r = normalizeSponsorInput({ isSponsored: false, expiresAt: '' });
assert.strictEqual(r.value.expiresAt, null, 'خالی یعنی بدون پایان');
console.log('PASS  تاریخ پایان: گذشته/نامعتبر رد می‌شود، خالی یعنی بدون پایان');

// ---- rewardCostUsd
assert.strictEqual(rewardCostUsd(100, 0.0001, 1.38), 100 * 0.0001 * 1.38);
assert.strictEqual(rewardCostUsd(100, 0, 1.38), 0, 'نرخ صفر یعنی هزینه صفر (غیرقابل‌محاسبه)');
console.log('PASS  محاسبه‌ی هزینه‌ی دلاری هر پاداش');

// ---- marginInfo: سناریوی واقعی ضرر که بدون این قابلیت رخ می‌داد
// پاداش 100 پوینت، نرخ 0.0001 GRAM/پوینت، قیمت GRAM=1.38$ => هزینه‌ی هر عضو = 0.0138$
// اگر ادمین اشتباهی قیمت 0.01$ بگذارد، ضرر است.
let m = marginInfo({ reward: 100, rate: 0.0001, usdtUsdPrice: 1.38, priceUsd: 0.01, budgetUsd: 10 });
assert.ok(m.isLoss);
assert.ok(Math.abs(m.profitPerJoinUsd - (0.01 - 0.0138)) < 1e-9);
m = marginInfo({ reward: 100, rate: 0.0001, usdtUsdPrice: 1.38, priceUsd: 0.05, budgetUsd: 10 });
assert.ok(!m.isLoss);
assert.strictEqual(m.capacity, 200);
assert.ok(Math.abs(m.totalProfitUsd - (200 * (0.05 - 0.0138))) < 1e-6);
console.log('PASS  marginInfo: ضرر با قیمت پایین تشخیص داده می‌شود؛ سود کل درست محاسبه می‌شود');

m = marginInfo({ reward: 100, rate: 0, usdtUsdPrice: 0, priceUsd: 0.05, budgetUsd: 10 });
assert.strictEqual(m.canCompute, false, 'بدون نرخ/قیمت GRAM قابل‌محاسبه نیست');
console.log('PASS  بدون تنظیم نرخ/قیمت GRAM، سود/زیان "نامشخص" است نه "امن"');

console.log('ALL PASS');
