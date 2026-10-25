'use strict';

const assert = require('assert');
const express = require('express');

// Test-only configuration; no real Telegram token or API request is used.
process.env.BOT_TOKEN = 'test-bot-token-not-real';
process.env.APP_URL = 'https://gramup.example/app';
process.env.TELEGRAM_WEBHOOK_SECRET = 'test_secret-123';

const { bot } = require('../utils/bot');
const User = require('../models/User');
const referralSystem = require('../utils/referralSystem');
const webhookDedup = require('../utils/webhookDedup');
const claimedUpdates = new Map();
let claimSequence = 0;
webhookDedup.claimWebhookUpdate = async updateId => {
  const previous = claimedUpdates.get(Number(updateId));
  if (previous?.status === 'completed' || previous?.status === 'processing') return { claimed: false, duplicate: true };
  const processingToken = `claim-${++claimSequence}`;
  claimedUpdates.set(Number(updateId), { status: 'processing', processingToken });
  return { claimed: true, processingToken };
};
webhookDedup.finishWebhookUpdate = async (updateId, status, _failureCode, processingToken) => {
  const current = claimedUpdates.get(Number(updateId));
  if (current?.processingToken === processingToken) current.status = status;
};

const users = new Map();
const sentMessages = [];
const linkedReferrals = [];
User.findOne = async ({ telegramId }) => users.get(String(telegramId)) || null;
User.create = async values => {
  const user = { _id: `user-${values.telegramId}`, language: 'fa', ...values };
  users.set(String(user.telegramId), user);
  return user;
};
User.updateOne = async (filter, update) => {
  const user = [...users.values()].find(candidate => String(candidate._id) === String(filter._id));
  if (user) Object.assign(user, update.$set || {});
  return { acknowledged: true, modifiedCount: user ? 1 : 0 };
};
referralSystem.linkReferralByCode = async args => {
  linkedReferrals.push(args);
  return { linked: true };
};
bot.sendMessage = async (chatId, text, options) => {
  sentMessages.push({ chatId, text, options });
  return { message_id: sentMessages.length };
};
bot.sendPhoto = async (chatId, _photo, options = {}) => {
  sentMessages.push({ chatId, text: options.caption || '', options, photo: true });
  return { message_id: sentMessages.length };
};

const telegramRouter = require('../routes/telegramWebhook');
const app = express();
app.use(express.json());
app.use('/api/telegram', telegramRouter);

