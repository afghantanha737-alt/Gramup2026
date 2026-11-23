'use strict';
const assert = require('assert');
const {
  buildPayoutReceipt,
  formatAfghanistanDateTime,
  formatAmount,
  maskName,
  payoutKeyboard
} = require('../utils/payoutChannel');

process.env.BOT_USERNAME = 'Gram_up_bot';
process.env.MINI_APP_SHORT_NAME = 'app';

assert.strictEqual(formatAmount(0.500000000), '0.5');
assert.strictEqual(formatAmount(142.500000000), '142.5');
assert.strictEqual(maskName({ username: 'nasiruddin' }), '\u200enas***\u200e');
assert.strictEqual(formatAfghanistanDateTime(new Date('2026-11-23T12:15:00.000Z')), '2026/11/23 - 16:45');

const receipt = buildPayoutReceipt({
  payoutNumber: 186,
  user: { username: 'nasiruddin' },
  withdrawal: {
    cryptoAmount: 0.5,
    paidAt: new Date('2026-11-23T12:15:00.000Z'),
    txHash: 'a'.repeat(64)
  },
  totalPaidOut: 142.5
});
assert.match(receipt, /پرداخت شمارهٔ #186 انجام شد/);
assert.match(receipt, /کاربر: ‎nas\*\*\*‎/);
assert.match(receipt, /مبلغ: 0\.5 Gram/);
assert.match(receipt, /زمان: 2026\/11\/23 - 16:45/);
assert.match(receipt, /مجموع پرداختی‌ها تا امروز: 142\.5 Gram/);
assert.match(receipt, /href="https:\/\/tonviewer\.com\/transaction\//);

const noTxReceipt = buildPayoutReceipt({
  payoutNumber: 187,
  user: { firstName: 'علی' },
  withdrawal: { cryptoAmount: 2, paidAt: new Date('2026-11-23T12:15:00.000Z') },
  totalPaidOut: 144.5
});
assert.match(noTxReceipt, /✊ تراکنش پرداخت روی بلاکچین تون/);
assert.doesNotMatch(noTxReceipt, /tonviewer\.com/);

const keyboard = payoutKeyboard();
assert.deepStrictEqual(keyboard.inline_keyboard[0].map(button => button.text), ['🚀 باز کردن گرام اپ', '📢 کانال رسمی']);
assert.strictEqual(keyboard.inline_keyboard[0][0].url, 'https://t.me/Gram_up_bot/app');
assert.strictEqual(keyboard.inline_keyboard[0][1].url, 'https://t.me/GramupOfficialChannel');

console.log('PASS — Persian payout receipt formatting, Kabul time, TON link and keyboard contracts');
