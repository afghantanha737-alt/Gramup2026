'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  buildWithdrawalRequest,
  buildPayoutReceipt,
  formatAfghanistanDateTime,
  formatAmount,
  maskName,
  maskIdentifier,
  payoutKeyboard
} = require('../utils/payoutChannel');

process.env.BOT_USERNAME = 'Gram_up_bot';
process.env.MINI_APP_SHORT_NAME = 'app';

assert.strictEqual(formatAmount(0.500000000), '0.5');
assert.strictEqual(formatAmount(142.500000000), '142.5');
assert.strictEqual(maskName({ username: 'nasiruddin' }), '\u200enas***\u200e');
assert.strictEqual(maskIdentifier('123456789'), '123***89');
assert.strictEqual(formatAfghanistanDateTime(new Date('2026-11-23T12:15:00.000Z')), '2026/11/23 - 16:45');

const receipt = buildPayoutReceipt({
  payoutNumber: 186,
  user: { username: 'nasiruddin', telegramId: '123456789' },
  withdrawal: {
    cryptoAmount: 0.5,
    token: 'USDT',
    address: 'EQ' + 'a'.repeat(46),
    paidAt: new Date('2026-11-23T12:15:00.000Z'),
    txHash: 'a'.repeat(64)
  },
  totalPaidOut: 142.5
});
assert.match(receipt, /✅ Payout Complete\n💸 Payout #186\n\n👤 User: ‎nas\*\*\*‎\n🆔 Telegram ID: <code>123\*\*\*89<\/code>\n\n💰 Amount: 0\.5 USDT\n🌐 Network: TON Mainnet\n👛 Wallet: <code>EQa{46}<\/code>\n🔖 TxID: <code>a{64}<\/code>\n\n🕒 Time: 2026\/11\/23 - 16:45\n\n📊 Total Paid Out: 142\.5 USDT\n\n/);
assert.match(receipt, /Transaction on TON blockchain/);
assert.match(receipt, /href="https:\/\/tonviewer\.com\/transaction\//);

const noTxReceipt = buildPayoutReceipt({
  payoutNumber: 187,
  user: { firstName: 'علی' },
  withdrawal: { cryptoAmount: 2, paidAt: new Date('2026-11-23T12:15:00.000Z') },
  totalPaidOut: 144.5
});
assert.match(noTxReceipt, /✊ Transaction on TON blockchain/);
assert.doesNotMatch(noTxReceipt, /tonviewer\.com/);
assert.match(noTxReceipt, /🆔 Telegram ID: <code>N\/A<\/code>/);
assert.match(noTxReceipt, /🌐 Network: TON Mainnet/);
assert.match(noTxReceipt, /👛 Wallet: <code>N\/A<\/code>/);
assert.match(noTxReceipt, /🔖 TxID: <code>N\/A<\/code>/);

const requestReceipt = buildWithdrawalRequest(
  { username: 'nasiruddin' },
  {
    cryptoAmount: 1.25,
    token: 'USDT',
    address: 'EQ' + 'a'.repeat(46),
    _id: 'withdrawal-123456',
    createdAt: new Date('2026-11-23T12:15:00.000Z')
  }
);
assert.match(requestReceipt, /New withdrawal request<\/b>\n\n👤 User: ‎nas\*\*\*‎\n\n💰 Amount: <b>1\.25 USDT<\/b>\n\n👛 Wallet:/);
assert.match(requestReceipt, /\n\n🆔 Request: #123456\n\n📅 2026-11-23 12:15 UTC\n\n⏳ Status: Pending review$/);

const transactionHash = 'a'.repeat(64);
const keyboard = payoutKeyboard(transactionHash);
assert.deepStrictEqual(keyboard.inline_keyboard[0].map(button => button.text), ['🔍 View Transaction', 'Open Gramup']);
assert.strictEqual(keyboard.inline_keyboard[0][0].url, `https://tonviewer.com/transaction/${transactionHash}`);
assert.strictEqual(keyboard.inline_keyboard[0][1].url, 'https://t.me/Gram_up_bot/app');

const withdrawalImage = path.join(__dirname, '..', 'public', 'img', 'withdraw-successfully.webp');
assert.ok(fs.existsSync(withdrawalImage), 'default withdrawal-success image is committed');
assert.ok(fs.statSync(withdrawalImage).size > 1000, 'default withdrawal-success image is non-empty');
const payoutChannelSource = fs.readFileSync(path.join(__dirname, '..', 'utils', 'payoutChannel.js'), 'utf8');
assert.match(payoutChannelSource, /bot\.sendPhoto\(chatId, image, \{/);
assert.match(payoutChannelSource, /withdraw-successfully\.webp/);
assert.match(payoutChannelSource, /caption: text/);
assert.match(payoutChannelSource, /normalizeTonTxHash/);
assert.match(payoutChannelSource, /payoutKeyboard\(txHash\)/);
assert.match(payoutChannelSource, /View Transaction/);
assert.match(payoutChannelSource, /Open Gramup/);

console.log('PASS — English payout receipt formatting, Kabul time, TON link and keyboard contracts');
