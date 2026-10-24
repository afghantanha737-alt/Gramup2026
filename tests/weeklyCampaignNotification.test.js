'use strict';

const assert = require('assert');
const {
  TELEGRAM_ID_PATTERN,
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

assert.strictEqual(isWithinCampaignStartWindow(start), true);
assert.strictEqual(isWithinCampaignStartWindow(duringWindow), true);
assert.strictEqual(isWithinCampaignStartWindow(afterWindow), false);
assert.strictEqual(isWithinCampaignStartWindow(new Date('invalid')), false);
assert.strictEqual(botLinkFor({ BOT_USERNAME: '@GramupBot', MINI_APP_SHORT_NAME: 'gramup' }), 'https://t.me/GramupBot/gramup');
assert.strictEqual(botLinkFor({ BOT_USERNAME: 'GramupBot' }), 'https://t.me/GramupBot');
assert.strictEqual(botLinkFor({}), '');
assert.strictEqual(campaignMessage('https://t.me/GramupBot'), `${expectedText}\n\nhttps://t.me/GramupBot`);
assert.strictEqual(eventKeyFor('2026-10-05', 'user-1'), 'weekly-campaign-start:2026-10-05:user-1');
assert.ok(TELEGRAM_ID_PATTERN.test('708528472'));
assert.ok(!TELEGRAM_ID_PATTERN.test('not-a-telegram-id'));

async function testBroadcast() {
  const users = [
    { _id: 'user-1', telegramId: '1001', isBanned: true, telegramBlockedAt: new Date() },
    { _id: 'user-2', telegramId: '1002', isBanned: false, telegramBlockedAt: null }
  ];
  const sentKeys = new Set();
  const sent = [];
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
    env: { BOT_USERNAME: 'GramupBot' }
  };

  const result = await runWeeklyCampaignNotification(duringWindow, deps);
  assert.deepStrictEqual(query, { telegramId: { $regex: TELEGRAM_ID_PATTERN } }, 'no ban or blocked-user filters exclude registered Telegram accounts');
  assert.strictEqual(result.sent, 2);
  assert.strictEqual(sent.length, 2);
  assert.ok(sent.every(payload => payload.text === campaignMessage('https://t.me/GramupBot')));
  assert.ok(sent.every(payload => payload.type === 'weekly_reward'));

  const repeated = await runWeeklyCampaignNotification(duringWindow, deps);
  assert.strictEqual(repeated.duplicate, 2, 'the same users receive no duplicate campaign message in the same week');
  assert.strictEqual(sent.length, 2);
  assert.strictEqual((await runWeeklyCampaignNotification(afterWindow, deps)).skipped, 'outside_campaign_start_window');
  assert.strictEqual((await runWeeklyCampaignNotification(duringWindow, { ...deps, isTestEnvironment: () => true })).skipped, 'test_environment');
  assert.strictEqual((await runWeeklyCampaignNotification(duringWindow, { ...deps, Settings: { getGlobal: async () => ({ weeklyLeaderboardEnabled: false }) } })).skipped, 'campaign_disabled');
}

testBroadcast().then(() => {
  console.log('PASS — weekly campaign-start notification broadcasts the English message and bot link once to all registered Telegram IDs');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
