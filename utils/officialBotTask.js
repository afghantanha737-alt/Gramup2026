'use strict';

const Task = require('../models/Task');
const TaskCompletion = require('../models/TaskCompletion');
const User = require('../models/User');
const { recordLedgerRequired } = require('./ledger');
const { withMongoTransaction } = require('./mongoTransaction');

const OFFICIAL_BOT_TASK_KIND = 'official_bot';
const OFFICIAL_BOT_TASK_REWARD = 5;
const VERIFY_CHAT_PAYLOAD = 'verify_chat';

function normalizeBotUsername(value) {
  return String(value || '').trim().replace(/^@/, '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 32);
}

function officialBotTaskDefinition({ botUsername = process.env.BOT_USERNAME } = {}) {
  const username = normalizeBotUsername(botUsername);
  return {
    title: 'Start Official Bot',
    description: 'Start the official Gramup bot to activate Telegram notifications and receive 5 UP.',
    type: 'link',
    verifyType: 'telegram',
    chatId: '',
    url: username ? `https://t.me/${username}?start=${VERIFY_CHAT_PAYLOAD}` : '',
    reward: OFFICIAL_BOT_TASK_REWARD,
    taskKind: OFFICIAL_BOT_TASK_KIND,
    maxCompletions: null,
    isActive: true,
    isSpecialOfDay: true,
    isSponsored: false,
    expiresAt: null
  };
}

async function ensureOfficialBotTask() {
  const definition = officialBotTaskDefinition();
  return Task.findOneAndUpdate(
    { taskKind: OFFICIAL_BOT_TASK_KIND },
    { $setOnInsert: definition },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

/**
 * Clears Telegram delivery blocking and pays the one-time activation reward.
 * User, completion, balance and journal are committed atomically.
 */
async function activateOfficialBotTask(telegramId) {
  const normalizedTelegramId = String(telegramId || '').trim();
  if (!normalizedTelegramId) return { status: 'missing_telegram_id' };

  return withMongoTransaction(async session => {
    const user = await User.findOne({ telegramId: normalizedTelegramId }).session(session);
    if (!user) return { status: 'user_not_registered' };

    const task = await Task.findOne({ taskKind: OFFICIAL_BOT_TASK_KIND, isActive: true }).session(session);
    if (!task || Number(task.reward) !== OFFICIAL_BOT_TASK_REWARD) {
      const error = new Error('Official bot activation task is not configured correctly.');
      error.code = 'OFFICIAL_BOT_TASK_NOT_CONFIGURED';
      throw error;
    }

    const completionId = TaskCompletion.idForUserTask(user._id, task._id);
    const existing = await TaskCompletion.findById(completionId).session(session);
    const unblocked = await User.findOneAndUpdate(
      { _id: user._id },
      { $set: { telegramBlockedAt: null } },
      { new: true, session }
    );
    if (!unblocked) return { status: 'user_not_registered' };

    if (existing?.status === 'approved') {
      return { status: 'already_completed', reward: 0, points: unblocked.points };
    }

    const now = new Date();
    if (existing) {
      existing.status = 'approved';
      existing.reward = OFFICIAL_BOT_TASK_REWARD;
      existing.reviewedAt = now;
      existing.reviewedBy = 'telegram-verify-chat';
      await existing.save({ session });
    } else {
      await new TaskCompletion({
        _id: completionId,
        user: user._id,
        task: task._id,
        reward: OFFICIAL_BOT_TASK_REWARD,
        status: 'approved',
        reviewedAt: now,
        reviewedBy: 'telegram-verify-chat'
      }).save({ session });
    }

    const rewarded = await User.findByIdAndUpdate(
      user._id,
      { $inc: { points: OFFICIAL_BOT_TASK_REWARD } },
      { new: true, session }
    );
    if (!rewarded) throw new Error('User disappeared while activating official bot task.');

    const ledger = await recordLedgerRequired({
      user: rewarded._id,
      type: 'task',
      amount: OFFICIAL_BOT_TASK_REWARD,
      description: 'Start Official Bot',
      balanceAfter: rewarded.points,
      sourceId: `task:${task._id}:user:${rewarded._id}`,
      session
    });
    if (!ledger.created) {
      const error = new Error('Official bot activation reward was already recorded.');
      error.code = 'OFFICIAL_BOT_REWARD_ALREADY_PAID';
      throw error;
    }

    return { status: 'credited', reward: OFFICIAL_BOT_TASK_REWARD, points: rewarded.points };
  });
}

module.exports = {
  OFFICIAL_BOT_TASK_KIND,
  OFFICIAL_BOT_TASK_REWARD,
  VERIFY_CHAT_PAYLOAD,
  officialBotTaskDefinition,
  ensureOfficialBotTask,
  activateOfficialBotTask
};
