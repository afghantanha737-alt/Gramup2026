'use strict';

const assert = require('assert');
const fs = require('fs');
const Task = require('../models/Task');
const TaskCompletion = require('../models/TaskCompletion');
const TaskReactionState = require('../models/TaskReactionState');
const LatestPostEngagementState = require('../models/LatestPostEngagementState');
const { buildTelegramWebhookPayload } = require('../utils/bot');
const {
  isValidTelegramChannelId,
  isValidTelegramChannelUrl,
  isSingleEmoji,
  validateLatestPostConfig,
  extractReactionEmojis,
  extractAddedReactionEmojis,
  isReactionSatisfied,
  isFreshRequiredReaction,
  buildRecurringTaskSourceId,
  LATEST_POST_COOLDOWN_HOURS,
  LATEST_POST_OPEN_WAIT_SECONDS,
  isLatestPostCooldownActive,
  isLatestPostOpenValid,
  nextLatestPostAvailableAt
} = require('../utils/latestPostEngagement');

assert.strictEqual(isValidTelegramChannelId('-1001234567890'), true);
assert.strictEqual(isValidTelegramChannelId('221234567890'), true);
assert.strictEqual(isValidTelegramChannelId('-221234567890'), true);
assert.strictEqual(isValidTelegramChannelId(String((1n << 52n) - 1n)), true);
assert.strictEqual(isValidTelegramChannelId(String(1n << 52n)), false);
assert.strictEqual(isValidTelegramChannelId('0'), false);
assert.strictEqual(isValidTelegramChannelId('@mychannel'), false);
assert.strictEqual(isValidTelegramChannelUrl('https://t.me/mychannel'), true);
assert.strictEqual(isValidTelegramChannelUrl('http://t.me/mychannel'), false);
assert.strictEqual(isValidTelegramChannelUrl('https://example.com/channel'), false);
assert.strictEqual(isSingleEmoji('👍'), true);
assert.strictEqual(isSingleEmoji('❤️'), true);
assert.strictEqual(isSingleEmoji('not-an-emoji'), false);
assert.strictEqual(isSingleEmoji('👍🔥'), false);
assert.deepStrictEqual(buildTelegramWebhookPayload('https://example.com/api/telegram/webhook', {
  allowed_updates: ['channel_post', 'message_reaction'],
  secret_token: 'test-secret'
}), {
  url: 'https://example.com/api/telegram/webhook',
  allowed_updates: ['channel_post', 'message_reaction'],
  secret_token: 'test-secret'
});
assert.strictEqual(validateLatestPostConfig({
  chatId: '-1001234567890',
  url: 'https://t.me/mychannel',
  requiredReaction: '👍',
  cooldownHours: 3
}), null);
assert.ok(validateLatestPostConfig({
  chatId: '@mychannel',
  url: 'https://t.me/mychannel',
  requiredReaction: '👍',
  cooldownHours: 3
}));
assert.strictEqual(validateLatestPostConfig({
  chatId: '221234567890',
  url: 'https://t.me/mychannel',
  requiredReaction: '👍',
  cooldownHours: 3
}), null);
assert.ok(validateLatestPostConfig({
  chatId: '-1001234567890',
  url: 'https://t.me/mychannel',
  requiredReaction: '',
  cooldownHours: 3
}));

