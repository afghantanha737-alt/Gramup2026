'use strict';
const express = require('express');
const multer = require('multer');
const mongoose = require('mongoose');
const router = express.Router();
require('../utils/asyncHandler').wrapRouter(router);
const { requireUnifiedAuth } = require('../utils/unifiedAuth');
const { bot, checkChatMembership } = require('../utils/bot');
const { recordLedgerRequired } = require('../utils/ledger');
const Task = require('../models/Task');
const TaskCompletion = require('../models/TaskCompletion');
const LatestPostEngagementState = require('../models/LatestPostEngagementState');
const User = require('../models/User');
const Settings = require('../models/Settings');
const RequiredChannel = require('../models/RequiredChannel');
const { rewardCostUsd } = require('../utils/sponsor');
const { withMongoTransaction } = require('../utils/mongoTransaction');
const { BIO_LINK_TASK_KIND, BIO_LINK_REWARD, BIO_LINK_COOLDOWN_MS, bioContainsAllowedLink, normalizeTelegramUsername, nextBioClaimAt } = require('../utils/bioLinkTask');
const { taskCapacityFilter } = require('../utils/taskCapacity');
const { evaluateReferralEligibility, REFERRAL_MIN_TASKS, REFERRAL_MIN_ACTIVE_DAYS, REFERRAL_WAIT_DAYS } = require('../utils/referralEligibility');
const { SCREENSHOT_MIME_TYPES, isValidScreenshot } = require('../utils/screenshotValidation');
const {
  buildRecurringTaskSourceId,
  LATEST_POST_COOLDOWN_HOURS,
  isLatestPostCooldownActive,
  isLatestPostOpenValid,
  nextLatestPostAvailableAt
} = require('../utils/latestPostEngagement');

// احراز هویت تلگرام + بررسی عضویت فعلی در کانال‌های اجباری (روی هر درخواست محافظت‌شده)
const { withMembership } = require('../utils/membership');
const auth = withMembership(requireUnifiedAuth(process.env.BOT_TOKEN));
const screenshotUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 },
  fileFilter(req, file, callback) {
    if (!SCREENSHOT_MIME_TYPES.includes(file.mimetype)) {
      return callback(new Error('فقط تصویر JPEG، PNG یا WebP قابل ارسال است.'));
    }
    callback(null, true);
  }
});

function parseScreenshot(req, res, next) {
  screenshotUpload.single('screenshot')(req, res, error => {
    if (error) {
      const tooLarge = error.code === 'LIMIT_FILE_SIZE';
      return res.status(400).json({
        success: false,
        message: tooLarge ? 'حجم تصویر باید حداکثر ۵ مگابایت باشد.' : (error.message || 'تصویر ارسالی نامعتبر است.'),
        code: tooLarge ? 'SCREENSHOT_TOO_LARGE' : 'INVALID_SCREENSHOT'
      });
    }
    next();
  });
}

/**
 * Eligibility قدیمی برای تبدیل/برداشت و شمارنده‌ی دعوت فعال را به‌روز می‌کند؛
 * پاداش ثابت ۵۰ پوینتی در سیستم جدید غیرفعال شده و پرداخت اولیه هنگام اتصال Referral است.
 */
async function maybeAwardReferralBonus(userId) {
  const result = await withMongoTransaction(async session => {
    const user = await User.findById(userId)
      .select('referredBy referralBonusAwarded firstName username referralRiskScore referralRiskBlocked createdAt referralEligibilityStatus')
      .session(session);
    if (!user || !user.referredBy) return null;

    const completions = await TaskCompletion.find({ user: userId, status: 'approved' }).select('createdAt status').session(session).lean();
    const eligibility = evaluateReferralEligibility(user, completions);
    await User.updateOne(
      { _id: userId },
      {
        $set: {
          referralEligibilityStatus: eligibility.status,
          referralEligibilityReasons: eligibility.reasons,
          referralEligibleAt: eligibility.eligible ? eligibility.eligibleAt : null
        }
      },
      { session }
    );

    if (eligibility.eligible) {
      await User.findOneAndUpdate(
        { _id: user.referredBy, activeReferralIds: { $ne: user._id } },
        { $addToSet: { activeReferralIds: user._id }, $inc: { activeInvitedCount: 1 } },
        { session }
      );
    } else {
      await User.findOneAndUpdate(
        { _id: user.referredBy, activeReferralIds: user._id, activeInvitedCount: { $gt: 0 } },
        { $pull: { activeReferralIds: user._id }, $inc: { activeInvitedCount: -1 } },
        { session }
      );
    }

    return null;
  });
}

