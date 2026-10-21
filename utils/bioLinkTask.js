'use strict';

const Task = require('../models/Task');

const BIO_LINK_TASK_KIND = 'bio_link';
const BIO_LINK_REWARD = 5;
const BIO_LINK_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function normalizeTelegramUsername(value) {
  let username = String(value || '').trim();
  username = username.replace(/^@/, '').replace(/^https?:\/\//i, '').replace(/^(?:www\.)?(?:t\.me|telegram\.me)\//i, '');
  username = username.split(/[/?#\s]/, 1)[0];
  return /^[A-Za-z0-9_]{5,32}$/.test(username) ? username.toLowerCase() : '';
}

function extractTelegramUsernames(text) {
  const value = String(text || '');
  const found = new Set();
  const linkPattern = /(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/([A-Za-z0-9_]{5,32})(?=$|[\s/?#.,!;:)\]])/gi;
  const mentionPattern = /(?:^|[\s([{])@([A-Za-z0-9_]{5,32})(?=$|[\s),.!?;:\]}])/g;
  for (const match of value.matchAll(linkPattern)) {
    const username = normalizeTelegramUsername(match[1]);
    if (username) found.add(username);
  }
  for (const match of value.matchAll(mentionPattern)) {
    const username = normalizeTelegramUsername(match[1]);
    if (username) found.add(username);
  }
  return found;
}

function bioContainsAllowedLink(bio, allowedUsernames) {
  const targets = new Set((allowedUsernames || []).map(normalizeTelegramUsername).filter(Boolean));
  if (!targets.size) return false;
  const present = extractTelegramUsernames(bio);
  return [...targets].some(username => present.has(username));
}

function nextBioClaimAt(now = new Date()) {
  const time = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(time)) throw new TypeError('A valid completion time is required.');
  return new Date(time + BIO_LINK_COOLDOWN_MS);
}

function bioLinkTaskDefinition() {
  const botUsername = normalizeTelegramUsername(process.env.BOT_USERNAME || '');
  return {
    title: 'لینک Gramup را در بیوی تلگرام قرار دهید',
    description: 'لینک ربات Gramup یا یکی از کانال‌های رسمی فعال را در بیوی تلگرام خود قرار دهید و برای بررسی و دریافت ۵ پوینت بزنید. هر ۲۴ ساعت یک‌بار قابل دریافت است.',
    type: 'custom',
    verifyType: 'telegram',
    taskKind: BIO_LINK_TASK_KIND,
    chatId: '',
    url: botUsername ? `https://t.me/${botUsername}` : '',
    reward: BIO_LINK_REWARD,
    maxCompletions: null,
    isActive: true,
    isSpecialOfDay: false,
    isSponsored: false,
    expiresAt: null
  };
}

async function ensureBioLinkTask() {
  const definition = bioLinkTaskDefinition();
  return Task.findOneAndUpdate(
    { taskKind: BIO_LINK_TASK_KIND },
    { $set: definition },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

module.exports = {
  BIO_LINK_TASK_KIND,
  BIO_LINK_REWARD,
  BIO_LINK_COOLDOWN_MS,
  normalizeTelegramUsername,
  extractTelegramUsernames,
  bioContainsAllowedLink,
  nextBioClaimAt,
  bioLinkTaskDefinition,
  ensureBioLinkTask
};
