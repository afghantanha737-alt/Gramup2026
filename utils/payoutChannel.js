'use strict';

// ارسال خودکار پست برداشت‌ها در کانال عمومی پرداخت‌ها (مدرک پرداخت برای AdsGram بند ۸)
// ENV: PAYOUT_CHANNEL_ID=@YourPayoutChannel  (ربات باید ادمین کانال باشد)
// Optional public links: COMMUNITY_CHANNEL_URL or COMMUNITY_CHANNEL_USERNAME.
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
    // A t.me Mini App deep link is used instead of web_app markup because
    // Telegram channel posts cannot reliably launch web_app buttons directly.
    return `https://t.me/${botUsername}/${shortName}`;
  }
  return normalizePublicUrl(process.env.APP_URL);
}

function communityUrl() {
  return normalizePublicUrl(
    process.env.COMMUNITY_CHANNEL_URL ||
    process.env.PUBLIC_CHANNEL_URL ||
    process.env.COMMUNITY_CHANNEL_USERNAME ||
    // Backward-compatible fallback when the payout channel itself is public.
    process.env.PAYOUT_CHANNEL_ID
  );
}

function payoutKeyboard() {
  const rows = [];
  const appUrl = gramAppUrl();
  const community = communityUrl();
  const buttons = [];
  if (appUrl) buttons.push({ text: '🚀 Start Gram App', url: appUrl });
  if (community) buttons.push({ text: '🌐 Community', url: community });
  if (buttons.length) rows.push(buttons);
  return rows.length ? { inline_keyboard: rows } : undefined;
}

async function post(text) {
  const chatId = process.env.PAYOUT_CHANNEL_ID;
  if (!bot || !chatId) return;
  try {
    const reply_markup = payoutKeyboard();
    await bot.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...(reply_markup ? { reply_markup } : {})
    });
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
