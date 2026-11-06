'use strict';

const assert = require('assert');
const { parseTelegramStart, buildMiniAppUrl, buildWelcomeReplyMarkup, handleTelegramStart } = require('../utils/telegramStart');
const {
  recordWebhookUpdate,
  recordStartWelcomeSent,
  recordStartHandlerFailure,
  recordWebhookSecretRejection,
  getTelegramWebhookMetrics
} = require('../utils/telegramWebhookMetrics');

assert.deepStrictEqual(parseTelegramStart('/start'), { payload: null });
assert.deepStrictEqual(parseTelegramStart('/start referral_123'), { payload: 'referral_123' });
assert.deepStrictEqual(parseTelegramStart('/start@Gram_up_bot referral_123'), { payload: 'referral_123' });
assert.strictEqual(parseTelegramStart('/start invalid payload extra'), null);
assert.strictEqual(parseTelegramStart('/help'), null);
assert.strictEqual(buildMiniAppUrl('https://gramup.example/app?lang=en', 'ref_123', true), 'https://gramup.example/app?lang=en&ref=ref_123');
assert.strictEqual(buildMiniAppUrl('https://gramup.example/app', 'ref_123', false), 'https://gramup.example/app');
assert.strictEqual(buildMiniAppUrl('', 'ref_123', true), '');
const welcomeMarkup = buildWelcomeReplyMarkup('https://gramup.example/app');
assert.strictEqual(welcomeMarkup.inline_keyboard[0][0].text, 'Open Mini App');
assert.strictEqual(welcomeMarkup.inline_keyboard[0][0].web_app.url, 'https://gramup.example/app');
assert.deepStrictEqual(welcomeMarkup.inline_keyboard[1].map(button => button.text), ['Community', 'Payouts']);
assert.strictEqual(welcomeMarkup.inline_keyboard[1][0].url, 'https://t.me/GramupOfficialChannel');
assert.strictEqual(welcomeMarkup.inline_keyboard[1][1].url, 'https://t.me/GramUpPayouts');

function fixture(existingUser = null) {
  const users = new Map();
  if (existingUser) users.set(String(existingUser.telegramId), existingUser);
  const sent = [];
  const linked = [];
  const User = {
    findOne: async ({ telegramId }) => users.get(String(telegramId)) || null,
    create: async values => {
      const user = { _id: 'new-user-id', language: 'fa', ...values };
      users.set(String(user.telegramId), user);
      return user;
    },
    updateOne: async (filter, update) => {
      const user = [...users.values()].find(candidate => String(candidate._id) === String(filter._id));
      if (!user) return { modifiedCount: 0 };
      const expected = filter.lastAutoWelcomeKey?.$ne;
      if (expected !== undefined && user.lastAutoWelcomeKey === expected) return { modifiedCount: 0 };
      Object.assign(user, update.$set || {});
      return { modifiedCount: 1 };
    }
  };
  const bot = { sendMessage: async (...args) => { sent.push(args); return { message_id: 1 }; } };
  const linkReferralByCode = async value => { linked.push(value); return { linked: true }; };
  const dependencies = {
    bot,
    User,
    appUrl: 'https://gramup.example/app?lang=fa',
    generateReferralCode: id => `CODE${id}`,
    linkReferralByCode,
    botText: (key, language, name) => `${key}:${language}:${name}`,
    welcomeImagePath: null,
    logger: { error: () => {} }
  };
  return { users, sent, linked, User, dependencies };
}