// GET /api/tasks
router.get('/', auth, async (req, res) => {
  try {
    const completions = await TaskCompletion.find({ user: req.dbUser._id });
    const pendingScreenshotTaskIds = completions
      .filter(item => item.status === 'pending' && ['image/jpeg', 'image/png', 'image/webp'].includes(item.proofMimeType))
      .map(item => item.task);
    // قیمت/بودجه‌ی تبلیغ‌دهنده هرگز به کاربر داده نمی‌شود. تسک‌های عادیِ منقضی/غیرفعال پنهان‌اند؛
    // فقط تسکی که همین کاربر برایش screenshot pending دارد نمایش داده می‌شود تا وضعیت بررسی را ببیند.
    const tasks = await Task.find({
      $or: [
        { isActive: true, $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] },
        ...(pendingScreenshotTaskIds.length ? [{ _id: { $in: pendingScreenshotTaskIds } }] : [])
      ]
    })
      .select('-sponsorPriceUsd -sponsorBudgetUsd')
      .sort({ isSpecialOfDay: -1, isSponsored: -1, createdAt: -1 });
    const latestPostTaskIds = tasks.filter(task => task.verifyType === 'latest_post').map(task => task._id);
    const latestPostStates = latestPostTaskIds.length
      ? await LatestPostEngagementState.find({ user: req.dbUser._id, task: { $in: latestPostTaskIds } })
        .select('task openedAt').lean()
      : [];
    res.json({
      success: true,
      tasks,
      completions,
      latestPostStates: latestPostStates.map(item => ({ task: String(item.task), openedAt: item.openedAt })),
      serverNow: Date.now()
    });
  } catch (error) {
    console.error('GET /api/tasks failed:', error);
    res.status(500).json({ success: false, message: 'خطایی در بارگذاری تسک‌ها رخ داد.', code: 'SERVER_ERROR' });
  }
});

/** POST /api/tasks/:id/submission — screenshot proof for generic manual-verification tasks. */
router.post('/:id/submission', auth, parseScreenshot, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ success: false, message: 'تسک پیدا نشد.', code: 'TASK_NOT_FOUND' });
    }
    if (!req.file || !isValidScreenshot(req.file.buffer, req.file.mimetype)) {
      return res.status(400).json({ success: false, message: 'فایل انتخاب‌شده تصویر معتبر نیست.', code: 'INVALID_SCREENSHOT' });
    }

    const task = await Task.findById(req.params.id);
    if (!task || task.verifyType !== 'manual') {
      return res.status(404).json({ success: false, message: 'تسک Screenshot Verification پیدا نشد.', code: 'TASK_NOT_FOUND' });
    }
    if (!task.isActive || (task.expiresAt && task.expiresAt <= new Date())) {
      return res.status(409).json({ success: false, message: 'این تسک دیگر فعال نیست.', code: 'TASK_INACTIVE' });
    }
    if (task.maxCompletions != null && task.completedCount >= task.maxCompletions) {
      return res.status(409).json({ success: false, message: 'ظرفیت این تسک تکمیل شده است.', code: 'TASK_FULL' });
    }

    const now = new Date();
    const existing = await TaskCompletion.findOne({ user: req.dbUser._id, task: task._id });
    if (existing && existing.status !== 'rejected') {
      return res.status(409).json({
        success: false,
        message: existing.status === 'pending' ? 'اسکرین‌شات شما در انتظار بررسی است.' : 'این تسک قبلاً تکمیل شده است.',
        code: existing.status === 'pending' ? 'SUBMISSION_PENDING' : 'ALREADY_DONE'
      });
    }

    try {
      if (existing) {
        const resubmission = await TaskCompletion.findOneAndUpdate(
          { _id: existing._id, status: 'rejected' },
          {
            $set: {
              status: 'pending',
              reward: task.reward,
              proofImage: req.file.buffer,
              proofMimeType: req.file.mimetype,
              submittedAt: now,
              reviewedAt: null,
              reviewedBy: '',
              adminNote: ''
            }
          },
          { new: true, runValidators: true }
        );
        if (!resubmission) {
          return res.status(409).json({ success: false, message: 'درخواست قبلی هم‌زمان تغییر کرده است؛ صفحه را تازه کنید.', code: 'SUBMISSION_CONFLICT' });
        }
      } else {
        await new TaskCompletion({
          _id: TaskCompletion.idForUserTask(req.dbUser._id, task._id),
          user: req.dbUser._id,
          task: task._id,
          reward: task.reward,
          status: 'pending',
          proofImage: req.file.buffer,
          proofMimeType: req.file.mimetype,
          submittedAt: now
        }).save();
      }
    } catch (error) {
      if (error?.code === 11000) {
        return res.status(409).json({ success: false, message: 'برای این تسک قبلاً submission ثبت شده است.', code: 'SUBMISSION_DUPLICATE' });
      }
      throw error;
    }

    return res.status(201).json({
      success: true,
      status: 'pending',
      message: 'اسکرین‌شات ارسال شد و در انتظار بررسی ادمین است.'
    });
  } catch (error) {
    console.error(`POST /api/tasks/${req.params.id}/submission failed:`, error);
    return res.status(500).json({ success: false, message: 'ارسال اسکرین‌شات انجام نشد.', code: 'SERVER_ERROR' });
  }
});

