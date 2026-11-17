'use strict';
const assert = require('assert');
const { botText } = require('../utils/botMessages');

const registeredAt = new Date('2026-10-30T02:30:00.000Z');
const rates = [10, 5, 3, 1];
const faReferralMessage = botText('referralInitial', 'fa', '@new-user', 10, 1, 10, registeredAt, rates);
assert.match(faReferralMessage, /همین حالا 10 UP پاداش دعوت دریافت کردی/);
assert.match(faReferralMessage, /یک عضو جدید، @new-user/);
assert.match(faReferralMessage, /از این پس 10٪/);
assert.match(faReferralMessage, /برای افزایش درآمد، دوستان بیشتری را دعوت کنید/);

const english = botText('referralInitial', 'en', '@new-user', 10, 1, 10, registeredAt, rates);
assert.match(english, /Congratulations! You just received 10 UP/);
assert.match(english, /Effective rates: L1 10%, L2 5%, L3 3%, and L4\+ 1%/);
assert.doesNotMatch(english, /You will always receive/);
assert.match(english, /Invite more friends to grow your income/);

for (const language of ['fa', 'ps', 'en']) {
  const checkin = botText('dailyCheckinReady', language, 3, 9, 2);
  assert.ok(checkin.includes('3'), `${language} check-in message includes cycle day`);
  assert.ok(checkin.includes('9'), `${language} check-in message includes streak-derived points`);
  assert.ok(checkin.includes('2'), `${language} check-in message includes current streak`);
}

console.log('PASS — referral welcome states the paid 10 UP, L1-L4 rates, eligible-income scope, and supports fa/ps/en');