(async () => {
  const fresh = fixture();
  const freshResult = await handleTelegramStart({
    ...fresh.dependencies,
    message: { text: '/start inviter_42', from: { id: 123, first_name: 'Ava' }, chat: { id: 123 } }
  });
  assert.deepStrictEqual(freshResult, { isNewUser: true, hadReferralPayload: true, welcomeSent: true, hasMiniAppButton: true });
  assert.strictEqual(fresh.users.size, 1);
  assert.strictEqual(fresh.linked.length, 0, 'referral reward linking waits until phone verification');
  assert.strictEqual(fresh.users.get('123').pendingReferralIdentifier, 'inviter_42');
  assert.strictEqual(fresh.sent.length, 1);
  assert.strictEqual(fresh.sent[0][1], 'welcome:fa:Ava');
  const freshButton = fresh.sent[0][2].reply_markup.inline_keyboard[0][0];
  assert.strictEqual(freshButton.text, 'Open Mini App');
  assert.strictEqual(new URL(freshButton.web_app.url).searchParams.get('ref'), 'inviter_42');
  assert.deepStrictEqual(fresh.sent[0][2].reply_markup.inline_keyboard[1].map(button => button.text), ['Community', 'Payouts']);
  const duplicateStart = await handleTelegramStart({
    ...fresh.dependencies,
    message: { text: '/start inviter_42', from: { id: 123, first_name: 'Ava' }, chat: { id: 123 } }
  });
  assert.strictEqual(duplicateStart.welcomeSent, false, 'duplicate delivery is not reported as a newly sent welcome');
  assert.strictEqual(fresh.sent.length, 1, 'the same start payload must not send a duplicate welcome');

  const contactRequest = fixture();
  const contactResult = await handleTelegramStart({
    ...contactRequest.dependencies,
    message: { text: '/start phone_contact', from: { id: 124 }, chat: { id: 124 } }
  });
  assert.deepStrictEqual(contactResult, { isNewUser: true, hadReferralPayload: false, welcomeSent: true, hasMiniAppButton: false, phoneContactRequested: true });
  assert.strictEqual(contactRequest.sent[0][1], 'phoneContactRequest:fa:undefined');
  assert.strictEqual(contactRequest.sent[0][2].reply_markup.keyboard[0][0].request_contact, true);

  const existingUser = { _id: 'existing-id', telegramId: '456', language: 'en', referredBy: 'original-referrer' };
  const returning = fixture(existingUser);
  const returningResult = await handleTelegramStart({
    ...returning.dependencies,
    message: { text: '/start different_referrer', from: { id: 456, first_name: 'Sam' }, chat: { id: 456 } }
  });
  assert.deepStrictEqual(returningResult, { isNewUser: false, hadReferralPayload: true, welcomeSent: true, hasMiniAppButton: true });
  assert.strictEqual(returning.sent.length, 1, 'registered users receive a response to /start');
  assert.strictEqual(returning.sent[0][1], 'welcome:en:Sam');
  assert.strictEqual(returning.linked.length, 0, 'an existing referral relationship is never changed or rewarded again');
  assert.strictEqual(returning.users.get('456').referredBy, 'original-referrer');
  assert.strictEqual(new URL(returning.sent[0][2].reply_markup.inline_keyboard[0][0].web_app.url).searchParams.has('ref'), false);

  const noAppUrl = fixture();
  const noButtonResult = await handleTelegramStart({
    ...noAppUrl.dependencies,
    appUrl: '',
    message: { text: '/start', from: { id: 789 }, chat: { id: 789 } }
  });
  assert.strictEqual(noButtonResult.welcomeSent, true, 'missing APP_URL must not suppress the Welcome message');
  assert.deepStrictEqual(noAppUrl.sent[0][2], {});

  const failedSend = fixture();
  failedSend.dependencies.bot.sendMessage = async () => { throw new Error('Telegram sendMessage failed'); };
  const failedResult = await handleTelegramStart({
      ...failedSend.dependencies,
      message: { text: '/start', from: { id: 321 }, chat: { id: 321 } }
    });
  assert.strictEqual(failedResult.welcomeSent, false);
  assert.strictEqual(failedSend.users.has('321'), true, 'notification failure must not abort user registration');

  recordWebhookUpdate('start');
  recordStartWelcomeSent();
  recordStartHandlerFailure();
  recordWebhookSecretRejection();
  const metrics = getTelegramWebhookMetrics();
  assert.strictEqual(metrics.startUpdatesReceived, 1);
  assert.strictEqual(metrics.startWelcomeSent, 1);
  assert.strictEqual(metrics.startHandlerFailures, 1);
  assert.strictEqual(metrics.webhookSecretRejections, 1);
  assert.strictEqual(metrics.updatesReceived, 1);

  console.log('ALL PASS — Telegram /start welcome, deferred referral linking, contact request and webhook diagnostics');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