/** POST /api/tasks/:id/engagement/open — server-side Open→Check authorization. */
router.post('/:id/engagement/open', auth, async (req, res) => {
  const user = req.dbUser;
  const now = new Date();
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ success: false, code: 'TASK_NOT_FOUND', message: 'Task پیدا نشد.' });
    }
    const task = await Task.findById(req.params.id);
    if (!task || task.verifyType !== 'latest_post') {
      return res.status(404).json({ success: false, code: 'TASK_NOT_FOUND', message: 'Latest Post Task پیدا نشد.' });
    }
    if (!task.isActive || (task.expiresAt && task.expiresAt <= now)) {
      return res.status(409).json({ success: false, code: 'TASK_INACTIVE', message: 'این Task فعال نیست.' });
    }
    if (task.isSponsored || !task.url || !Number.isFinite(task.reward) || task.reward <= 0) {
      return res.status(503).json({ success: false, code: 'TASK_SETUP_INCOMPLETE', message: 'تنظیمات این Task کامل نیست.' });
    }

    const completion = await TaskCompletion.findOne({ user: user._id, task: task._id })
      .select('nextAvailableAt').lean();
    if (isLatestPostCooldownActive(completion?.nextAvailableAt, now)) {
      return res.status(429).json({
        success: false,
        code: 'TASK_COOLDOWN_ACTIVE',
        message: 'این Task هنوز در Cooldown است.',
        nextAvailableAt: completion.nextAvailableAt,
        serverNow: now.getTime()
      });
    }

    let openState;
    try {
      openState = await LatestPostEngagementState.findOneAndUpdate(
        { user: user._id, task: task._id },
        { $set: { openedAt: now } },
        { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
      );
    } catch (error) {
      if (error?.code !== 11000) throw error;
      openState = await LatestPostEngagementState.findOneAndUpdate(
        { user: user._id, task: task._id },
        { $set: { openedAt: now } },
        { new: true, runValidators: true }
      );
      if (!openState) throw error;
    }

    return res.json({
      success: true,
      status: 'WAITING_FOR_CHECK',
      openedAt: openState.openedAt,
      serverNow: now.getTime()
    });
  } catch (error) {
    console.error(`POST /api/tasks/${req.params.id}/engagement/open failed:`, error);
    return res.status(500).json({ success: false, code: 'SERVER_ERROR', message: 'ثبت Open Task انجام نشد.' });
  }
});

