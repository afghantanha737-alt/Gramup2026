'use strict';

// ارسال خودکار پست برداشت‌ها در کانال عمومی پرداخت‌ها
// ENV: PAYOUT_CHANNEL_ID=@YourPayoutChannel (ربات باید ادمین کانال باشد)
const Withdrawal = require('../models/Withdrawal');
const PayoutSequence = require('../models/PayoutSequence');
const { bot } = require('./bot');

const PAYOUT_SEQUENCE_ID = 'completed-withdrawals';
const PAYOUT_CLAIM_TTL_MS = 5 * 60 * 1000;

function maskName(user) {
  const raw = String((user && (user.username || user.firstName)) || 'User').trim();
  return `\u200e${raw.slice(0, 3) || 'User'}***\u200e`;
}

function maskAddress(addr) {
  const a = String(addr || '');
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatAmount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return number.toFixed(9).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function formatAfghanistanDateTime(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kabul',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(date).reduce((result, part) => {
    result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}/${parts.month}/${parts.day} - ${parts.hour}:${parts.minute}`;
}

function normalizePublicUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^@?[A-Za-z0-9_]{5,32}$/.test(raw)) return `https://t.me/${raw.replace(/^@/, '')}`;
  try {
    const url = new URL(raw);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function gramAppUrl() {
  const configured = normalizePublicUrl(process.env.GRAM_APP_PUBLIC_URL || process.env.MINI_APP_PUBLIC_URL);
  if (configured) return configured;
  const botUsername = String(process.env.BOT_USERNAME || '').trim().replace(/^@/, '');
  const shortName = String(process.env.MINI_APP_SHORT_NAME || '').trim();
  if (/^[A-Za-z0-9_]{5,32}$/.test(botUsername) && /^[A-Za-z0-9_-]{1,64}$/.test(shortName)) {
    return `https://t.me/${botUsername}/${shortName}`;
  }
  // Official configured bot fallback; this is a Telegram deep link, not a
  // web_app URL, so it also works from a channel post.
  return normalizePublicUrl(process.env.APP_URL) || 'https://t.me/Gram_up_bot/app';
}

function communityUrl() {
  return normalizePublicUrl(
    process.env.COMMUNITY_CHANNEL_URL ||
    process.env.PUBLIC_CHANNEL_URL ||
    process.env.COMMUNITY_CHANNEL_USERNAME ||
    'https://t.me/GramupOfficialChannel'
  );
}

function payoutKeyboard() {
  const buttons = [
    { text: '🚀 Start Gramup', url: gramAppUrl() },
    { text: '📢 کانال رسمی', url: communityUrl() }
  ].filter(button => button.url);
  return buttons.length ? { inline_keyboard: [buttons] } : undefined;
}

async function post(text) {
  const chatId = process.env.PAYOUT_CHANNEL_ID || '@GramUpPayouts';
  if (!bot || !chatId) return false;
  try {
    const reply_markup = payoutKeyboard();
    await bot.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...(reply_markup ? { reply_markup } : {})
    });
    return true;
  } catch (error) {
    console.error('[payoutChannel] post failed:', error.message || error);
    return false;
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

function buildPayoutReceipt({ payoutNumber, user, withdrawal, totalPaidOut }) {
  const tx = String(withdrawal.txHash || '').trim();
  const txUrl = tx ? `https://tonviewer.com/transaction/${encodeURIComponent(tx)}` : '';
  const txLine = tx
    ? `✊ <a href="${txUrl}">Transaction on TON blockchain</a>`
    : '✊ Transaction on TON blockchain';
  return [
    `💸 Payout #${esc(payoutNumber)}`,
    '',
    `👤 User: ${esc(maskName(user))}`,
    `💰 Amount: ${esc(formatAmount(withdrawal.cryptoAmount))} Gram`,
    `🕒 Time: ${esc(formatAfghanistanDateTime(withdrawal.paidAt || Date.now()))}`,
    `📊 Total Paid Out: ${esc(formatAmount(totalPaidOut))} Gram`,
    '',
    txLine
  ].join('\n');
}

async function reservePayoutNumber(withdrawal) {
  const existing = Number(withdrawal.payoutNumber);
  if (Number.isInteger(existing) && existing > 0) return existing;
  await PayoutSequence.updateOne(
    { _id: PAYOUT_SEQUENCE_ID },
    { $setOnInsert: { value: 185 } },
    { upsert: true }
  );
  const sequence = await PayoutSequence.findOneAndUpdate(
    { _id: PAYOUT_SEQUENCE_ID },
    { $inc: { value: 1 } },
    { new: true }
  ).lean();
  const payoutNumber = Number(sequence.value);
  await Withdrawal.updateOne(
    { _id: withdrawal._id, $or: [{ payoutNumber: null }, { payoutNumber: { $exists: false } }] },
    { $set: { payoutNumber } }
  );
  return payoutNumber;
}

async function claimPayoutNotification(withdrawal) {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - PAYOUT_CLAIM_TTL_MS);
  return Withdrawal.findOneAndUpdate(
    {
      _id: withdrawal._id,
      status: 'paid',
      payoutNotificationSent: { $ne: true },
      $or: [
        { payoutNotificationClaimedAt: null },
        { payoutNotificationClaimedAt: { $exists: false } },
        { payoutNotificationClaimedAt: { $lt: staleBefore } }
      ]
    },
    { $set: { payoutNotificationClaimedAt: now } },
    { new: true }
  ).lean();
}

async function postWithdrawalPaid(user, withdrawal) {
  if (!withdrawal?._id) return { status: 'skipped', reason: 'missing_withdrawal_id' };
  const claimed = await claimPayoutNotification(withdrawal);
  if (!claimed) return { status: 'skipped', reason: 'already_sent_or_in_progress' };

  try {
    const payoutNumber = await reservePayoutNumber(claimed);
    const total = await Withdrawal.aggregate([
      { $match: { status: 'paid' } },
      { $group: { _id: null, total: { $sum: '$cryptoAmount' } } }
    ]);
    const historicalBase = Number(process.env.PAYOUT_TOTAL_BASE_GRAM || 0);
    const totalPaidOut = (Number(total[0]?.total) || 0) + (Number.isFinite(historicalBase) ? historicalBase : 0);
    const sent = await post(buildPayoutReceipt({ payoutNumber, user, withdrawal: claimed, totalPaidOut }));
    if (sent) {
      await Withdrawal.updateOne(
        { _id: withdrawal._id, payoutNotificationSent: { $ne: true } },
        { $set: { payoutNotificationSent: true, payoutNotificationSentAt: new Date(), payoutNumber }, $unset: { payoutNotificationClaimedAt: 1 } }
      );
      return { status: 'sent', payoutNumber, totalPaidOut };
    }
    await Withdrawal.updateOne({ _id: withdrawal._id, payoutNotificationSent: { $ne: true } }, { $unset: { payoutNotificationClaimedAt: 1 } });
    return { status: 'failed', reason: 'telegram_delivery_failed', payoutNumber };
  } catch (error) {
    await Withdrawal.updateOne({ _id: withdrawal._id, payoutNotificationSent: { $ne: true } }, { $unset: { payoutNotificationClaimedAt: 1 } }).catch(() => {});
    console.error('[payoutChannel] paid receipt preparation failed:', error.message || error);
    return { status: 'failed', reason: 'preparation_failed' };
  }
}

module.exports = {
  postWithdrawalRequested,
  postWithdrawalPaid,
  buildPayoutReceipt,
  formatAfghanistanDateTime,
  formatAmount,
  maskName,
  payoutKeyboard
};
