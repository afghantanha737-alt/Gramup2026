'use strict';

const fs = require('fs');
const path = require('path');
const { contactRequestKeyboard } = require('./telegramPhoneContact');
const { isVerifiedAllowedPhone } = require('./telegramPhoneContact');
const START_COMMAND = /^\/start(?:@[A-Za-z0-9_]+)?(?:\s+([A-Za-z0-9_-]{1,64}))?\s*$/;
const DEFAULT_WELCOME_IMAGE_PATH = path.join(__dirname, '..', 'public', 'img', 'welcome-bot.jpg');

function parseTelegramStart(text) {
  const match = START_COMMAND.exec(String(text || '').trim());
  return match ? { payload: match[1] || null } : null;
}

function buildMiniAppUrl(appUrl, payload, isNewUser) {
  if (!appUrl) return '';
  try {
    const url = new URL(String(appUrl));
    // Referral payloads are only applied to a newly registered account.
    if (isNewUser && payload) url.searchParams.set('ref', payload);
    return url.toString();
  } catch {
    return '';
  }
}

function normalizePublicUrl(value, fallback = '') {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  if (/^@?[A-Za-z0-9_]{5,32}$/.test(raw)) return `https://t.me/${raw.replace(/^@/, '')}`;
  try {
    const url = new URL(raw);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}

function buildWelcomeReplyMarkup(webAppUrl) {
  if (!webAppUrl) return undefined;
  const communityUrl = normalizePublicUrl(
    process.env.COMMUNITY_CHANNEL_URL ||
    process.env.PUBLIC_CHANNEL_URL ||
    process.env.COMMUNITY_CHANNEL_USERNAME,
    'https://t.me/GramupOfficialChannel'
  );
  const payoutsUrl = normalizePublicUrl(
    process.env.PAYOUT_CHANNEL_URL || process.env.PAYOUT_CHANNEL_ID,
    'https://t.me/GramUpPayouts'
  );
  return {
    inline_keyboard: [
      [{ text: 'Open Mini App', web_app: { url: webAppUrl } }],
      [
        { text: 'Community', url: communityUrl },
        { text: 'Payouts', url: payoutsUrl }
      ]
    ]
  };
}

function welcomeTriggerKey(value) {
  const normalized = String(value || '').trim();
  return normalized ? `payload:${normalized.slice(0, 64)}` : '';
}

async function claimWelcomeTrigger(User, user, triggerKey) {
  if (!triggerKey || !User || !user?._id || typeof User.updateOne !== 'function') return true;
  const result = await User.updateOne(
    { _id: user._id, lastAutoWelcomeKey: { $ne: triggerKey } },
    { $set: { lastAutoWelcomeKey: triggerKey } }
  );
  return Number(result?.modifiedCount ?? result?.nModified ?? 0) > 0;
}

async function releaseWelcomeTrigger(User, user, triggerKey) {
  if (!triggerKey || !User || !user?._id || typeof User.updateOne !== 'function') return;
  await User.updateOne(
    { _id: user._id, lastAutoWelcomeKey: triggerKey },
    { $set: { lastAutoWelcomeKey: '' } }
  ).catch(() => {});
}

async function sendWelcomeMessage({
  message,
  user,
  bot,
  appUrl,
  payload = null,
  isNewUser = false,
  botText,
  User,
  welcomeImagePath = process.env.WELCOME_IMAGE_PATH || DEFAULT_WELCOME_IMAGE_PATH,
  triggerKey = '',
  logger = console
}) {
  const claimed = await claimWelcomeTrigger(User, user, triggerKey);
  if (!claimed) return { sent: false, hasMiniAppButton: Boolean(appUrl) };

  const language = user?.language || 'fa';
  const webAppUrl = buildMiniAppUrl(appUrl, payload, isNewUser);
  const replyMarkup = buildWelcomeReplyMarkup(webAppUrl);
  const fallbackName = language === 'en' ? 'friend' : 'دوست عزیز';
  const name = message?.from?.first_name || user?.firstName || fallbackName;
  const options = replyMarkup ? { reply_markup: replyMarkup } : {};
  const welcomeText = botText('welcome', language, name);
  let welcomeImage = null;
  if (welcomeImagePath) {
    try {
      welcomeImage = fs.readFileSync(welcomeImagePath);
    } catch (error) {
      logger.warn?.('Telegram welcome image could not be read; using text fallback:', error.message || error);
    }
  }

  try {
    if (welcomeImage && typeof bot.sendPhoto === 'function') {
      await bot.sendPhoto(message.chat.id, welcomeImage, { caption: welcomeText, ...options });
    } else {
      await bot.sendMessage(message.chat.id, welcomeText, options);
    }
  } catch (error) {
    await releaseWelcomeTrigger(User, user, triggerKey);
    throw error;
  }
  return { sent: true, hasMiniAppButton: Boolean(replyMarkup) };
}

async function handleTelegramStart({
  message,
  bot,
  User,
  appUrl,
  generateReferralCode,
  linkReferralByCode,
  botText,
  welcomeImagePath = process.env.WELCOME_IMAGE_PATH || DEFAULT_WELCOME_IMAGE_PATH,
  logger = console
}) {
  const command = parseTelegramStart(message?.text);
  if (!command) return null;
  if (!message?.from?.id || !message?.chat?.id || !bot || !User) {
    throw new TypeError('A valid Telegram message, bot client, and User model are required.');
  }

  const telegramId = String(message.from.id);
  let user = await User.findOne({ telegramId });
  let isNewUser = !user;

  if (!user) {
    try {
      user = await User.create({
        telegramId,
        username: message.from.username || '',
        firstName: message.from.first_name || '',
        lastName: message.from.last_name || '',
        referralCode: generateReferralCode(telegramId)
      });
    } catch (error) {
      // Concurrent Telegram deliveries can race on User.telegramId's unique index.
      if (error?.code !== 11000) throw error;
      user = await User.findOne({ telegramId });
      if (!user) throw error;
      isNewUser = false;
    }
  }

  const language = user.language || 'fa';
  if (command.payload === 'phone_contact') {
    if (isVerifiedAllowedPhone(user)) {
      await bot.sendMessage(message.chat.id, botText('phoneContactVerified', language), { reply_markup: { remove_keyboard: true } });
    } else {
      await bot.sendMessage(
        message.chat.id,
        botText('phoneContactRequest', language),
        { reply_markup: contactRequestKeyboard(botText('phoneShareButton', language)) }
      );
    }
    return { isNewUser, hadReferralPayload: false, welcomeSent: true, hasMiniAppButton: false, phoneContactRequested: true };
  }

  if (isNewUser && command.payload) {
    user.pendingReferralIdentifier = String(command.payload).slice(0, 64);
    if (typeof user.save === 'function') await user.save();
  }

  const sentWelcome = await sendWelcomeMessage({
    message,
    user,
    bot,
    appUrl,
    payload: command.payload,
    isNewUser,
    botText,
    User,
    welcomeImagePath,
    triggerKey: welcomeTriggerKey(command.payload),
    logger
  });

  return {
    isNewUser,
    hadReferralPayload: Boolean(command.payload),
    welcomeSent: true,
    hasMiniAppButton: sentWelcome.hasMiniAppButton
  };
}

module.exports = {
  parseTelegramStart,
  buildMiniAppUrl,
  buildWelcomeReplyMarkup,
  welcomeTriggerKey,
  sendWelcomeMessage,
  handleTelegramStart
};