/** POST /api/tasks/:id/engagement/check — pays only after a server-recorded Open and outside cooldown. */
router.post('/:id/engagement/check', auth, async (req, res) => {
  const user = req.dbUser;
  const fail = (code, message, status = 409) => Object.assign(new Error(message), { code, status });

  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ success: false, code: 'TASK_NOT_FOUND', message: 'Task پیدا نشد.' });
    }

    const initialTask = await Task.findById(req.params.id);
    const requestNow = new Date();
    if (!initialTask || initialTask.verifyType !== 'latest_post') {
      return res.status(404).json({ success: false, code: 'TASK_NOT_FOUND', message: 'Latest Post Task پیدا نشد.' });
    }
    if (!initialTask.isActive || (initialTask.expiresAt && initialTask.expiresAt <= requestNow)) {
      return res.status(409).json({ success: false, code: 'TASK_INACTIVE', message: 'این Task فعال نیست.' });
    }
    if (initialTask.isSponsored || !Number.isFinite(initialTask.reward) || initialTask.reward <= 0) {
      return res.status(503).json({ success: false, code: 'TASK_SETUP_INCOMPLETE', message: 'تنظیمات این Task کامل نیست؛ پاداشی پرداخت نشد.' });
    }

    const settings = await Settings.getGlobal();
    const payment = await withMongoTransaction(async session => {
      const currentTask = await Task.findById(initialTask._id).session(session);
      const transactionNow = new Date();
      if (!currentTask || currentTask.verifyType !== 'latest_post' || !currentTask.isActive || (currentTask.expiresAt && currentTask.expiresAt <= transactionNow)) {
        throw fail('TASK_INACTIVE', 'این Task فعال نیست.');
      }
      if (currentTask.isSponsored || !Number.isFinite(currentTask.reward) || currentTask.reward <= 0) {
        throw fail('TASK_SETUP_INCOMPLETE', 'تنظیمات این Task کامل نیست.');
      }

      const completion = await TaskCompletion.findOne({ user: user._id, task: currentTask._id }).session(session);
      if (isLatestPostCooldownActive(completion?.nextAvailableAt, transactionNow)) {
        throw fail('TASK_COOLDOWN_ACTIVE', 'این Task هنوز در Cooldown است.', 429);
      }

      const openState = await LatestPostEngagementState.findOne({ user: user._id, task: currentTask._id })
        .session(session).lean();
      const openedAt = openState?.openedAt || null;
      if (!isLatestPostOpenValid({ openedAt, lastCompletedAt: completion?.lastCompletedAt, now: transactionNow })) {
        throw fail('TASK_NOT_OPENED', 'ابتدا Open Task را بزنید، سپس Check را انتخاب کنید.');
      }

      const consumedOpenState = await LatestPostEngagementState.findOneAndDelete({
        _id: openState._id,
        openedAt: openState.openedAt
      }).session(session);
      if (!consumedOpenState) throw fail('TASK_OPEN_CONFLICT', 'وضعیت Open هم‌زمان تغییر کرد؛ دوباره Task را باز کنید.');

      const recurringClaimCount = Number(completion?.recurringClaimCount || 0) + 1;
      const nextAvailableAt = nextLatestPostAvailableAt(transactionNow);
      const costUsd = rewardCostUsd(currentTask.reward, settings.rate, settings.gramUsdPrice);
      const updatedTask = await Task.findOneAndUpdate(
        { ...taskCapacityFilter(currentTask._id, transactionNow), verifyType: 'latest_post' },
        { $inc: { completedCount: 1 } },
        { new: true, session }
      );
      if (!updatedTask) throw fail('TASK_FULL', 'ظرفیت این Task تکمیل شده یا غیرفعال است.');
      if (updatedTask.maxCompletions != null && updatedTask.completedCount >= updatedTask.maxCompletions) {
        await Task.updateOne({ _id: updatedTask._id, completedCount: updatedTask.completedCount }, { $set: { isActive: false } }, { session });
      }

      if (completion) {
        const savedCompletion = await TaskCompletion.findOneAndUpdate(
          { _id: completion._id, recurringClaimCount: Number(completion.recurringClaimCount || 0) },
          {
            $set: {
              status: 'approved',
              reward: currentTask.reward,
              lastCompletedAt: transactionNow,
              nextAvailableAt,
              revenueUsd: 0,
              costUsd,
              reviewedAt: transactionNow,
              reviewedBy: 'engagement-open-check'
            },
            $inc: { recurringClaimCount: 1 }
          },
          { new: true, session }
        );
        if (!savedCompletion) throw fail('TASK_CLAIM_CONFLICT', 'درخواست هم‌زمان تغییر کرد؛ Task را دوباره بارگذاری کنید.');
      } else {
        await new TaskCompletion({
          _id: TaskCompletion.idForUserTask(user._id, currentTask._id),
          user: user._id,
          task: currentTask._id,
          reward: currentTask.reward,
          status: 'approved',
          recurringClaimCount,
          lastCompletedAt: transactionNow,
          nextAvailableAt,
          revenueUsd: 0,
          costUsd,
          reviewedAt: transactionNow,
          reviewedBy: 'engagement-open-check'
        }).save({ session });
      }

      const rewardedUser = await User.findByIdAndUpdate(
        user._id,
        { $inc: { points: currentTask.reward } },
        { new: true, session }
      );
      if (!rewardedUser) throw new Error('کاربر برای ثبت پاداش پیدا نشد.');

      const ledgerResult = await recordLedgerRequired({
        user: user._id,
        type: 'task',
        amount: currentTask.reward,
        description: currentTask.title,
        balanceAfter: rewardedUser.points,
        sourceId: buildRecurringTaskSourceId(currentTask._id, user._id, recurringClaimCount),
        session
      });
      if (!ledgerResult.created) {
        throw fail('TASK_CLAIM_CONFLICT', 'این چرخه قبلاً در Transaction ثبت شده است؛ Reward دوباره پرداخت نشد.');
      }

      return {
        points: rewardedUser.points,
        reward: currentTask.reward,
        recurringClaimCount,
        nextAvailableAt,
        serverNow: transactionNow.getTime()
      };
    });

    maybeAwardReferralBonus(user._id).catch(error => console.error('Referral bonus check failed:', error));
    return res.json({
      success: true,
      message: `${payment.reward} پوینت به حساب شما اضافه شد.`,
      points: payment.points,
      reward: payment.reward,
      status: 'approved',
      recurringClaimCount: payment.recurringClaimCount,
      cooldownHours: LATEST_POST_COOLDOWN_HOURS,
      nextAvailableAt: payment.nextAvailableAt,
      serverNow: payment.serverNow
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, code: 'TASK_CLAIM_CONFLICT', message: 'این دوره قبلاً ثبت شده یا درخواست هم‌زمانی انجام شد؛ وضعیت Task را تازه کنید.' });
    }
    if (error?.status) {
      return res.status(error.status).json({ success: false, code: error.code, message: error.message });
    }
    console.error(`POST /api/tasks/${req.params.id}/engagement/check failed:`, error);
    return res.status(500).json({ success: false, code: 'SERVER_ERROR', message: 'تأیید Task انجام نشد و پاداشی پرداخت نشد.' });
  }
});

