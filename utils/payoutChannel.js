'use strict';

// ارسال خودکار پست برداشت‌ها در کانال عمومی پرداخت‌ها (مدرک پرداخت برای AdsGram بند ۸)
// ENV: PAYOUT_CHANNEL_ID=@YourPayoutChannel  (ربات باید ادمین کانال باشد)
const { bot } = require('./bot');

function maskName(user) {
  const raw = String((user && (user.username || user.firstName)) || 'user');
  if (raw.length <= 3) return raw[0] + '***';
  return raw.slice(0, 3) + '***';
}

function maskAddress(addr) {
  const a = String(addr || '');
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function post(text) {
  const chatId = process.env.PAYOUT_CHANNEL_ID;
  if (!bot || !chatId) return;
  try {
    await bot.sendMessage(chatId, text, { parse_mode: 'HTML', disable_web_page_preview: true });
  } catch (error) {
    console.error('[payoutChannel] post failed:', error.message);
  }
}

function postWithdrawalRequested(user, withdrawal) {
  const date = new Date(withdrawal.createdAt || Date.now()).toISOString().slice(0, 16).replace('T', ' ');
  return post(
    `🕓 <b>New withdrawal request</b>\n\n` +
    `👤 User: ${esc(maskName(user))}\n` +
    `💰 Amount: <b>${esc(withdrawal.cryptoAmount)} ${esc(withdrawal.token || 'GRAM')}</b>\n` +
    `👛 Wallet: <code>${esc(maskAddress(withdrawal.address))}</code>\n` +
    `🆔 Request: #${esc(String(withdrawal._id).slice(-6))}\n` +
    `📅 ${date} UTC\n` +
    `⏳ Status: Pending review`
  );
}

function postWithdrawalPaid(user, withdrawal) {
  const date = new Date(withdrawal.paidAt || Date.now()).toISOString().slice(0, 16).replace('T', ' ');
  const tx = String(withdrawal.txHash || '');
  const link = tx ? `https://tonviewer.com/transaction/${encodeURIComponent(tx)}` : '';
  return post(
    `✅ <b>Withdrawal paid</b>\n\n` +
    `👤 User: ${esc(maskName(user))}\n` +
    `💰 Amount: <b>${esc(withdrawal.cryptoAmount)} ${esc(withdrawal.token || 'GRAM')}</b>\n` +
    `👛 Wallet: <code>${esc(maskAddress(withdrawal.address))}</code>\n` +
    `🆔 Request: #${esc(String(withdrawal._id).slice(-6))}\n` +
    `📅 Paid: ${date} UTC\n` +
    (link ? `🔗 <a href="${link}">View transaction on blockchain</a>\n<code>${esc(tx)}</code>` : '')
  );
}

module.exports = { postWithdrawalRequested, postWithdrawalPaid };
