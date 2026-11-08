'use strict';

const assert = require('node:assert/strict');
process.env.BOT_TOKEN = 'membership-test-token';
const { bot, checkChatMembership } = require('../utils/bot');
const fs = require('node:fs');
const path = require('node:path');
const tasksRoute = fs.readFileSync(path.join(__dirname, '..', 'routes/tasks.js'), 'utf8');

(async () => {
  const originalGetChatMember = bot.getChatMember;
  try {
    bot.getChatMember = async () => ({ status: 'left' });
    assert.deepEqual(await checkChatMembership('@testchannel', 12345), { joined: false });

    bot.getChatMember = async () => { throw new Error('Telegram API unavailable'); };
    const outage = await checkChatMembership('@testchannel', 12345);
    assert.equal(outage.joined, false);
    assert.equal(typeof outage.transientError, 'string');
    assert.equal(outage.configError, undefined);

    bot.getChatMember = async () => { throw new Error('Bad Request: chat not found'); };
    const misconfigured = await checkChatMembership('@testchannel', 12345);
    assert.equal(typeof misconfigured.configError, 'string');
    assert.equal(misconfigured.transientError, undefined);

    assert.match(tasksRoute, /result\.transientError[\s\S]*?status\(503\)[\s\S]*?MEMBERSHIP_VERIFY_UNAVAILABLE/);
    assert.match(tasksRoute, /taskCapacityFilter\(currentTask\._id, now\)/);
    assert.match(tasksRoute, /taskCapacityFilter\(currentTask\._id, now\), taskKind: BIO_LINK_TASK_KIND/);
    console.log('PASS — transient Telegram errors are retryable and bio-link claims use transactional capacity checks');
  } finally {
    bot.getChatMember = originalGetChatMember;
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