async function claimBioLinkTask(req, res, task) {
  const fail = (status, code, message) => res.status(status).json({ success: false, code, message });
  if (!bot) return fail(503, 'TELEGRAM_BOT_UNAVAILABLE', 'بررسی بیو فعلاً در دسترس نیست.');
  const channels = await RequiredChannel.find({ isActive: true }).select('username url').lean();
  const allowed = new Set(
    String(process.env.BIO_LINK_ALLOWED_USERNAMES || '').split(',').map(normalizeTelegramUsername).filter(Boolean)
  );
  [process.env.BOT_USERNAME, process.env.COMMUNITY_CHANNEL_USERNAME, process.env.COMMUNITY_CHANNEL_URL, process.env.PUBLIC_CHANNEL_URL, ...channels.flatMap(channel => [channel.username, channel.url])]
    .map(normalizeTelegramUsername).filter(Boolean).forEach(username => allowed.add(username));
  if (!allowed.size) return fail(503, 'BIO_LINK_TARGETS_NOT_CONFIGURED', 'لینک رسمی ربات یا کانال برای این تسک پیکربندی نشده است.');

  let profile;
  let profileTimeout;
  try {
    profile = await Promise.race([
      bot.getChat(req.dbUser.telegramId),
      new Promise((_, reject) => { profileTimeout = setTimeout(() => reject(Object.assign(new Error('Telegram API timeout'), { code: 'TELEGRAM_TIMEOUT' })), 12000); })
    ]);
  } catch (error) {
    console.warn('Telegram bio verification API failed:', error.message || error);
    return fail(503, 'TELEGRAM_PROFILE_UNAVAILABLE', 'پروفایل تلگرام از API دریافت نشد؛ کمی بعد دوباره تلاش کنید.');
  } finally {
    clearTimeout(profileTimeout);
  }
  if (typeof profile?.bio !== 'string' || !bioContainsAllowedLink(profile.bio, [...allowed])) {
    return fail(400, 'BIO_LINK_NOT_FOUND', 'لینک ربات Gramup یا یکی از کانال‌های رسمی را در بیوی تلگرام قرار دهید و دوباره بررسی کنید.');
  }

  try {
    const settings = await Settings.getGlobal();
    const payment = await withMongoTransaction(async session => {
      const currentTask = await Task.findOne({ _id: task._id, taskKind: BIO_LINK_TASK_KIND, isActive: true }).session(session);
      const now = new Date();
      if (!currentTask) throw Object.assign(new Error('این تسک فعال نیست.'), { status: 409, code: 'TASK_INACTIVE' });
      if (Number(currentTask.reward) !== BIO_LINK_REWARD) throw Object.assign(new Error('تنظیم پاداش تسک نامعتبر است.'), { status: 503, code: 'TASK_SETUP_INCOMPLETE' });
      const completion = await TaskCompletion.findOne({ user: req.dbUser._id, task: currentTask._id }).session(session);
      if (completion?.nextAvailableAt && new Date(completion.nextAvailableAt).getTime() > now.getTime()) {
        throw Object.assign(new Error('پاداش این تسک هر ۲۴ ساعت یک‌بار قابل دریافت است.'), {
          status: 429, code: 'TASK_COOLDOWN_ACTIVE', nextAvailableAt: completion.nextAvailableAt
        });
      }
      const cycle = Number(completion?.recurringClaimCount || 0) + 1;
      const nextAvailableAt = nextBioClaimAt(now);
      const costUsd = rewardCostUsd(BIO_LINK_REWARD, settings.rate, settings.gramUsdPrice);
      if (completion) {
        const saved = await TaskCompletion.findOneAndUpdate(
          { _id: completion._id, recurringClaimCount: Number(completion.recurringClaimCount || 0) },
          { $set: { status: 'approved', reward: BIO_LINK_REWARD, lastCompletedAt: now, nextAvailableAt, reviewedAt: now, reviewedBy: 'telegram-bio-api', costUsd, revenueUsd: 0 }, $inc: { recurringClaimCount: 1 } },
          { new: true, session }
        );
        if (!saved) throw Object.assign(new Error('درخواست هم‌زمان بود؛ دوباره تلاش کنید.'), { status: 409, code: 'TASK_CLAIM_CONFLICT' });
      } else {
        await new TaskCompletion({
          _id: TaskCompletion.idForUserTask(req.dbUser._id, currentTask._id), user: req.dbUser._id, task: currentTask._id,
          reward: BIO_LINK_REWARD, status: 'approved', recurringClaimCount: 1, lastCompletedAt: now,
          nextAvailableAt, reviewedAt: now, reviewedBy: 'telegram-bio-api', costUsd, revenueUsd: 0
        }).save({ session });
      }
      const reservedTask = await Task.findOneAndUpdate(
        { _id: currentTask._id, taskKind: BIO_LINK_TASK_KIND, isActive: true },
        { $inc: { completedCount: 1 } }, { new: true, session }
      );
      if (!reservedTask) throw Object.assign(new Error('این تسک غیرفعال شد.'), { status: 409, code: 'TASK_INACTIVE' });
      const rewarded = await User.findByIdAndUpdate(req.dbUser._id, { $inc: { points: BIO_LINK_REWARD } }, { new: true, session });
      if (!rewarded) throw new Error('کاربر برای ثبت پاداش پیدا نشد.');
      const ledgerResult = await recordLedgerRequired({
        user: req.dbUser._id, type: 'task', amount: BIO_LINK_REWARD, description: currentTask.title,
        balanceAfter: rewarded.points,
        sourceId: buildRecurringTaskSourceId(currentTask._id, req.dbUser._id, cycle), session
      });
      if (!ledgerResult.created) throw Object.assign(new Error('این دوره قبلاً پرداخت شده است.'), { status: 409, code: 'TASK_CLAIM_CONFLICT' });
      return { points: rewarded.points, reward: BIO_LINK_REWARD, nextAvailableAt, serverNow: now.getTime(), recurringClaimCount: cycle };
    });
    maybeAwardReferralBonus(req.dbUser._id).catch(error => console.error('Referral bonus check failed:', error));
    return res.json({ success: true, ...payment, cooldownHours: BIO_LINK_COOLDOWN_MS / (60 * 60 * 1000), status: 'approved', message: 'لینک بیو تأیید شد؛ ۵ پوینت به حساب شما اضافه شد.' });
  } catch (error) {
    if (error?.status) return fail(error.status, error.code, error.message);
    if (error?.code === 11000) return fail(409, 'TASK_CLAIM_CONFLICT', 'درخواست هم‌زمان بود؛ وضعیت تسک را تازه کنید.');
    console.error('Telegram bio task claim failed:', error);
    return fail(500, 'SERVER_ERROR', 'ثبت پاداش انجام نشد؛ دوباره تلاش کنید.');
  }
}

