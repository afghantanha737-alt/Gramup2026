'use strict';
const assert = require('assert');
const fs = require('fs');
const {
  BIO_LINK_TASK_KIND,
  BIO_LINK_REWARD,
  BIO_LINK_COOLDOWN_MS,
  normalizeTelegramUsername,
  extractTelegramUsernames,
  bioContainsAllowedLink,
  nextBioClaimAt,
  bioLinkTaskDefinition
} = require('../utils/bioLinkTask');

assert.strictEqual(normalizeTelegramUsername('https://t.me/GramUpBot?start=abc'), 'gramupbot');
assert.strictEqual(normalizeTelegramUsername('@GramUpNews'), 'gramupnews');
assert.strictEqual(normalizeTelegramUsername('https://t.me/+privateInvite'), '');
const bio = 'GramUp: https://t.me/GramUpBot and @GramUpNews';
assert.deepStrictEqual([...extractTelegramUsernames(bio)].sort(), ['gramupbot', 'gramupnews']);
assert.strictEqual(bioContainsAllowedLink(bio, ['GramUpBot', '@GramUpNews']), true);
assert.strictEqual(bioContainsAllowedLink('https://t.me/NotGramUpBot', ['GramUpBot']), false);
assert.strictEqual(bioContainsAllowedLink('Join via https://t.me/+privateInvite', ['GramUpBot']), false);
assert.strictEqual(BIO_LINK_TASK_KIND, 'bio_link');
assert.strictEqual(BIO_LINK_REWARD, 5);
assert.strictEqual(BIO_LINK_COOLDOWN_MS, 24 * 60 * 60 * 1000);
const now = new Date('2026-10-21T12:00:00Z');
assert.strictEqual(nextBioClaimAt(now).getTime() - now.getTime(), BIO_LINK_COOLDOWN_MS);
const definition = bioLinkTaskDefinition();
assert.strictEqual(definition.taskKind, 'bio_link');
assert.strictEqual(definition.reward, 5);
assert.strictEqual(definition.verifyType, 'telegram');
const route = fs.readFileSync('routes/tasks.js', 'utf8');
assert(route.includes('bot.getChat(req.dbUser.telegramId)'), 'verifies the authenticated Telegram account through Bot API getChat');
assert(route.includes('bioContainsAllowedLink(profile.bio'), 'checks the official target in the returned bio');
assert(route.includes('BIO_LINK_TASK_KIND'), 'only the system bio task uses profile lookup');
assert(route.includes('withMongoTransaction'), 'reward and ledger are committed atomically');
assert(route.includes('completion?.nextAvailableAt'), 'server enforces the recurring cooldown');
assert(route.includes('BIO_LINK_REWARD'), 'the payout amount is fixed by server policy');
console.log('PASS — Telegram bio task link matching and 24-hour reward policy');
