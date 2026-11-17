'use strict';
const assert = require('assert');
const { botText } = require('../utils/botMessages');

const registeredAt = new Date('2026-10-30T02:30:00.000Z');
const rates = [10, 5, 3, 1];
const faReferralMessage = botText('referralInitial', 'fa', '@new-user', 10, 1, 10, registeredAt, rates);
assert.strictEqual(faReferralMessage, 'همین الان ۱۰ توکن UP به دست آوردی! 🥳 یک عضو جدید با لینک دعوت شما به Gramup پیوست؛ حالا از این پس، ۱۰٪ از کل درآمدهای استخراج او به طور دائمی به حساب شما واریز میشه! تبریک! برای افزایش درآمدهاتون، کاربران بیشتری دعوت کنید! 🚀 [ مشاهده لینک دعوت ]');

const english = botText('referralInitial', 'en', '@new-user', 10, 1, 10, registeredAt, rates);
assert.match(english, /exactly 10 UP were added/);
assert.match(english, /L1 10%, L2 5%, L3 3%, L4 and deeper 1%/);
assert.match(english, /original earnings from approved tasks, daily check-ins, and leaderboard rewards/);
assert.match(english, /referral rewards\/commissions, spins, conversions, withdrawals, and admin adjustments are excluded/);
assert.doesNotMatch(english, /You will always receive/);

for (const language of ['fa', 'ps', 'en']) {
  const checkin = botText('dailyCheckinReady', language, 3, 9, 2);
  assert.ok(checkin.includes('3'), `${language} check-in message includes cycle day`);
  assert.ok(checkin.includes('9'), `${language} check-in message includes streak-derived points`);
  assert.ok(checkin.includes('2'), `${language} check-in message includes current streak`);
}

console.log('PASS — referral welcome states the paid 10 UP, L1-L4 rates, eligible-income scope, and supports fa/ps/en');
