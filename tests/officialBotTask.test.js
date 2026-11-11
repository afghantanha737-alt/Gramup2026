'use strict';

const assert = require('assert');
const fs = require('fs');
const { officialBotTaskDefinition, OFFICIAL_BOT_TASK_KIND, OFFICIAL_BOT_TASK_REWARD, VERIFY_CHAT_PAYLOAD } = require('../utils/officialBotTask');
const { handleTelegramStart } = require('../utils/telegramStart');

const definition = officialBotTaskDefinition({ botUsername: '@GramupBot' });
assert.strictEqual(OFFICIAL_BOT_TASK_KIND, 'official_bot');
assert.strictEqual(OFFICIAL_BOT_TASK_REWARD, 5);
assert.strictEqual(VERIFY_CHAT_PAYLOAD, 'verify_chat');
assert.strictEqual(definition.title, 'Start Official Bot');
assert.strictEqual(definition.reward, 5);
assert.strictEqual(definition.url, 'https://t.me/GramupBot?start=verify_chat');
assert.strictEqual(definition.taskKind, 'official_bot');
assert.strictEqual(definition.isSpecialOfDay, true);

const taskModel = fs.readFileSync('models/Task.js', 'utf8');
assert.match(taskModel, /'official_bot'/);
const server = fs.readFileSync('server.js', 'utf8');
assert.match(server, /officialBotTask.*ensureOfficialBotTask/);
const webhook = fs.readFileSync('routes/telegramWebhook.js', 'utf8');
assert.match(webhook, /activateOfficialBotTask/);

function fixture() {
  const users = new Map([['42', { _id: 'user-42', telegramId: '42', language: 'en', lastAutoWelcomeKey: '' }]]);
  const sent = [];
  const User = {
    findOne: async ({ telegramId }) => users.get(String(telegramId)) || null,
    updateOne: async (filter, update) => {
      const user = [...users.values()].find(item => item._id === filter._id);
      if (!user) return { modifiedCount: 0 };
      Object.assign(user, update.$set || {});
      return { modifiedCount: 1 };
    }
  };
  const bot = { sendMessage: async (...args) => { sent.push(args); } };
  return { users, sent, bot, User };
}

(async () => {
  const first = fixture();
  const activations = [];
  const result = await handleTelegramStart({
    message: { text: '/start verify_chat', from: { id: 42, first_name: 'Test' }, chat: { id: 42 } },
    bot: first.bot,
    User: first.User,
    appUrl: '',
    generateReferralCode: () => 'CODE42',
    botText: () => 'welcome',
    welcomeImagePath: null,
    activateOfficialBotTask: async telegramId => {
      activations.push(String(telegramId));
      return { status: activations.length === 1 ? 'credited' : 'already_completed', reward: activations.length === 1 ? 5 : 0 };
    },
    logger: { error() {} }
  });
  assert.strictEqual(result.officialBotActivation.status, 'credited');
  assert.deepStrictEqual(activations, ['42']);
  assert.strictEqual(first.sent.length, 1);

  const normal = fixture();
  const normalResult = await handleTelegramStart({
    message: { text: '/start', from: { id: 42 }, chat: { id: 42 } },
    bot: normal.bot,
    User: normal.User,
    appUrl: '',
    generateReferralCode: () => 'CODE42',
    botText: () => 'welcome',
    welcomeImagePath: null
  });
  assert.strictEqual(Object.hasOwn(normalResult, 'officialBotActivation'), false);
  console.log('PASS — official bot task definition, verify_chat activation hook and one-time contract');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
