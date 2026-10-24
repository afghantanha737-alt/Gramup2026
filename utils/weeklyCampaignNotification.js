'use strict';

const { startOfUtcWeek, weekKey } = require('./weeklyLeaderboard');
const TELEGRAM_ID_PATTERN = /^\d{1,20}$/;
const START_WINDOW_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 20;
const BATCH_DELAY_MS = 1100;
const LANGUAGE_DELAY_MS = 7 * 60 * 1000;
const CAMPAIGN_COPY = Object.freeze({
  en: 'The new weekly campaign has started! Compete now, complete tasks, earn points, invite friends, climb the leaderboard, and win cash prizes.',
  ps: 'نوې اونيزه کمپاين پيل شو! همدا اوس سيالي وکړئ، دندې بشپړې کړئ، پوائنټونه ترلاسه کړئ، ملګري بلنه ورکړئ، لیډربورډ ته پورته شئ، او نغدي جایزې وګټئ.',
  fa: 'کمپین جدید هفتگی آغاز شد! هماکنون رقابت کنید، وظایف را تکمیل کنید، امتیاز کسب کنید، دوستان خود را دعوت کنید، در جدول امتیازات بالا بروید و برنده جوایز نقدی شوید.'
});
const LANGUAGES = Object.freeze(['en', 'ps', 'fa']);

function botLinkFor(env = process.env) {
  const username = String(env.BOT_USERNAME || '').trim().replace(/^@/, '');
  if (!username) return '';
  const shortName = String(env.MINI_APP_SHORT_NAME || '').trim();
  return shortName ? `https://t.me/${username}/${shortName}` : `https://t.me/${username}`;
}

function campaignMessage(botLink, language = 'en') {
  const copy = CAMPAIGN_COPY[language] || CAMPAIGN_COPY.en;
  return `${copy}\n\n${botLink}`;
}

function isWithinCampaignStartWindow(now = new Date()) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return false;
  const start = startOfUtcWeek(now);
  return now.getTime() >= start.getTime() && now.getTime() - start.getTime() < START_WINDOW_MS;
}

function eventKeyFor(week, userId, language = 'en') {
  const base = `weekly-campaign-start:${week}:${userId}`;
  return language === 'en' ? base : `${base}:${language}`;
}

async function runWeeklyCampaignNotification(now = new Date(), dependencies = {}) {
  if (!isWithinCampaignStartWindow(now)) return { sent: 0, skipped: 'outside_campaign_start_window' };
  const isTestEnvironment = dependencies.isTestEnvironment || require('./weeklyChallengeStartNotification').isTestEnvironment;
  if (isTestEnvironment()) return { sent: 0, skipped: 'test_environment' };

  const botLink = botLinkFor(dependencies.env || process.env);
  if (!botLink) return { sent: 0, skipped: 'bot_username_unconfigured' };

  const Settings = dependencies.Settings || require('../models/Settings');
  const User = dependencies.User || require('../models/User');
  const sendNotificationOnce = dependencies.sendNotificationOnce || require('./notificationDelivery').sendNotificationOnce;
  const wait = dependencies.wait || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const settings = await Settings.getGlobal();
  if (settings.weeklyLeaderboardEnabled === false) return { sent: 0, skipped: 'campaign_disabled' };

  // All registered Telegram accounts are included; banned/blocked users are not
  // pre-filtered, so every valid Telegram ID receives an attempted delivery.
  const users = await User.find({ telegramId: { $regex: TELEGRAM_ID_PATTERN } })
    .select('_id telegramId')
    .lean();
  if (!users.length) return { weekKey: weekKey(now), sent: 0, duplicate: 0, failed: 0, total: 0 };

  const currentWeek = weekKey(now);
  let sent = 0;
  let duplicate = 0;
  let failed = 0;

  for (let languageIndex = 0; languageIndex < LANGUAGES.length; languageIndex += 1) {
    const language = LANGUAGES[languageIndex];
    const text = campaignMessage(botLink, language);
    for (let offset = 0; offset < users.length; offset += BATCH_SIZE) {
      const batch = users.slice(offset, offset + BATCH_SIZE);
      const results = await Promise.allSettled(batch.map(user => sendNotificationOnce({
        // The English key retains compatibility with the prior single-language release.
        eventKey: eventKeyFor(currentWeek, user._id, language),
        // Reuse the existing delivery enum/collection; no new schema is required.
        type: 'weekly_reward',
        user: user._id,
        telegramId: user.telegramId,
        text
      })));
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value?.status === 'sent') sent += 1;
        else if (result.status === 'fulfilled' && result.value?.status === 'duplicate') duplicate += 1;
        else failed += 1;
      }
      if (offset + BATCH_SIZE < users.length) await wait(BATCH_DELAY_MS);
    }
    if (languageIndex < LANGUAGES.length - 1) await wait(LANGUAGE_DELAY_MS);
  }

  return { weekKey: currentWeek, sent, duplicate, failed, total: users.length, languages: [...LANGUAGES] };
}

module.exports = {
  TELEGRAM_ID_PATTERN,
  START_WINDOW_MS,
  LANGUAGE_DELAY_MS,
  LANGUAGES,
  CAMPAIGN_COPY,
  botLinkFor,
  campaignMessage,
  isWithinCampaignStartWindow,
  eventKeyFor,
  runWeeklyCampaignNotification
};