const update = {
  message_reaction: {
    new_reaction: [
      { type: 'emoji', emoji: '❤️' },
      { type: 'custom_emoji', custom_emoji_id: '123' },
      { type: 'emoji', emoji: '🔥' }
    ]
  }
};
assert.deepStrictEqual(extractReactionEmojis(update), ['❤', '🔥']);
assert.deepStrictEqual(extractAddedReactionEmojis({ message_reaction: {
  old_reaction: [{ type: 'emoji', emoji: '👍' }],
  new_reaction: [{ type: 'emoji', emoji: '👍' }, { type: 'emoji', emoji: '🔥' }]
} }), ['🔥']);
assert.deepStrictEqual(extractAddedReactionEmojis({ message_reaction: {
  old_reaction: [{ type: 'emoji', emoji: '👍' }],
  new_reaction: []
} }), []);
assert.strictEqual(isReactionSatisfied(['❤', '🔥'], '❤️'), true);
assert.strictEqual(isReactionSatisfied([], '👍'), false);
const postDate = new Date('2026-10-02T10:00:00.000Z');
const availableAt = new Date('2026-10-02T13:00:00.000Z');
const reactionState = {
  reactionEmojis: ['👍'],
  lastAddedReactionEmojis: ['👍'],
  lastEventAt: new Date('2026-10-02T13:01:00.000Z')
};
assert.strictEqual(isFreshRequiredReaction({ reactionState, requiredReaction: '👍', latestPostDate: postDate }), true);
assert.strictEqual(isFreshRequiredReaction({ reactionState, requiredReaction: '👍', latestPostDate: postDate, nextAvailableAt: availableAt }), true);
assert.strictEqual(isFreshRequiredReaction({ reactionState: { ...reactionState, lastEventAt: new Date('2026-10-02T12:59:59.000Z') }, requiredReaction: '👍', latestPostDate: postDate, nextAvailableAt: availableAt }), false);
assert.strictEqual(isFreshRequiredReaction({ reactionState, requiredReaction: '👍', latestPostDate: postDate, lastReactionEventAt: reactionState.lastEventAt }), false);
assert.strictEqual(isFreshRequiredReaction({ reactionState: { ...reactionState, lastAddedReactionEmojis: ['🔥'] }, requiredReaction: '👍', latestPostDate: postDate }), false);
assert.strictEqual(buildRecurringTaskSourceId('task1', 'user1', 1), 'task:task1:user:user1:cycle:1');
assert.notStrictEqual(buildRecurringTaskSourceId('task1', 'user1', 1), buildRecurringTaskSourceId('task1', 'user1', 2));
assert.throws(() => buildRecurringTaskSourceId('task1', 'user1', 0), TypeError);
assert.strictEqual(LATEST_POST_COOLDOWN_HOURS, 3);
assert.strictEqual(LATEST_POST_OPEN_WAIT_SECONDS, 10);
const completedAt = new Date('2026-10-03T10:15:00.000Z');
const nextAt = nextLatestPostAvailableAt(completedAt);
assert.strictEqual(nextAt.toISOString(), '2026-10-03T13:15:00.000Z');
assert.strictEqual(isLatestPostCooldownActive(nextAt, completedAt), true);
assert.strictEqual(isLatestPostCooldownActive(nextAt, nextAt), false);
assert.strictEqual(isLatestPostOpenValid({ openedAt: completedAt, lastCompletedAt: null, now: completedAt }), false);
assert.strictEqual(isLatestPostOpenValid({ openedAt: completedAt, lastCompletedAt: null, now: new Date(completedAt.getTime() + 9999) }), false);
assert.strictEqual(isLatestPostOpenValid({ openedAt: completedAt, lastCompletedAt: null, now: new Date(completedAt.getTime() + 10000) }), true);
assert.strictEqual(isLatestPostOpenValid({ openedAt: completedAt, lastCompletedAt: completedAt, now: nextAt }), false);
assert.strictEqual(isLatestPostOpenValid({ openedAt: nextAt, lastCompletedAt: null, now: completedAt }), false);
assert.strictEqual(isLatestPostOpenValid({ openedAt: null, lastCompletedAt: null, now: completedAt }), false);

assert.ok(Task.schema.path('verifyType').enumValues.includes('latest_post'));
assert.strictEqual(Task.schema.path('chatId').instance, 'String');
assert.strictEqual(Task.schema.path('cooldownHours').defaultValue, 3);
assert.ok(Task.schema.path('latestPostMessageId'));
assert.ok(Task.schema.path('requiredReaction'));
assert.ok(TaskCompletion.schema.path('nextAvailableAt'));
assert.ok(TaskCompletion.schema.path('recurringClaimCount'));
assert.ok(TaskCompletion.schema.path('lastReactionEventAt'));
assert.ok(LatestPostEngagementState.schema.path('openedAt'));
const completionIndexes = TaskCompletion.schema.indexes();
assert.ok(completionIndexes.some(([keys, options]) => keys.user === 1 && keys.task === 1 && options.unique !== true));
assert.ok(!completionIndexes.some(([keys, options]) => keys.user === 1 && keys.task === 1 && options.unique === true));
const completionUserId = new (require('mongoose').Types.ObjectId)('6ab7702bb861627b180e66cc');
const completionTaskId = new (require('mongoose').Types.ObjectId)('6aa29c139856dd465546a60b');
assert.strictEqual(
  String(TaskCompletion.idForUserTask(completionUserId, completionTaskId)),
  String(TaskCompletion.idForUserTask(completionUserId, completionTaskId)),
  'the same logical user/task always maps to one database _id'
);
assert.notStrictEqual(
  String(TaskCompletion.idForUserTask(completionUserId, completionTaskId)),
  String(TaskCompletion.idForUserTask(completionTaskId, completionUserId)),
  'different user/task pairs map to different database _ids'
);
assert.throws(() => TaskCompletion.idForUserTask('invalid', completionTaskId), /valid user and task ObjectIds/);
const openStateIndexes = LatestPostEngagementState.schema.indexes();
assert.ok(openStateIndexes.some(([keys, options]) => keys.user === 1 && keys.task === 1 && options.unique === true));
const reactionIndexes = TaskReactionState.schema.indexes();
assert.ok(reactionIndexes.some(([keys, options]) => keys.chatId === 1 && keys.messageId === 1 && keys.telegramUserId === 1 && options.unique === true));
assert.ok(TaskReactionState.schema.path('lastAddedReactionEmojis'));
assert.ok(!reactionIndexes.some(([, options]) => options.expireAfterSeconds !== undefined));

