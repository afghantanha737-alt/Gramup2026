'use strict';

const MAX_TELEGRAM_CHAT_ID = (1n << 52n) - 1n;
const LATEST_POST_COOLDOWN_HOURS = 3;
const LATEST_POST_COOLDOWN_MS = LATEST_POST_COOLDOWN_HOURS * 60 * 60 * 1000;
const LATEST_POST_OPEN_WAIT_SECONDS = 10;
const LATEST_POST_OPEN_WAIT_MS = LATEST_POST_OPEN_WAIT_SECONDS * 1000;

function dateMilliseconds(value) {
  if (value == null) return NaN;
  const milliseconds = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(milliseconds) ? milliseconds : NaN;
}

function isLatestPostCooldownActive(nextAvailableAt, now = new Date()) {
  const nextTime = dateMilliseconds(nextAvailableAt);
  const nowTime = dateMilliseconds(now);
  return Number.isFinite(nextTime) && Number.isFinite(nowTime) && nextTime > nowTime;
}

function isLatestPostOpenValid({ openedAt, lastCompletedAt, now = new Date() }) {
  const openedTime = dateMilliseconds(openedAt);
  const nowTime = dateMilliseconds(now);
  if (!Number.isFinite(openedTime) || !Number.isFinite(nowTime) || openedTime > nowTime) return false;
  const completedTime = dateMilliseconds(lastCompletedAt);
  if (Number.isFinite(completedTime) && openedTime <= completedTime) return false;
  return nowTime - openedTime >= LATEST_POST_OPEN_WAIT_MS;
}

function nextLatestPostAvailableAt(now = new Date()) {
  const nowTime = dateMilliseconds(now);
  if (!Number.isFinite(nowTime)) throw new TypeError('A valid completion time is required.');
  return new Date(nowTime + LATEST_POST_COOLDOWN_MS);
}

function isValidTelegramChannelId(value) {
  const text = String(value ?? '').trim();
  if (!/^-?\d+$/.test(text)) return false;
  if ((text.startsWith('-') ? text.length - 1 : text.length) > 16) return false;
  try {
    const id = BigInt(text);
    return id !== 0n && id >= -MAX_TELEGRAM_CHAT_ID && id <= MAX_TELEGRAM_CHAT_ID;
  } catch {
    return false;
  }
}

function isValidTelegramChannelUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    return parsed.protocol === 'https:' && ['t.me', 'www.t.me', 'telegram.me', 'www.telegram.me'].includes(parsed.hostname.toLowerCase()) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function isSingleEmoji(value) {
  const text = String(value || '').trim();
  if (!text || text.length > 32 || /\s/u.test(text) || !/\p{Extended_Pictographic}/u.test(text)) return false;
  if (typeof Intl.Segmenter === 'function') {
    const segments = Array.from(new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text));
    return segments.length === 1;
  }
  return Array.from(text).length <= 4;
}

function validateLatestPostConfig({ chatId, url, requiredReaction, cooldownHours }) {
  if (!isValidTelegramChannelId(chatId)) return 'برای Latest Post Engagement یک Telegram Channel ID عددی معتبر (حداکثر ۵۲ بیت) وارد کنید؛ @username پذیرفته نمی‌شود.';
  if (!isValidTelegramChannelUrl(url)) return 'لینک کانال باید یک URL امن https://t.me/... یا https://telegram.me/... باشد.';
  if (!isSingleEmoji(requiredReaction)) return 'یک Required Reaction معتبر (یک ایموجی) الزامی است تا انجام Task قابل تأیید باشد.';
  const cooldown = Number(cooldownHours);
  if (!Number.isInteger(cooldown) || cooldown < 1 || cooldown > 720) return 'Cooldown باید عدد صحیح بین ۱ تا ۷۲۰ ساعت باشد.';
  return null;
}

function normalizeReactionEmoji(value) {
  return String(value || '').trim().replace(/[\uFE0E\uFE0F]/gu, '');
}

function extractReactionList(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter(item => item && item.type === 'emoji' && typeof item.emoji === 'string')
    .map(item => normalizeReactionEmoji(item.emoji));
}

function extractReactionEmojis(update) {
  return extractReactionList(update?.message_reaction?.new_reaction);
}

function extractAddedReactionEmojis(update) {
  const reaction = update?.message_reaction;
  const previous = new Set(extractReactionList(reaction?.old_reaction));
  return extractReactionList(reaction?.new_reaction).filter(emoji => !previous.has(emoji));
}

function isReactionSatisfied(reactionEmojis, requiredReaction) {
  const expected = normalizeReactionEmoji(requiredReaction);
  return Array.isArray(reactionEmojis) && reactionEmojis.some(item => normalizeReactionEmoji(item) === expected);
}

function isFreshRequiredReaction({ reactionState, requiredReaction, latestPostDate, nextAvailableAt, lastReactionEventAt }) {
  const eventAt = reactionState?.lastEventAt instanceof Date ? reactionState.lastEventAt.getTime() : NaN;
  if (!Number.isFinite(eventAt)) return false;
  if (!isReactionSatisfied(reactionState.reactionEmojis, requiredReaction)) return false;
  if (!isReactionSatisfied(reactionState.lastAddedReactionEmojis, requiredReaction)) return false;

  const latestPostTime = latestPostDate instanceof Date ? latestPostDate.getTime() : 0;
  const availableTime = nextAvailableAt instanceof Date ? nextAvailableAt.getTime() : 0;
  const eligibleAt = Math.max(latestPostTime, availableTime);
  if (eligibleAt && eventAt < Math.floor(eligibleAt / 1000) * 1000) return false;

  const previousEventAt = lastReactionEventAt instanceof Date ? lastReactionEventAt.getTime() : 0;
  if (previousEventAt && eventAt <= previousEventAt) return false;
  return true;
}

function buildRecurringTaskSourceId(taskId, userId, cycle) {
  const cycleNumber = Number(cycle);
  if (!taskId || !userId || !Number.isSafeInteger(cycleNumber) || cycleNumber < 1) {
    throw new TypeError('A task ID, user ID, and positive integer recurring cycle are required.');
  }
  return `task:${taskId}:user:${userId}:cycle:${cycleNumber}`;
}

module.exports = {
  LATEST_POST_COOLDOWN_HOURS,
  LATEST_POST_OPEN_WAIT_SECONDS,
  isLatestPostCooldownActive,
  isLatestPostOpenValid,
  nextLatestPostAvailableAt,
  isValidTelegramChannelId,
  isValidTelegramChannelUrl,
  isSingleEmoji,
  validateLatestPostConfig,
  normalizeReactionEmoji,
  extractReactionEmojis,
  extractAddedReactionEmojis,
  isReactionSatisfied,
  isFreshRequiredReaction,
  buildRecurringTaskSourceId
};