(async () => {
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const { port } = server.address();
  const endpoint = `http://127.0.0.1:${port}/api/telegram/webhook`;
  const postUpdate = (update, secret = process.env.TELEGRAM_WEBHOOK_SECRET) => fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(secret ? { 'x-telegram-bot-api-secret-token': secret } : {})
    },
    body: JSON.stringify(update)
  });

  try {
    const unsafeBootstrap = await fetch(`${endpoint.replace('/webhook', '/set-webhook')}?key=${encodeURIComponent('test-bot-token-not-real')}`);
    assert.strictEqual(unsafeBootstrap.status, 405, 'state-changing webhook bootstrap is not exposed as GET with a query secret');
    const first = await postUpdate({
      update_id: 1001,
      message: { message_id: 1, chat: { id: 111 }, from: { id: 111, first_name: 'New' }, text: '/start invite_CODE' }
    });
    assert.strictEqual(first.status, 200, 'successful /start update must receive HTTP 200');
    assert.strictEqual(users.has('111'), true, 'new Telegram user must be created');
    assert.strictEqual(sentMessages.length, 1, 'bot must send the Welcome message');
    assert.strictEqual(sentMessages[0].photo, true, 'welcome must be sent as a photo when the asset is available');
    assert.ok(sentMessages[0].text.includes('سلام New'), 'the bot sends the existing localized Welcome');
    assert.ok(sentMessages[0].text.includes('به Gramup خوش آمدی'));
    const firstUrl = sentMessages[0].options.reply_markup.inline_keyboard[0][0].web_app.url;
    assert.strictEqual(new URL(firstUrl).searchParams.get('ref'), 'invite_CODE');
    assert.strictEqual(linkedReferrals.length, 0, 'new-user referral reward waits for contact verification and authenticated app entry');
    assert.strictEqual(users.get('111').pendingReferralIdentifier, 'invite_CODE');

    const contact = await postUpdate({
      update_id: 1008,
      message: { message_id: 8, chat: { id: 111 }, from: { id: 111, first_name: 'New' }, contact: { user_id: 111, phone_number: '+93 700 123 456' } }
    });
    assert.strictEqual(contact.status, 200, 'self-contact update must be acknowledged');
    assert.strictEqual(users.get('111').phoneCountryCode, '+93');
    assert.ok(users.get('111').phoneVerifiedAt instanceof Date);
    assert.ok(sentMessages[1].text.includes('تأیید شد'));

    const returning = await postUpdate({
      update_id: 1002,
      message: { message_id: 2, chat: { id: 111 }, from: { id: 111, first_name: 'New' }, text: '/start another_CODE' }
    });
    assert.strictEqual(returning.status, 200);
    assert.strictEqual(sentMessages.length, 3, 'registered user must also receive Welcome on /start');
    assert.strictEqual(linkedReferrals.length, 0, 'repeated /start must not attach or reward a second referral');
    const returningUrl = sentMessages[2].options.reply_markup.inline_keyboard[0][0].web_app.url;
    assert.strictEqual(new URL(returningUrl).searchParams.has('ref'), false, 'existing users must not receive a replacement referral payload');

    const denied = await postUpdate({
      update_id: 1003,
      message: { message_id: 3, chat: { id: 222 }, from: { id: 222 }, text: '/start' }
    }, 'wrong-secret');
    assert.strictEqual(denied.status, 401, 'invalid Telegram webhook secret must be rejected');
    assert.strictEqual(sentMessages.length, 3, 'unauthenticated webhook request must not send a message');

    let shouldFailFirstAttempt = true;
    bot.sendPhoto = async (chatId, _photo, options = {}) => {
      if (shouldFailFirstAttempt) { shouldFailFirstAttempt = false; throw new Error('simulated send failure'); }
      sentMessages.push({ chatId, text: options.caption || '', options, photo: true });
      return { message_id: sentMessages.length };
    };
    const failed = await postUpdate({
      update_id: 1004,
      message: { message_id: 4, chat: { id: 333 }, from: { id: 333 }, text: '/start' }
    });
    assert.strictEqual(failed.status, 500, 'Telegram should retry /start if the Welcome could not be sent');

    const duplicateFailureRetry = await postUpdate({
      update_id: 1004,
      message: { message_id: 4, chat: { id: 333 }, from: { id: 333 }, text: '/start' }
    });
    assert.strictEqual(duplicateFailureRetry.status, 200, 'failed update retry should be processed and acknowledged');
    assert.strictEqual(sentMessages.length, 4, 'failed update is retried and its welcome is sent');
    const completedDuplicate = await postUpdate({ update_id: 1004, message: { message_id: 4, chat: { id: 333 }, from: { id: 333 }, text: '/start' } });
    assert.strictEqual(completedDuplicate.status, 200, 'completed update duplicates are acknowledged');
    assert.strictEqual(sentMessages.length, 4, 'completed update duplicates do not repeat side effects');

    const invalidSecret = await postUpdate({
      update_id: 1006,
      message: { message_id: 6, chat: { id: 555 }, from: { id: 555 }, text: '/start' }
    }, 'wrong-secret');
    assert.strictEqual(invalidSecret.status, 401, 'configured webhook with an invalid secret is rejected');
    assert.strictEqual(sentMessages.length, 4, 'invalid webhook secret cannot trigger side effects');

    const beforeMissingSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    process.env.TELEGRAM_WEBHOOK_SECRET = '';
    let missingSecretServer;
    try {
      delete require.cache[require.resolve('../routes/telegramWebhook')];
      const noSecretApp = express();
      noSecretApp.use(express.json());
      noSecretApp.use('/api/telegram', require('../routes/telegramWebhook'));
      missingSecretServer = await new Promise(resolve => {
        const instance = noSecretApp.listen(0, '127.0.0.1', () => resolve(instance));
      });
      const noConfiguredSecret = await fetch(`http://127.0.0.1:${missingSecretServer.address().port}/api/telegram/webhook`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        update_id: 1007,
        message: { message_id: 5, chat: { id: 444 }, from: { id: 444 }, text: '/start' }
        })
      });
      assert.strictEqual(noConfiguredSecret.status, 503, 'missing production webhook secret fails closed');
    } finally {
      if (missingSecretServer) await new Promise(resolve => missingSecretServer.close(resolve));
      process.env.TELEGRAM_WEBHOOK_SECRET = beforeMissingSecret;
      delete require.cache[require.resolve('../routes/telegramWebhook')];
    }

    console.log('ALL PASS — webhook secret validation, /start side effects, durable-claim contract and duplicate delivery handling');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
