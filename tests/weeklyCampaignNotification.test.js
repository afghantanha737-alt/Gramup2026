'use strict';

const assert = require('assert');
const {
  TELEGRAM_ID_PATTERN,
  LANGUAGE_DELAY_MS,
  LANGUAGES,
  CAMPAIGN_COPY,
  botLinkFor,
  campaignMessage,
  isWithinCampaignStartWindow,
  eventKeyFor,
  runWeeklyCampaignNotification
} = require('../utils/weeklyCampaignNotification');

const start = new Date('2026-10-05T00:00:00.000Z');
const duringWindow = new Date('2026-10-05T00:12:00.000Z');
const afterWindow = new Date('2026-10-06T00:00:00.000Z');
const expectedText = 'The new weekly campaign has started! Compete now, complete tasks, earn points, invite friends, climb the leaderboard, and win cash prizes.';
const expectedPs = 'نوې اونيزه کمپاين پيل شو! همدا اوس سيالي وکړئ، دندې بشپړې کړئ، پوائنټونه ترلاسه کړئ، ملګري بلنه ورکړئ، لیډربورډ ته پورته شئ، او نغدي جایزې وګټئ.';
const expectedFa = 'کمپین جدید هفتگی آغاز شد! هماکنون رقابت کنید، وظایف را تکمیل کنید، امتیاز کسب کنید، دوستان خود را دعوت کنید، در جدول امتیازات بالا بروید و برنده جوایز نقدی شوید.';

assert.strictEqual(isWithinCampaignStartWindow(start), true);
assert.strictEqual(isWithinCampaignStartWindow(duringWindow), true);
assert.strictEqual(isWithinCampaignStartWindow(afterWindow), false);
assert.strictEqual(isWithinCampaignStartWindow(new Date('invalid')), false);
assert.strictEqual(botLinkFor({ BOT_USERNAME: '@GramupBot', MINI_APP_SHORT_NAME: 'gramup' }), 'https://t.me/GramupBot/gramup');
assert.strictEqual(botLinkFor({ BOT_USERNAME: 'GramupBot' }), 'https://t.me/GramupBot');
assert.strictEqual(botLinkFor({}), '');
assert.strictEqual(campaignMessage('https://t.me/GramupBot'), `${expectedText}\n\nhttps://t.me/GramupBot`);
assert.strictEqual(campaignMessage('https://t.me/GramupBot', 'ps'), `${expectedPs}\n\nhttps://t.me/GramupBot`);
assert.strictEqual(campaignMessage('https://t.me/GramupBot', 'fa'), `${expectedFa}\n\nhttps://t.me/GramupBot`);
assert.deepStrictEqual(LANGUAGES, ['en', 'ps', 'fa']);
assert.strictEqual(CAMPAIGN_COPY.en, expectedText);
assert.strictEqual(CAMPAIGN_COPY.ps, expectedPs);
assert.strictEqual(CAMPAIGN_COPY.fa, expectedFa);
assert.strictEqual(LANGUAGE_DELAY_MS, 7 * 60 * 1000);
assert.strictEqual(eventKeyFor('2026-10-05', 'user-1'), 'weekly-campaign-start:2026-10-05:user-1');
assert.strictEqual(eventKeyFor('2026-10-05', 'user-1', 'ps'), 'weekly-campaign-start:2026-10-05:user-1:ps');
assert.ok(TELEGRAM_ID_PATTERN.test('708528472'));
assert.ok(!TELEGRAM_ID_PATTERN.test('not-a-telegram-id'));

async function testBroadcast() {
  const users = [
    { _id: 'user-1', telegramId: '1001', isBanned: true, telegramBlockedAt: new Date() },
    { _id: 'user-2', telegramId: '1002', isBanned: false, telegramBlockedAt: null }
  ];
  const sentKeys = new Set();
  const sent = [];
  const waits = [];
  let query;
  const Settings = { getGlobal: async () => ({ weeklyLeaderboardEnabled: true }) };
  const User = {
    find(filter) {
      query = filter;
      return { select() { return { lean: async () => users }; } };
    }
  };
  const sendNotificationOnce = async payload => {
    if (sentKeys.has(payload.eventKey)) return { status: 'duplicate' };
    sentKeys.add(payload.eventKey);
    sent.push(payload);
    return { status: 'sent' };
  };
  const deps = {
    Settings,
    User,
    sendNotificationOnce,
    isTestEnvironment: () => false,
    env: { BOT_USERNAME: 'GramupBot' },
    wait: async ms => { waits.push(ms); }
  };

  const result = await runWeeklyCampaignNotification(duringWindow, deps);
  assert.deepStrictEqual(query, { telegramId: { $regex: TELEGRAM_ID_PATTERN } }, 'no ban or blocked-user filters exclude registered Telegram accounts');
  assert.strictEqual(result.sent, 6);
  assert.strictEqual(result.total, 2);
  assert.deepStrictEqual(result.languages, ['en', 'ps', 'fa']);
  assert.strictEqual(sent.length, 6);
  assert.deepStrictEqual(sent.map(payload => payload.text), [
    campaignMessage('https://t.me/GramupBot', 'en'), campaignMessage('https://t.me/GramupBot', 'en'),
    campaignMessage('https://t.me/GramupBot', 'ps'), campaignMessage('https://t.me/GramupBot', 'ps'),
    campaignMessage('https://t.me/GramupBot', 'fa'), campaignMessage('https://t.me/GramupBot', 'fa')
  ]);
  assert.ok(sent.every(payload => payload.type === 'weekly_reward'));
  assert.deepStrictEqual(waits, [LANGUAGE_DELAY_MS, LANGUAGE_DELAY_MS], 'the worker waits seven minutes between complete language broadcasts');

  const repeated = await runWeeklyCampaignNotification(duringWindow, deps);
  assert.strictEqual(repeated.duplicate, 6, 'the same users receive no duplicate message in any language in the same week');
  assert.strictEqual(sent.length, 6);
  assert.strictEqual((await runWeeklyCampaignNotification(afterWindow, deps)).skipped, 'outside_campaign_start_window');
  assert.strictEqual((await runWeeklyCampaignNotification(duringWindow, { ...deps, isTestEnvironment: () => true })).skipped, 'test_environment');
  assert.strictEqual((await runWeeklyCampaignNotification(duringWindow, { ...deps, Settings: { getGlobal: async () => ({ weeklyLeaderboardEnabled: false }) } })).skipped, 'campaign_disabled');
}

testBroadcast().then(() => {
  console.log('PASS — weekly campaign-start notification sequentially broadcasts all three languages and bot link to all registered Telegram IDs');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