const webhookSource = fs.readFileSync(require.resolve('../routes/telegramWebhook'), 'utf8');
const taskRouteSource = fs.readFileSync(require.resolve('../routes/tasks'), 'utf8');
const telegramWebhookSource = fs.readFileSync(require.resolve('../routes/telegramWebhook'), 'utf8');
const serverSource = fs.readFileSync(require.resolve('../server'), 'utf8');
const appSource = fs.readFileSync(require.resolve('../public/js/app.js'), 'utf8');
const adminSource = fs.readFileSync(require.resolve('../routes/admin'), 'utf8');
const adminHtmlSource = fs.readFileSync(require.resolve('../public/admin.html'), 'utf8');
assert.ok(adminSource.includes("'channel_post', 'message_reaction'"));
assert.ok(webhookSource.includes('handleMessageReaction'));
assert.ok(webhookSource.includes('handleTelegramStart'));
assert.ok(webhookSource.includes('recordWebhookUpdate(updateType)'));
assert.ok(webhookSource.includes('return res.sendStatus(500)'));
assert.ok(serverSource.includes("await require('./models/TaskReactionState').init()"));
assert.ok(serverSource.includes("await require('./models/LatestPostEngagementState').init()"));
assert.ok(taskRouteSource.includes("router.post('/:id/engagement/check'"));
assert.ok(taskRouteSource.includes("router.post('/:id/engagement/open'"));
assert.ok(taskRouteSource.includes('withMongoTransaction'));
assert.ok(taskRouteSource.includes('recordLedgerRequired'));
assert.ok(taskRouteSource.includes('TASK_COOLDOWN_ACTIVE'));
assert.ok(taskRouteSource.includes('latestPostStates'));
const engagementCheckSource = taskRouteSource.slice(
  taskRouteSource.indexOf("router.post('/:id/engagement/check'"),
  taskRouteSource.indexOf("POST /api/tasks/:id/claim")
);
assert.ok(engagementCheckSource.includes('TASK_NOT_OPENED'));
assert.ok(engagementCheckSource.includes('LatestPostEngagementState.findOneAndDelete'));
assert.ok(engagementCheckSource.includes('nextLatestPostAvailableAt(transactionNow)'));
assert.ok(!engagementCheckSource.includes('TaskReactionState'));
assert.ok(!engagementCheckSource.includes('latestPostMessageId'));
assert.ok(!engagementCheckSource.includes('requiredReaction'));
assert.ok(!engagementCheckSource.includes('isFreshRequiredReaction'));
assert.ok(adminSource.includes("router.get('/tasks/:id/latest-post-diagnostics'"));
assert.ok(adminSource.includes("router.get('/telegram-status'"));
assert.ok(adminSource.includes("router.post('/telegram-reconfigure'"));
assert.ok(adminSource.includes("['channel_post', 'message_reaction']"));
assert.ok(adminHtmlSource.includes('diagnoseLatestPostTask'));
assert.ok(adminHtmlSource.includes('diagnoseTelegramBot'));
assert.ok(adminHtmlSource.includes('reconfigureTelegramWebhook'));
assert.ok(adminSource.includes("allowed_updates: ['message', 'callback_query', 'channel_post', 'message_reaction']"));
assert.ok(adminSource.includes('bot.getWebhookInfo()'));
assert.ok(telegramWebhookSource.includes("router.get('/set-webhook', (req, res) =>"), 'legacy webhook bootstrap GET fails with method-not-allowed');
assert.ok(!telegramWebhookSource.includes('req.query.key'), 'webhook admin secrets are never accepted from query strings');
assert.ok(appSource.includes('function openLatestPostTask(url, taskId)'));
assert.ok(appSource.includes('/engagement/open'));
assert.ok(appSource.includes('data-task-state="WAITING_FOR_CHECK"'));
assert.ok(appSource.includes('else if (waitingForCheck)'));
assert.ok(appSource.includes('latestPostStates'));
assert.ok(appSource.includes('class="taskActionSlot"'));
assert.ok(appSource.includes('data-latest-post-cooldown'));
assert.ok(appSource.includes('data-task-open-url="${escapeHTML(safeUrl)}"'), 'task URL is escaped into a data attribute, never an inline JavaScript string');
assert.ok(!appSource.includes("onclick=\"openTaskLinkOnly('${safeUrl}')\""), 'untrusted task URL is not interpolated into onclick');
assert.ok(appSource.includes('window.open(safeUrl, "_blank", "noopener,noreferrer")'), 'external task links cannot control their opener tab');
assert.ok(appSource.includes('task_latest_post_open_hint'));
assert.ok(!appSource.includes('task_latest_post_reaction_hint'));
assert.ok(appSource.includes('document.addEventListener("visibilitychange", refreshLatestPostTasksOnReturn)'));
assert.ok(!appSource.includes('else if (!Number.isSafeInteger(Number(task.latestPostMessageId))'));

console.log('ALL PASS — Latest Post Engagement validation, indexes, webhook, transaction and UI state contracts');