/**
 * POST /api/tasks/:id/claim
 * عضویت کاربر در کانال/گروه تلگرامی را با API خود تلگرام بررسی می‌کند.
 * اگر عضو باشد، پاداش اصلی بلافاصله داده می‌شود و کمیسیون‌های Referral در
 * همان Mongo transaction ثبت می‌شوند؛ سپس Eligibility قدیمی برداشت به‌روز می‌شود.
 *
 * توجه: کل بدنه در try/catch پیچیده شده — در Express 4، اگر یک خطای
 * غیرمنتظره داخل async handler رخ دهد و catch نشود، درخواست کاربر
 * بی‌پاسخ می‌ماند (نه یک خطای JSON مرتب) و در مرورگر شبیه "قطع شدن
 * ارتباط" دیده می‌شود. این تغییر تضمین می‌کند همیشه یک پاسخ JSON
 * برگردد، هرچه که خطا باشد.
 */
router.post('/:id/claim', auth, async (req, res) => {
  try {
    const u = req.dbUser;
    const task = await Task.findById(req.params.id);

    if (!task || !task.isActive) {
      return res.status(404).json({ success: false, message: 'تسک پیدا نشد.', code: 'TASK_NOT_FOUND' });
    }
    if (task.taskKind === BIO_LINK_TASK_KIND) return claimBioLinkTask(req, res, task);
    if (task.verifyType !== 'telegram') {
      return res.status(409).json({ success: false, message: 'این نوع تسک هنوز برای ارسال و بررسی Proof فعال نشده است.', code: 'MANUAL_TASK_DISABLED' });
    }

    const existing = await TaskCompletion.findOne({ user: u._id, task: task._id });
    if (existing && existing.status !== 'rejected') {
      return res.status(400).json({ success: false, message: 'این تسک قبلاً انجام شده است.', code: 'ALREADY_DONE' });
    }

    const result = await checkChatMembership(task.chatId, u.telegramId);

    if (result.configError) {
      return res.status(400).json({
        success: false,
        joined: false,
        message: `⚠️ ${result.configError}`,
        code: 'VERIFY_CONFIG_ERROR'
      });
    }

    if (!result.joined) {
      return res.status(400).json({
        success: false,
        joined: false,
        message: 'هنوز عضویت شما تأیید نشد. ابتدا در کانال/گروه عضو شوید، سپس دوباره روی «بررسی» بزنید.',
        code: 'NOT_JOINED'
      });
    }

    const settings = await Settings.getGlobal();
    const payment = await withMongoTransaction(async session => {
      const currentTask = await Task.findById(task._id).session(session);
      if (!currentTask || !currentTask.isActive || (currentTask.expiresAt && currentTask.expiresAt <= new Date())) {
        const error = new Error('تسک پیدا نشد یا منقضی شده است.');
        error.code = 'TASK_FULL';
        throw error;
      }

      const currentCompletion = await TaskCompletion.findOne({ user: u._id, task: currentTask._id }).session(session);
      if (currentCompletion && currentCompletion.status !== 'rejected') {
        const error = new Error('این تسک قبلاً انجام شده است.');
        error.code = 'ALREADY_DONE';
        throw error;
      }

      const reserved = await Task.findOneAndUpdate(
        taskCapacityFilter(currentTask._id, new Date()),
        { $inc: { completedCount: 1 } },
        { new: true, session }
      );
      if (!reserved) {
        const error = new Error('ظرفیت این تسک تکمیل شده یا غیرفعال شده است.');
        error.code = 'TASK_FULL';
        throw error;
      }

      const revenueUsd = currentTask.isSponsored ? Number(currentTask.sponsorPriceUsd) || 0 : 0;
      const costUsd = rewardCostUsd(currentTask.reward, settings.rate, settings.gramUsdPrice);
      if (currentCompletion) {
        await TaskCompletion.findOneAndUpdate(
          { _id: currentCompletion._id, status: 'rejected' },
          { $set: { status: 'approved', reward: currentTask.reward, revenueUsd, costUsd } },
          { new: true, session }
        );
      } else {
      await new TaskCompletion({
        _id: TaskCompletion.idForUserTask(u._id, currentTask._id),
        user: u._id,
        task: currentTask._id,
        reward: currentTask.reward,
        status: 'approved',
        revenueUsd,
        costUsd
      }).save({ session });
      }

      if (reserved.maxCompletions != null && reserved.completedCount >= reserved.maxCompletions) {
        await Task.updateOne({ _id: reserved._id }, { $set: { isActive: false } }, { session });
      }

      const rewarded = await User.findByIdAndUpdate(
        u._id,
        { $inc: { points: currentTask.reward } },
        { new: true, session }
      );
      if (!rewarded) throw new Error('کاربر برای ثبت پاداش پیدا نشد.');

      const ledgerResult = await recordLedgerRequired({
        user: u._id,
        type: 'task',
        amount: currentTask.reward,
        description: currentTask.title,
        balanceAfter: rewarded.points,
        sourceId: `task:${currentTask._id}:user:${u._id}`,
        session
      });
      if (!ledgerResult.created) {
        const error = new Error('پاداش این تسک قبلاً ثبت شده است.');
        error.code = 'ALREADY_DONE';
        throw error;
      }
      return { points: rewarded.points, reward: currentTask.reward };
    });

    // بعد از ثبت موفق تسک، بررسی می‌کنیم آیا پاداش رفرال دعوت‌کننده
    // (در صورت وجود) باید همین حالا آزاد شود.
    maybeAwardReferralBonus(u._id).catch(error =>
      console.error('Referral bonus check failed:', error)
    );

    res.json({
      success: true,
      joined: true,
      message: `${payment.reward} پوینت به حساب شما اضافه شد.`,
      points: payment.points,
      status: 'approved'
    });
  } catch (error) {
    console.error(`POST /api/tasks/${req.params.id}/claim failed:`, error);
    if (error.code === 'ALREADY_DONE' || error.code === 'TASK_FULL' || error?.code === 11000) {
      return res.status(409).json({ success: false, message: error.message || 'این تسک قبلاً ثبت شده است؛ وضعیت را تازه کنید.', code: error.code === 11000 ? 'ALREADY_DONE' : error.code });
    }
    res.status(500).json({
      success: false,
      message: `خطای سرور: ${error.message}`,
      code: 'SERVER_ERROR'
    });
  }
});

module.exports = router;
