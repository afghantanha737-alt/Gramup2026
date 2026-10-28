'use strict';
const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const router = express.Router();
require('../utils/asyncHandler').wrapRouter(router);
const multer = require('multer');
const Task = require('../models/Task');
const Withdrawal = require('../models/Withdrawal');
const User = require('../models/User');
const Settings = require('../models/Settings');
const { normalizeTonAddress, amountToNanoGram, verifyNativeGramTransfer, findIncomingNativeGramTransferByReference } = require('../utils/tonNativeDepositVerify');
const { bot, notifyUser, markTelegramBlocked, isTelegramDeliveryBlocked, broadcastToActiveUsers } = require('../utils/bot');
const { botText } = require('../utils/botMessages');
const { postWithdrawalPaid } = require('../utils/payoutChannel');
const { sendNotificationOnce } = require('../utils/notificationDelivery');
const { verifyTonTransaction, normalizeTonTxHash, legacyTonTxHashMatcher } = require('../utils/tonVerify');
const { recordLedgerRequired } = require('../utils/ledger');
const { recordAdminLog, recordAdminLogRequired } = require('../utils/adminLog');
const { normalizeTaskUrl } = require('../utils/taskUrl');
const AdminLog = require('../models/AdminLog');
const TaskCompletion = require('../models/TaskCompletion');
const PointsLedger = require('../models/PointsLedger');
const BalanceAudit = require('../models/BalanceAudit');
const ReferralRelationship = require('../models/ReferralRelationship');
const WeeklyLeaderboardAward = require('../models/WeeklyLeaderboardAward');
const LatestPostEngagementState = require('../models/LatestPostEngagementState');
const Deposit = require('../models/Deposit');
const NotificationDelivery = require('../models/NotificationDelivery');
const BroadcastJob = require('../models/BroadcastJob');
const IdempotencyOperation = require('../models/IdempotencyOperation');
const VipPlan = require('../models/VipPlan');
const VipSubscription = require('../models/VipSubscription');
const VipReserve = require('../models/VipReserve');
const { isValidAdminKey } = require('../utils/adminKey');
const RequiredChannel = require('../models/RequiredChannel');
const { membership, validateChannelRef, normalizeChannelInput } = require('../utils/membership');
const { canTransition, requiresReason, shouldRefund, synthesizeHistory, isTerminal } = require('../utils/withdrawalStatus');
const { COMMON_TIMEZONES, isValidTimezone, targetUtcHour } = require('../utils/timezones');
const { sendTestReminder, sendTestReminderToAll, kabulReminderTarget } = require('../utils/dailyReminder');
const { normalizeSponsorInput, marginInfo, rewardCostUsd } = require('../utils/sponsor');
const { startOfUtcWeek, endOfUtcWeek, weekKey } = require('../utils/weeklyLeaderboard');
const { createAdminSession, getAdminSession, revokeAdminSession, SESSION_TTL_MS } = require('../utils/adminSession');
const { buildDiscrepancy, isDiscrepant } = require('../utils/financialAudit');
const { snapshot: metricsSnapshot } = require('../utils/metrics');
const { withMongoTransaction, getMongoTransactionStatus } = require('../utils/mongoTransaction');
const { transitionWithdrawalWithRefund } = require('../utils/withdrawalFinance');
const { normalizeReferralRates, DEFAULT_REFERRAL_LEVEL_RATES, DEFAULT_REFERRAL_INITIAL_REWARD_POINTS } = require('../utils/referralCore');
const { validateLatestPostConfig } = require('../utils/latestPostEngagement');
const { getTelegramWebhookMetrics } = require('../utils/telegramWebhookMetrics');
const { calculateTotalRewardCents } = require('../utils/vipRewards');
const { toVipAdminRecord } = require('../utils/vipAdminReadModel');
const { toCents: vipReserveToCents, fundReserve: fundVipReserve, reserveSnapshot: vipReserveSnapshot } = require('../utils/vipReserve');
const { isTestEnvironment, normalizeAllowedTelegramIds } = require('../utils/maintenance');
const { isTestDeleteEnvironment } = require('../utils/adminUserDeletion');
const { creditVerifiedDeposit, rejectPendingDeposit } = require('../utils/depositFinance');
const { buildVipReserveReport, buildVipReserveWorkbook } = require('../utils/vipReserveReport');
const { pricingForVipPlan, pricePointsForVipPlan } = require('../utils/vipPricing');

const MAX_REQUIRED_CHANNELS = 5;

const escapeRegex = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function pageParams(query, defaultLimit = 100, maxLimit = 300) {
  const page = Math.max(1, Math.floor(Number(query.page) || 1));
  const limit = Math.min(maxLimit, Math.max(1, Math.floor(Number(query.limit) || defaultLimit)));
  return { page, limit, skip: (page - 1) * limit };
}

function safeAdminReferralRates(settings) {
  try { return normalizeReferralRates(settings?.referralLevelRates); }
  catch { return [...DEFAULT_REFERRAL_LEVEL_RATES]; }
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }
});

async function requireAdmin(req, res, next) {
  try {
    const session = await getAdminSession(req.headers['x-admin-session']);
    const legacyKey = req.headers['x-admin-key'];
    const legacyAllowed = process.env.ALLOW_LEGACY_ADMIN_KEY === 'true';
    if (!session && (!legacyAllowed || !isValidAdminKey(typeof legacyKey === 'string' ? legacyKey : ''))) {
      return res.status(403).json({ success: false, message: 'دسترسی غیرمجاز.' });
    }
    req.adminActor = session?.actor || String(req.headers['x-admin-name'] || '').trim() || 'ادمین';
    req.adminId = session?.adminId || 'legacy-admin-key';
    next();
  } catch (error) {
    console.error('Admin session lookup failed:', error.message || error);
    return res.status(503).json({ success: false, message: 'Admin authentication is temporarily unavailable.' });
  }
}

// کلید اصلی فقط یک‌بار در لحظه ورود ارسال می‌شود و بعد از آن session کوتاه‌مدت استفاده می‌شود.
router.post('/login', async (req, res) => {
  const key = String(req.body?.key || '');
  if (!isValidAdminKey(key)) return res.status(403).json({ success: false, message: 'کلید ادمین نادرست است.' });
  const actor = String(req.body?.name || '').trim() || 'ادمین';
  const session = await createAdminSession(actor);
  res.json({ success: true, sessionToken: session.token, expiresAt: session.expiresAt, ttlMs: SESSION_TTL_MS });
});

router.use(requireAdmin);
router.post('/logout', async (req, res) => {
  await revokeAdminSession(req.headers['x-admin-session']);
  res.json({ success: true });
});
router.get('/telegram-status', async (req, res) => {
  const appUrl = String(process.env.APP_URL || '').replace(/\/$/, '');
  const expectedWebhookUrl = appUrl ? `${appUrl}/api/telegram/webhook` : '';
  if (!bot) {
    return res.status(503).json({
      success: false,
      message: 'BOT_TOKEN در این سرور تنظیم نشده است.',
      botConfigured: false,
      appUrlConfigured: Boolean(appUrl),
      webhookMetrics: getTelegramWebhookMetrics()
    });
  }

  const [meResult, webhookResult] = await Promise.allSettled([bot.getMe(), bot.getWebhookInfo()]);
  const me = meResult.status === 'fulfilled' ? meResult.value : null;
  const webhookInfo = webhookResult.status === 'fulfilled' ? webhookResult.value : null;
  const webhookUrl = webhookInfo?.url || '';
  const webhookSecret = String(process.env.TELEGRAM_WEBHOOK_SECRET || '');
  const webhookSecretValid = !webhookSecret || /^[A-Za-z0-9_-]{1,256}$/.test(webhookSecret);
  const allowedUpdates = Array.isArray(webhookInfo?.allowed_updates) ? webhookInfo.allowed_updates : [];
  const isUpdateEnabled = update => allowedUpdates.length
    ? allowedUpdates.includes(update)
    : !['chat_member', 'message_reaction', 'message_reaction_count'].includes(update);
  const requiredUpdates = ['message', 'channel_post', 'message_reaction'];
  const missingUpdates = requiredUpdates.filter(update => !isUpdateEnabled(update));
  const webhookUrlMatchesExpected = Boolean(expectedWebhookUrl && webhookUrl.replace(/\/$/, '') === expectedWebhookUrl);
  const checks = {
    botTokenValid: Boolean(me),
    appUrlConfigured: Boolean(appUrl),
    webhookConfigured: Boolean(webhookUrl),
    webhookUrlMatchesExpected,
    webhookSecretValid,
    messageUpdateEnabled: isUpdateEnabled('message'),
    channelPostUpdateEnabled: isUpdateEnabled('channel_post'),
    messageReactionUpdateEnabled: isUpdateEnabled('message_reaction')
  };
  const issues = [];
  if (!checks.botTokenValid) issues.push(`Telegram getMe failed: ${meResult.reason?.message || 'نامشخص'}`);
  if (!checks.appUrlConfigured) issues.push('APP_URL در سرور تنظیم نشده است.');
  if (!checks.webhookConfigured) issues.push('Webhook برای Bot تنظیم نشده است.');
  else if (!webhookUrlMatchesExpected) issues.push('Webhook URL با APP_URL فعلی یکسان نیست.');
  if (!webhookSecretValid) issues.push('TELEGRAM_WEBHOOK_SECRET فرمت موردقبول Telegram را ندارد.');
  if (missingUpdates.length) issues.push(`Updateهای لازم فعال نیستند: ${missingUpdates.join(', ')}`);
  if (webhookResult.status === 'rejected') issues.push(`getWebhookInfo failed: ${webhookResult.reason?.message || 'نامشخص'}`);
  if (webhookInfo?.last_error_message) issues.push(`Telegram last webhook error: ${webhookInfo.last_error_message}`);

  return res.json({
    success: true,
    botConfigured: true,
    bot: { id: me?.id ? String(me.id) : null, username: me?.username || null, getMeOk: Boolean(me) },
    appUrlConfigured: Boolean(appUrl),
    webhookSecretConfigured: Boolean(webhookSecret),
    webhookSecretValid,
    webhook: {
      url: webhookUrl,
      expectedUrl: expectedWebhookUrl,
      urlMatchesExpected: webhookUrlMatchesExpected,
      allowedUpdates,
      pendingUpdateCount: Number(webhookInfo?.pending_update_count) || 0,
      lastErrorMessage: webhookInfo?.last_error_message || '',
      lastErrorDate: webhookInfo?.last_error_date ? new Date(Number(webhookInfo.last_error_date) * 1000).toISOString() : null,
      error: webhookResult.status === 'rejected' ? String(webhookResult.reason?.message || 'getWebhookInfo failed').slice(0, 300) : ''
    },
    checks,
    missingUpdates,
    pendingIssues: issues,
    readyForStart: checks.botTokenValid && checks.appUrlConfigured && checks.webhookConfigured && webhookUrlMatchesExpected && webhookSecretValid && checks.messageUpdateEnabled,
    readyForLatestPost: checks.botTokenValid && checks.appUrlConfigured && checks.webhookConfigured && webhookUrlMatchesExpected && webhookSecretValid && checks.channelPostUpdateEnabled && checks.messageReactionUpdateEnabled,
    webhookMetrics: getTelegramWebhookMetrics()
  });
});
router.post('/telegram-reconfigure', async (req, res) => {
  const appUrl = String(process.env.APP_URL || '').replace(/\/$/, '');
  const webhookSecret = String(process.env.TELEGRAM_WEBHOOK_SECRET || '');
  if (!bot) return res.status(503).json({ success: false, message: 'BOT_TOKEN تنظیم نشده است.' });
  if (!appUrl) return res.status(400).json({ success: false, message: 'APP_URL تنظیم نشده است.' });
  if (webhookSecret && !/^[A-Za-z0-9_-]{1,256}$/.test(webhookSecret)) {
    return res.status(400).json({ success: false, message: 'TELEGRAM_WEBHOOK_SECRET فرمت معتبر Telegram ندارد.' });
  }
  const url = `${appUrl}/api/telegram/webhook`;
  const options = {
    allowed_updates: ['message', 'callback_query', 'channel_post', 'message_reaction'],
    ...(webhookSecret ? { secret_token: webhookSecret } : {})
  };
  try {
    await bot.setWebHook(url, options);
    const info = await bot.getWebhookInfo();
    return res.json({
      success: true,
      message: 'Webhook دوباره روی تنظیمات فعلی GramUp قرار گرفت.',
      webhook: {
        url: info.url || '',
        urlMatchesExpected: Boolean(info.url && info.url.replace(/\/$/, '') === url),
        allowedUpdates: info.allowed_updates || [],
        pendingUpdateCount: Number(info.pending_update_count) || 0,
        lastErrorMessage: info.last_error_message || ''
      }
    });
  } catch (error) {
    return res.status(502).json({ success: false, message: `تنظیم Webhook ناموفق بود: ${String(error.message || error).slice(0, 300)}` });
  }
});
router.get('/tasks/:id/latest-post-diagnostics', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ success: false, message: 'تسک پیدا نشد.' });
  }
  const task = await Task.findById(req.params.id)
    .select('title verifyType chatId latestPostMessageId latestPostDate requiredReaction')
    .lean();
  if (!task || task.verifyType !== 'latest_post') {
    return res.status(404).json({ success: false, message: 'Latest Post Task پیدا نشد.' });
  }
  if (!bot) return res.status(503).json({ success: false, message: 'BOT_TOKEN تنظیم نشده است.' });

  const webhook = { configured: false, url: '', urlMatchesExpected: false, allowedUpdates: [], pendingUpdateCount: 0, lastErrorMessage: '', error: '' };
  const botChannel = { id: '', username: '', status: '', isAdmin: false, error: '' };
  try {
    const info = await bot.getWebhookInfo();
    webhook.configured = Boolean(info.url);
    webhook.url = info.url || '';
    const expectedUrl = process.env.APP_URL ? `${process.env.APP_URL.replace(/\/$/, '')}/api/telegram/webhook` : '';
    webhook.urlMatchesExpected = Boolean(expectedUrl && webhook.url.replace(/\/$/, '') === expectedUrl);
    webhook.allowedUpdates = Array.isArray(info.allowed_updates) ? info.allowed_updates : [];
    webhook.pendingUpdateCount = Number(info.pending_update_count) || 0;
    webhook.lastErrorMessage = info.last_error_message || '';
    webhook.lastErrorDate = info.last_error_date ? new Date(Number(info.last_error_date) * 1000).toISOString() : null;
  } catch (error) {
    webhook.error = String(error.message || 'getWebhookInfo failed').slice(0, 300);
  }
  try {
    const me = await bot.getMe();
    botChannel.id = String(me.id);
    botChannel.username = me.username || '';
    const member = await bot.getChatMember(task.chatId, me.id);
    botChannel.status = member.status || '';
    botChannel.isAdmin = ['administrator', 'creator'].includes(member.status);
  } catch (error) {
    botChannel.error = String(error.message || 'Could not read bot membership').slice(0, 300);
  }

  const requiredUpdates = ['channel_post', 'message_reaction'];
  // Telegram defaults to all update types except chat_member and reaction updates.
  const isUpdateEnabled = update => Array.isArray(webhook.allowedUpdates) && webhook.allowedUpdates.length
    ? webhook.allowedUpdates.includes(update)
    : !['chat_member', 'message_reaction', 'message_reaction_count'].includes(update);
  const missingUpdates = requiredUpdates.filter(update => !isUpdateEnabled(update));
  const latestPostTracked = Number.isSafeInteger(task.latestPostMessageId) && task.latestPostMessageId > 0;
  const issues = [];
  if (webhook.error) issues.push(`خواندن وضعیت webhook ناموفق بود: ${webhook.error}`);
  if (!webhook.configured) issues.push('Webhook برای ربات تنظیم نشده است.');
  else if (!webhook.urlMatchesExpected) issues.push('آدرس webhook با APP_URL فعلی پروژه یکسان نیست.');
  if (missingUpdates.includes('channel_post')) issues.push('channel_post در allowed_updates فعال نیست.');
  if (missingUpdates.includes('message_reaction')) issues.push('message_reaction در allowed_updates فعال نیست.');
  if (!botChannel.isAdmin) issues.push('ربات در کانال ادمین نیست؛ برای دریافت channel_post و reaction آن را ادمین کانال کنید.');
  if (botChannel.error) issues.push(`بررسی عضویت ربات در کانال ناموفق بود: ${botChannel.error}`);
  if (webhook.lastErrorMessage) issues.push(`Telegram آخرین خطای webhook را گزارش کرده: ${webhook.lastErrorMessage}`);
  if (!latestPostTracked) issues.push('هنوز channel_post برای این کانال ثبت نشده است؛ Bot API تاریخچه را واکشی نمی‌کند. پس از اصلاح تنظیمات، یک پست جدید در کانال منتشر کنید تا webhook آن را ثبت کند.');

  return res.json({
    success: true,
    task: {
      id: String(task._id),
      title: task.title,
      chatId: task.chatId,
      requiredReaction: task.requiredReaction,
      latestPostMessageId: task.latestPostMessageId || null,
      latestPostDate: task.latestPostDate || null,
      latestPostTracked
    },
    webhook,
    botChannel,
    requiredUpdates,
    missingUpdates,
    pendingIssues: issues,
    readyForReactionVerification: issues.length === 0 && latestPostTracked
  });
});
/**
 * POST /api/admin/verify-chat — قبل از ساختن تسک، بررسی می‌کند آیا
 * chatId وارد‌شده واقعاً معتبر است و ربات در آن ادمین هست یا نه.
 * جلوی دقیقاً همان مشکلی را می‌گیرد که باعث شد تسک‌ها بی‌صدا شکست بخورند
 * (chatId اشتباه که فقط موقع تلاش واقعی کاربر مشخص می‌شد).
 */
router.post('/verify-chat', async (req, res) => {
  const chatId = String((req.body && req.body.chatId) || '').trim();
  if (!chatId) {
    return res.status(400).json({ success: false, message: 'chatId خالی است.' });
  }
  if (!bot) {
    return res.status(500).json({ success: false, message: 'ربات پیکربندی نشده (BOT_TOKEN).' });
  }

  try {
    const chat = await bot.getChat(chatId);
    const me = await bot.getMe();

    let botIsAdmin = false;
    try {
      const member = await bot.getChatMember(chatId, me.id);
      botIsAdmin = ['administrator', 'creator'].includes(member.status);
    } catch {
      botIsAdmin = false;
    }

    const title = chat.title || chat.username || chatId;

    return res.json({
      success: true,
      botIsAdmin,
      message: botIsAdmin
        ? `✅ معتبر است — «${title}». ربات ادمین این چت است.`
        : `⚠️ چت پیدا شد («${title}») ولی ربات ادمین این چت نیست — اول ربات رو از تنظیمات کانال/گروه، ادمین کن.`
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: `❌ chatId نامعتبر است: ${error.message}`
    });
  }
});

/* -------------------- TASKS -------------------- */
/**
 * GET /api/admin/tasks?search=...&type=...&status=active|inactive
 * جستجو روی عنوان/توضیحات، فیلتر روی نوع و وضعیت فعال/غیرفعال.
 */
router.get('/tasks', async (req, res) => {
  const { search, type, status } = req.query;
  const filter = {};

  if (search) {
    const regex = new RegExp(escapeRegex(String(search).trim()), 'i');
    filter.$or = [{ title: regex }, { description: regex }, { chatId: regex }];
  }
  if (type) filter.type = type;
  if (status === 'active') filter.isActive = true;
  if (status === 'inactive') filter.isActive = false;

  const tasks = await Task.find(filter).sort({ createdAt: -1 });

  // درآمد/هزینه‌ی هر تسک از روی «عکس لحظه‌ی تکمیل» (تغییر بعدی نرخ گزارش را خراب نمی‌کند)
  const perTask = await TaskCompletion.aggregate([
    { $match: { task: { $in: tasks.map(t => t._id) }, status: 'approved' } },
    { $group: { _id: '$task', joins: { $sum: 1 }, revenueUsd: { $sum: '$revenueUsd' }, costUsd: { $sum: '$costUsd' } } }
  ]);
  const statsByTask = new Map(perTask.map(row => [String(row._id), row]));

  const overall = await TaskCompletion.aggregate([
    { $match: { status: 'approved' } },
    {
      $group: {
        _id: null,
        revenueUsd: { $sum: '$revenueUsd' },
        allCostUsd: { $sum: '$costUsd' },
        sponsoredCostUsd: { $sum: { $cond: [{ $gt: ['$revenueUsd', 0] }, '$costUsd', 0] } },
        sponsoredJoins: { $sum: { $cond: [{ $gt: ['$revenueUsd', 0] }, 1, 0] } }
      }
    }
  ]);
  const o = overall[0] || { revenueUsd: 0, allCostUsd: 0, sponsoredCostUsd: 0, sponsoredJoins: 0 };

  res.json({
    success: true,
    tasks: tasks.map(t => {
      const row = statsByTask.get(String(t._id));
      return { ...t.toObject(), stats: { revenueUsd: row ? row.revenueUsd : 0, costUsd: row ? row.costUsd : 0 } };
    }),
    summary: {
      sponsoredRevenueUsd: o.revenueUsd,
      sponsoredCostUsd: o.sponsoredCostUsd,
      sponsoredProfitUsd: o.revenueUsd - o.sponsoredCostUsd,
      sponsoredJoins: o.sponsoredJoins,
      allTasksCostUsd: o.allCostUsd
    }
  });
});

router.post('/tasks', async (req, res) => {
  const { title, description, type, verifyType, url, reward, chatId, requiredReaction, cooldownHours, maxCompletions, force, isSpecialOfDay, isActive } = req.body || {};
  const taskTitle = String(title || '').trim();
  const taskUrl = normalizeTaskUrl(url);
  if (taskUrl === null) return res.status(400).json({ success: false, code: 'INVALID_TASK_URL', message: 'پیوند تسک باید یک آدرس معتبر HTTP یا HTTPS باشد.' });
  const taskVerifyType = String(verifyType || 'telegram');
  const taskReward = Number(reward === undefined && taskVerifyType === 'latest_post' ? 2 : reward);
  const taskType = String(type || (taskVerifyType === 'manual' || taskVerifyType === 'latest_post' ? 'custom' : 'link'));
  if (!taskTitle || !Number.isFinite(taskReward) || taskReward <= 0) {
    return res.status(400).json({ success: false, message: 'عنوان و مقدار پاداش الزامی است.' });
  }
  if (!['telegram', 'manual', 'latest_post'].includes(taskVerifyType)) {
    return res.status(400).json({ success: false, message: 'روش بررسی تسک نامعتبر است.' });
  }
  if (!['channel', 'group', 'link', 'custom'].includes(taskType)) {
    return res.status(400).json({ success: false, message: 'نوع تسک نامعتبر است.' });
  }
  if (taskVerifyType === 'telegram' && !String(chatId || '').trim()) {
    return res.status(400).json({ success: false, message: 'chatId (آیدی/یوزرنیم کانال یا گروه) الزامی است.' });
  }
  const finalCooldownHours = taskVerifyType === 'latest_post'
    ? Number(cooldownHours === undefined || cooldownHours === null || cooldownHours === '' ? 3 : cooldownHours)
    : 3;
  if (taskVerifyType === 'latest_post') {
    const configError = validateLatestPostConfig({ chatId, url, requiredReaction, cooldownHours: finalCooldownHours });
    if (configError) return res.status(400).json({ success: false, code: 'INVALID_LATEST_POST_TASK', message: configError });
  }

  // اگر خالی/صفر/نامعتبر بود یعنی «بدون محدودیت ظرفیت»
  const parsedMax = Number(maxCompletions);
  let finalMaxCompletions = Number.isFinite(parsedMax) && parsedMax > 0 ? Math.floor(parsedMax) : null;

  // ---- تسک اسپانسری: ظرفیت از بودجه محاسبه می‌شود و سود/زیان قبل از ثبت بررسی می‌شود
  const sponsor = normalizeSponsorInput(req.body);
  if (sponsor.error) return res.status(400).json({ success: false, message: sponsor.error });
  const sp = sponsor.value;
  if (taskVerifyType === 'latest_post' && sp.isSponsored) {
    return res.status(400).json({ success: false, message: 'Latest Post Engagement نمی‌تواند Task اسپانسری یا دارای ظرفیت محدود باشد.' });
  }
  if (taskVerifyType === 'latest_post') finalMaxCompletions = null;

  if (sp.isSponsored) {
    finalMaxCompletions = sp.maxCompletions;
    const settings = await Settings.getGlobal();
    const margin = marginInfo({
      reward: taskReward, rate: settings.rate, gramUsdPrice: settings.gramUsdPrice,
      priceUsd: sp.sponsorPriceUsd, budgetUsd: sp.sponsorBudgetUsd
    });
    if (!margin.canCompute && !force) {
      return res.status(400).json({
        success: false, code: 'COST_UNKNOWN',
        message: 'قیمت دلاری GRAM در تنظیمات وارد نشده، پس سود/زیان این تسک قابل محاسبه نیست.'
      });
    }
    if (margin.isLoss && !force) {
      return res.status(400).json({
        success: false, code: 'LOSS_MAKING',
        message: `با این پاداش، هزینه‌ی هر عضو (${margin.costPerJoinUsd.toFixed(4)}$) از دریافتی‌تان (${sp.sponsorPriceUsd}$) بیشتر است و در هر عضو ${Math.abs(margin.profitPerJoinUsd).toFixed(4)}$ ضرر می‌کنید.`
      });
    }
  }

  const task = await Task.create({
    title: taskTitle,
    description: String(description || '').trim(),
    type: taskType,
    verifyType: taskVerifyType,
    url: taskUrl,
    reward: taskReward,
    chatId: ['telegram', 'latest_post'].includes(taskVerifyType) ? String(chatId).trim() : '',
    requiredReaction: taskVerifyType === 'latest_post' ? String(requiredReaction).trim() : '',
    cooldownHours: finalCooldownHours,
    maxCompletions: finalMaxCompletions,
    isActive: isActive !== false && isActive !== 'false',
    isSpecialOfDay: isSpecialOfDay === true || isSpecialOfDay === 'true',
    isSponsored: sp.isSponsored,
    sponsorName: sp.sponsorName,
    sponsorPriceUsd: sp.sponsorPriceUsd,
    sponsorBudgetUsd: sp.sponsorBudgetUsd,
    expiresAt: sp.expiresAt
  });

  res.json({ success: true, task });

  recordAdminLog({
    actor: req.adminActor,
    action: 'task_create',
    targetType: 'task',
    targetId: task._id,
    details: sp.isSponsored
      ? `«${taskTitle}» — اسپانسر: ${sp.sponsorName} (${sp.sponsorPriceUsd}$ هر عضو، بودجه ${sp.sponsorBudgetUsd}$، ظرفیت ${finalMaxCompletions}) — پاداش ${taskReward} پوینت`
      : `«${taskTitle}» — پاداش ${taskReward} پوینت`
  });

  // اطلاع‌رسانی تسک جدید به همه‌ی کاربران فعال، هرکدام به زبان خودش؛ عمداً بدون await تا پاسخ به پنل ادمین معطل نماند
  if (task.isActive) {
    broadcastToActiveUsers(User, u => botText('taskNew', u.language, taskTitle, taskReward, sp.isSponsored ? sp.sponsorName : ''))
      .catch(error => console.warn('Task broadcast failed:', error.message || error));
  }
});

router.put('/tasks/:id', async (req, res) => {
  const body = req.body || {};
  const allowed = ['title', 'description', 'type', 'verifyType', 'chatId', 'url', 'reward', 'maxCompletions', 'isActive', 'isSpecialOfDay', 'requiredReaction', 'cooldownHours'];
  const update = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(body, key)) update[key] = body[key];
  }
  if (Object.prototype.hasOwnProperty.call(update, 'url')) {
    update.url = normalizeTaskUrl(update.url);
    if (update.url === null) return res.status(400).json({ success: false, code: 'INVALID_TASK_URL', message: 'پیوند تسک باید یک آدرس معتبر HTTP یا HTTPS باشد.' });
  }

  if (['verifyType', 'chatId', 'url', 'requiredReaction', 'cooldownHours'].some(key => key in update)) {
    const currentVerification = await Task.findById(req.params.id);
    if (!currentVerification) return res.status(404).json({ success: false, message: 'تسک پیدا نشد.' });
    const verifyType = String(update.verifyType ?? currentVerification.verifyType ?? 'telegram');
    const chatId = String(update.chatId ?? currentVerification.chatId ?? '').trim();
    if (!['telegram', 'manual', 'latest_post'].includes(verifyType)) {
      return res.status(400).json({ success: false, message: 'روش بررسی تسک نامعتبر است.' });
    }

    if (currentVerification.verifyType === 'latest_post' || verifyType === 'latest_post') {
      if (verifyType !== currentVerification.verifyType && await TaskCompletion.exists({ task: req.params.id })) {
        return res.status(409).json({ success: false, message: 'نوع بررسی Task پس از ثبت completion قابل تغییر نیست.' });
      }
      if (verifyType === 'latest_post') {
        if (currentVerification.isSponsored) {
          return res.status(400).json({ success: false, message: 'Latest Post Engagement نمی‌تواند Task اسپانسری باشد.' });
        }
        const latestConfig = {
          chatId,
          url: String(update.url ?? currentVerification.url ?? '').trim(),
          requiredReaction: String(update.requiredReaction ?? currentVerification.requiredReaction ?? '').trim(),
          cooldownHours: Number(update.cooldownHours ?? currentVerification.cooldownHours ?? 3)
        };
        const configError = validateLatestPostConfig(latestConfig);
        if (configError) return res.status(400).json({ success: false, code: 'INVALID_LATEST_POST_TASK', message: configError });
        update.verifyType = 'latest_post';
        update.chatId = latestConfig.chatId;
        update.url = latestConfig.url;
        update.requiredReaction = latestConfig.requiredReaction;
        update.cooldownHours = latestConfig.cooldownHours;
        update.maxCompletions = null;
        if (currentVerification.verifyType !== 'latest_post' || currentVerification.chatId !== latestConfig.chatId) {
          update.latestPostMessageId = null;
          update.latestPostDate = null;
          update.latestPostUpdateId = null;
        }
      } else {
        if (currentVerification.verifyType === 'manual' && verifyType !== 'manual') {
          const hasScreenshotSubmissions = await TaskCompletion.exists({
            task: req.params.id,
            proofMimeType: { $in: ['image/jpeg', 'image/png', 'image/webp'] }
          });
          if (hasScreenshotSubmissions) {
            return res.status(409).json({ success: false, message: 'روش بررسی Screenshot Task پس از ثبت submission قابل تغییر نیست.' });
          }
        }
        if (verifyType === 'telegram' && !chatId) {
          return res.status(400).json({ success: false, message: 'chatId برای تسک تلگرامی الزامی است.' });
        }
        update.verifyType = verifyType;
        update.chatId = verifyType === 'manual' ? '' : chatId;
        update.requiredReaction = '';
        update.cooldownHours = 3;
        update.latestPostMessageId = null;
        update.latestPostDate = null;
        update.latestPostUpdateId = null;
      }
    } else {
      if (currentVerification.verifyType === 'manual' && verifyType !== 'manual') {
        const hasScreenshotSubmissions = await TaskCompletion.exists({
          task: req.params.id,
          proofMimeType: { $in: ['image/jpeg', 'image/png', 'image/webp'] }
        });
        if (hasScreenshotSubmissions) {
          return res.status(409).json({ success: false, message: 'روش بررسی Screenshot Task پس از ثبت submission قابل تغییر نیست.' });
        }
      }
      if (verifyType === 'telegram' && !chatId) {
        return res.status(400).json({ success: false, message: 'chatId برای تسک تلگرامی الزامی است.' });
      }
      update.verifyType = verifyType;
      if (verifyType === 'manual') update.chatId = '';
      else if ('chatId' in update) update.chatId = chatId;
    }
  }

  // فیلدهای اسپانسری (ویرایش نام/قیمت/بودجه/پایان): با مقدارهای فعلی ادغام و دوباره اعتبارسنجی می‌شوند
  const sponsorKeys = ['isSponsored', 'sponsorName', 'sponsorPriceUsd', 'sponsorBudgetUsd', 'expiresAt'];
  if (sponsorKeys.some(key => Object.prototype.hasOwnProperty.call(body, key))) {
    const current = await Task.findById(req.params.id);
    if (!current) return res.status(404).json({ success: false, message: 'تسک پیدا نشد.' });
    const merged = {
      isSponsored: body.isSponsored !== undefined ? body.isSponsored : current.isSponsored,
      sponsorName: body.sponsorName !== undefined ? body.sponsorName : current.sponsorName,
      sponsorPriceUsd: body.sponsorPriceUsd !== undefined ? body.sponsorPriceUsd : current.sponsorPriceUsd,
      sponsorBudgetUsd: body.sponsorBudgetUsd !== undefined ? body.sponsorBudgetUsd : current.sponsorBudgetUsd,
      // تاریخ پایانِ قبلی اگر دست نخورده باشد دوباره «آینده بودن» چک نمی‌شود
      expiresAt: body.expiresAt !== undefined ? body.expiresAt : (current.expiresAt ? current.expiresAt.toISOString() : null)
    };
    const sponsor = normalizeSponsorInput(merged, body.expiresAt !== undefined ? new Date() : new Date(0));
    if (sponsor.error) return res.status(400).json({ success: false, message: sponsor.error });
    const sp = sponsor.value;

    if (current.verifyType === 'latest_post' && sp.isSponsored) {
      return res.status(400).json({ success: false, message: 'Latest Post Engagement نمی‌تواند Task اسپانسری باشد.' });
    }

    if (sp.isSponsored) {
      const rewardNow = update.reward !== undefined ? Number(update.reward) : current.reward;
      const settings = await Settings.getGlobal();
      const margin = marginInfo({
        reward: rewardNow, rate: settings.rate, gramUsdPrice: settings.gramUsdPrice,
        priceUsd: sp.sponsorPriceUsd, budgetUsd: sp.sponsorBudgetUsd
      });
      if (margin.isLoss && !body.force) {
        return res.status(400).json({
          success: false, code: 'LOSS_MAKING',
          message: `با این تنظیمات در هر عضو ${Math.abs(margin.profitPerJoinUsd).toFixed(4)}$ ضرر می‌کنید.`
        });
      }
      if (sp.maxCompletions < current.completedCount) {
        return res.status(400).json({ success: false, message: `بودجه کمتر از تعداد عضوهای تاکنون (${current.completedCount}) است.` });
      }
      update.maxCompletions = sp.maxCompletions; // ظرفیت همیشه از بودجه ÷ قیمت
    }
    Object.assign(update, {
      isSponsored: sp.isSponsored,
      sponsorName: sp.sponsorName,
      sponsorPriceUsd: sp.sponsorPriceUsd,
      sponsorBudgetUsd: sp.sponsorBudgetUsd,
      expiresAt: sp.expiresAt
    });
  }
  if ('reward' in update) {
    update.reward = Number(update.reward);
    if (!Number.isFinite(update.reward) || update.reward < 0) {
      return res.status(400).json({ success: false, message: 'مقدار پاداش نامعتبر است.' });
    }
  }
  if ('maxCompletions' in update && update.maxCompletions !== null && update.maxCompletions !== '') {
    update.maxCompletions = Number(update.maxCompletions);
    if (!Number.isFinite(update.maxCompletions) || update.maxCompletions < 1) {
      return res.status(400).json({ success: false, message: 'ظرفیت تسک نامعتبر است.' });
    }
  } else if ('maxCompletions' in update) {
    update.maxCompletions = null;
  }
  const taskForRules = await Task.findById(req.params.id).select('verifyType');
  if (!taskForRules) return res.status(404).json({ success: false, message: 'تسک پیدا نشد.' });
  if ((update.verifyType || taskForRules.verifyType) === 'latest_post') {
    if ('reward' in update && update.reward <= 0) {
      return res.status(400).json({ success: false, message: 'پاداش Latest Post Task باید بیشتر از صفر باشد.' });
    }
    if ('maxCompletions' in update) update.maxCompletions = null;
  }
  let task;
  try {
    task = await Task.findByIdAndUpdate(req.params.id, { $set: update }, { new: true, runValidators: true });
  } catch (error) {
    return res.status(400).json({ success: false, message: 'اطلاعات تسک نامعتبر است.' });
  }
  if (!task) return res.status(404).json({ success: false, message: 'تسک پیدا نشد.' });
  res.json({ success: true, task });

  recordAdminLog({
    actor: req.adminActor,
    action: 'task_update',
    targetType: 'task',
    targetId: task._id,
    details: `«${task.title}» ویرایش شد`
  });
});

router.delete('/tasks/:id', async (req, res) => {
  const currentTask = await Task.findById(req.params.id).select('_id verifyType');
  if (currentTask?.verifyType === 'manual') {
    const pendingSubmission = await TaskCompletion.exists({
      task: currentTask._id,
      status: 'pending',
      proofMimeType: { $in: ['image/jpeg', 'image/png', 'image/webp'] }
    });
    if (pendingSubmission) {
      return res.status(409).json({ success: false, message: 'تا زمان بررسی Screenshotهای در انتظار، این Task قابل حذف نیست.' });
    }
  }
  const task = await Task.findByIdAndDelete(req.params.id);
  res.json({ success: true });

  recordAdminLog({
    actor: req.adminActor,
    action: 'task_delete',
    targetType: 'task',
    targetId: req.params.id,
    details: task ? `«${task.title}» حذف شد (پاداش بود: ${task.reward} پوینت، chatId: ${task.chatId || '—'})` : 'تسک (که قبلاً هم پیدا نشد) حذف شد'
  });
});

router.get('/task-submissions', async (req, res) => {
  const requestedStatus = String(req.query.status || 'pending');
  const allowedStatuses = ['pending', 'approved', 'rejected'];
  if (requestedStatus !== 'all' && !allowedStatuses.includes(requestedStatus)) {
    return res.status(400).json({ success: false, message: 'وضعیت submission نامعتبر است.' });
  }
  const filter = { proofMimeType: { $in: ['image/jpeg', 'image/png', 'image/webp'] } };
  if (requestedStatus !== 'all') filter.status = requestedStatus;
  const [submissions, pendingCount] = await Promise.all([
    TaskCompletion.find(filter)
      .select('user task reward status proofMimeType submittedAt reviewedAt reviewedBy adminNote createdAt')
      .populate('user', 'telegramId firstName lastName username')
      .populate('task', 'title reward verifyType')
      .sort({ submittedAt: -1, createdAt: -1 })
      .lean(),
    TaskCompletion.countDocuments({
      proofMimeType: { $in: ['image/jpeg', 'image/png', 'image/webp'] },
      status: 'pending'
    })
  ]);
  res.json({ success: true, submissions, pendingCount });
});

router.get('/task-submissions/:id/image', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ success: false, message: 'Submission پیدا نشد.' });
  }
  const submission = await TaskCompletion.findById(req.params.id).select('+proofImage proofMimeType');
  if (!submission || !submission.proofImage || !['image/jpeg', 'image/png', 'image/webp'].includes(submission.proofMimeType)) {
    return res.status(404).json({ success: false, message: 'تصویر submission پیدا نشد.' });
  }
  const image = Buffer.from(submission.proofImage);
  res.set('Content-Type', submission.proofMimeType);
  res.set('Content-Length', String(image.length));
  res.set('Cache-Control', 'private, no-store');
  return res.status(200).send(image);
});

router.post('/task-submissions/:id/approve', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ success: false, message: 'Submission پیدا نشد.' });
  }
  const settings = await Settings.getGlobal();
  const reviewedAt = new Date();
  try {
    const payment = await withMongoTransaction(async session => {
      const submission = await TaskCompletion.findById(req.params.id).session(session);
      if (!submission) {
        const error = new Error('Submission پیدا نشد.');
        error.code = 'SUBMISSION_NOT_FOUND';
        throw error;
      }
      if (submission.status !== 'pending') {
        const error = new Error('این submission دیگر در انتظار بررسی نیست.');
        error.code = 'SUBMISSION_NOT_PENDING';
        throw error;
      }
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(submission.proofMimeType)) {
        const error = new Error('تصویر معتبر برای این submission ثبت نشده است.');
        error.code = 'SUBMISSION_IMAGE_MISSING';
        throw error;
      }

      const task = await Task.findById(submission.task).session(session);
      if (!task) {
        const error = new Error('Task Screenshot Verification پیدا نشد.');
        error.code = 'TASK_NOT_FOUND';
        throw error;
      }
      const reward = Number(submission.reward);
      if (!Number.isFinite(reward) || reward <= 0) {
        const error = new Error('پاداش ثبت‌شده برای submission نامعتبر است.');
        error.code = 'INVALID_REWARD';
        throw error;
      }

      const sourceId = `task:${task._id}:user:${submission.user}`;
      const existingLedger = await PointsLedger.findOne({ sourceId }).select('_id').session(session);
      if (existingLedger) {
        const error = new Error('پاداش این task قبلاً در تاریخچه ثبت شده است.');
        error.code = 'TASK_REWARD_ALREADY_PAID';
        throw error;
      }

      const reservedTask = await Task.findOneAndUpdate(
        {
          _id: task._id,
          $or: [
            { maxCompletions: null },
            { $expr: { $lt: ['$completedCount', '$maxCompletions'] } }
          ]
        },
        { $inc: { completedCount: 1 } },
        { new: true, session }
      );
      if (!reservedTask) {
        const error = new Error('ظرفیت task تکمیل شده است.');
        error.code = 'TASK_FULL';
        throw error;
      }

      const approved = await TaskCompletion.findOneAndUpdate(
        { _id: submission._id, status: 'pending' },
        { $set: { status: 'approved', reviewedAt, reviewedBy: req.adminActor } },
        { new: true, session }
      );
      if (!approved) {
        const error = new Error('این submission هم‌زمان توسط ادمین دیگری بررسی شد.');
        error.code = 'SUBMISSION_NOT_PENDING';
        throw error;
      }

      if (reservedTask.maxCompletions != null && reservedTask.completedCount >= reservedTask.maxCompletions) {
        await Task.updateOne({ _id: reservedTask._id }, { $set: { isActive: false } }, { session });
      }

      const user = await User.findByIdAndUpdate(
        submission.user,
        { $inc: { points: reward } },
        { new: true, session }
      );
      if (!user) {
        const error = new Error('کاربر submission پیدا نشد.');
        error.code = 'SUBMISSION_USER_NOT_FOUND';
        throw error;
      }

      const ledger = await recordLedgerRequired({
        user: user._id,
        type: 'task',
        amount: reward,
        description: `Task Reward — ${task.title}`,
        balanceAfter: user.points,
        sourceId,
        session
      });
      if (!ledger.created) {
        const error = new Error('پاداش task قبلاً ثبت شده است؛ پرداخت دوباره انجام نشد.');
        error.code = 'TASK_REWARD_ALREADY_PAID';
        throw error;
      }

      const revenueUsd = reservedTask.isSponsored ? Number(reservedTask.sponsorPriceUsd) || 0 : 0;
      const costUsd = rewardCostUsd(reward, settings.rate, settings.gramUsdPrice);
      await TaskCompletion.updateOne(
        { _id: approved._id, status: 'approved' },
        { $set: { revenueUsd, costUsd } },
        { session }
      );
      return { reward, points: user.points, taskTitle: task.title, userId: user._id };
    });

    res.json({ success: true, status: 'approved', reward: payment.reward, points: payment.points });
    recordAdminLog({
      actor: req.adminActor,
      action: 'task_submission_approve',
      targetType: 'task_completion',
      targetId: req.params.id,
      details: `«${payment.taskTitle}» — پاداش ${payment.reward} پوینت به کاربر ${payment.userId} پرداخت شد`
    });
  } catch (error) {
    const status = error.code === 'SUBMISSION_NOT_FOUND' || error.code === 'TASK_NOT_FOUND' || error.code === 'SUBMISSION_USER_NOT_FOUND'
      ? 404
      : ['SUBMISSION_NOT_PENDING', 'TASK_FULL', 'TASK_REWARD_ALREADY_PAID'].includes(error.code)
        ? 409
        : error.code === 'INVALID_REWARD' || error.code === 'SUBMISSION_IMAGE_MISSING'
          ? 400
          : 500;
    if (status === 500) console.error('Screenshot task approval failed:', error);
    return res.status(status).json({ success: false, message: error.message || 'تأیید submission انجام نشد.', code: error.code || 'SERVER_ERROR' });
  }
});

router.post('/task-submissions/:id/reject', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ success: false, message: 'Submission پیدا نشد.' });
  }
  const note = String(req.body?.note || '').trim().slice(0, 500);
  const submission = await TaskCompletion.findOneAndUpdate(
    { _id: req.params.id, status: 'pending', proofMimeType: { $in: ['image/jpeg', 'image/png', 'image/webp'] } },
    { $set: { status: 'rejected', adminNote: note, reviewedAt: new Date(), reviewedBy: req.adminActor } },
    { new: true }
  );
  if (!submission) {
    const exists = await TaskCompletion.exists({ _id: req.params.id });
    return res.status(exists ? 409 : 404).json({
      success: false,
      message: exists ? 'این submission دیگر در انتظار بررسی نیست.' : 'Submission پیدا نشد.',
      code: exists ? 'SUBMISSION_NOT_PENDING' : 'SUBMISSION_NOT_FOUND'
    });
  }
  res.json({ success: true, status: 'rejected' });
  recordAdminLog({
    actor: req.adminActor,
    action: 'task_submission_reject',
    targetType: 'task_completion',
    targetId: submission._id,
    details: note || 'Screenshot task submission رد شد.'
  });
});

/* -------------------- WITHDRAWALS -------------------- */
/* -------------------- WEEKLY LEADERBOARD AWARDS -------------------- */
router.get('/weekly-leaderboard', async (req, res) => {
  const requestedKey = String(req.query.weekKey || '').trim();
  const currentKey = weekKey();
  const selectedKey = requestedKey || currentKey;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedKey)) {
    return res.status(400).json({ success: false, message: 'weekKey باید به شکل YYYY-MM-DD باشد.' });
  }
  const start = new Date(`${selectedKey}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) return res.status(400).json({ success: false, message: 'هفته نامعتبر است.' });
  const end = new Date(start.getTime() + 7 * 86400000);
  const positiveTypes = ['task', 'checkin', 'spin', 'referral_bonus'];
  const settings = await Settings.getGlobal();
  const standings = await PointsLedger.aggregate([
    { $match: { createdAt: { $gte: start, $lt: end }, currency: 'points', amount: { $gt: 0 }, type: { $in: positiveTypes } } },
    { $group: { _id: '$user', points: { $sum: '$amount' } } },
    { $sort: { points: -1, _id: 1 } },
    { $limit: 50 },
    { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
    { $unwind: '$user' },
    { $match: { 'user.isBanned': false } }
  ]);
  const awards = await WeeklyLeaderboardAward.find({ weekKey: selectedKey }).populate('user', 'firstName username telegramId').sort({ rank: 1 }).lean();
  res.json({ success: true, weekKey: selectedKey, weekStart: start, weekEnd: end, isCurrentWeek: selectedKey === currentKey, prizes: settings.weeklyLeaderboardPrizes || [], standings: standings.map((row, index) => ({ rank: index + 1, points: row.points, user: row.user })), awards });
});

router.post('/weekly-leaderboard/:selectedWeekKey/pay', async (req, res) => {
  const selectedKey = String(req.params.selectedWeekKey || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedKey)) return res.status(400).json({ success: false, message: 'weekKey نامعتبر است.' });
  const start = new Date(`${selectedKey}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 7 * 86400000);
  if (Number.isNaN(start.getTime())) return res.status(400).json({ success: false, message: 'هفته نامعتبر است.' });
  const forceRequested = req.body?.force === true;
  if (forceRequested && !isTestEnvironment()) {
    return res.status(403).json({ success: false, code: 'FORCE_SETTLEMENT_DISABLED', message: 'force settlement فقط در محیط تست مجاز است.' });
  }
  if (end > new Date() && !forceRequested) return res.status(409).json({ success: false, message: 'پرداخت جایزه تا پایان هفته امکان‌پذیر نیست؛ force فقط در محیط تست مجاز است.' });

  const settings = await Settings.getGlobal();
  const prizes = (settings.weeklyLeaderboardPrizes || []).map(Number);
  const positiveTypes = ['task', 'checkin', 'spin', 'referral_bonus'];
  const standings = await PointsLedger.aggregate([
    { $match: { createdAt: { $gte: start, $lt: end }, currency: 'points', amount: { $gt: 0 }, type: { $in: positiveTypes } } },
    { $group: { _id: '$user', points: { $sum: '$amount' } } },
    { $sort: { points: -1, _id: 1 } },
    { $limit: prizes.length },
    { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
    { $unwind: '$user' },
    { $match: { 'user.isBanned': false } }
  ]);

  const results = [];
  for (let index = 0; index < standings.length; index += 1) {
    const rank = index + 1;
    const points = Math.floor(Number(prizes[index]) || 0);
    if (points <= 0) continue;
    const row = standings[index];
    try {
      const payment = await withMongoTransaction(async session => {
        const award = await WeeklyLeaderboardAward.findOneAndUpdate(
          { weekKey: selectedKey, rank },
          { $setOnInsert: { user: row._id, points, status: 'pending' } },
          { upsert: true, new: true, setDefaultsOnInsert: true, session }
        );
        if (award.status === 'paid') return { status: 'already_paid', user: award.user };

        const claimed = await WeeklyLeaderboardAward.findOneAndUpdate(
          { _id: award._id, status: { $in: ['pending', 'failed'] } },
          { $set: { status: 'processing', error: '' } },
          { new: true, session }
        );
        if (!claimed) return { status: award.status, user: award.user };

        const sourceId = `weekly-leaderboard:${selectedKey}:${rank}`;
        const existingLedger = await PointsLedger.findOne({ sourceId }).session(session);
        let updatedUser;
        if (existingLedger) {
          // مهاجرت امن Awardهایی که قبل از این اصلاح، User را افزایش داده
          // اما در retry دوباره وارد مسیر پرداخت شده‌اند.
          updatedUser = await User.findById(row._id).session(session);
          if (!updatedUser) throw new Error('کاربر برنده پیدا نشد.');
        } else {
          updatedUser = await User.findOneAndUpdate(
            { _id: row._id, isBanned: false },
            { $inc: { points } },
            { new: true, session }
          );
          if (!updatedUser) throw new Error('کاربر برنده پیدا نشد.');
          await recordLedgerRequired({
            user: updatedUser._id,
            type: 'leaderboard_reward',
            amount: points,
            description: `جایزه رتبه ${rank} leaderboard هفته ${selectedKey}`,
            balanceAfter: updatedUser.points,
            sourceId,
            session
          });
        }
        await WeeklyLeaderboardAward.updateOne(
          { _id: claimed._id, status: 'processing' },
          { $set: { status: 'paid', paidAt: new Date(), error: '' } },
          { session }
        );
        return { status: 'paid', user: updatedUser._id, points };
      });

      if (payment.status === 'already_paid') {
        results.push({ rank, status: 'already_paid', points });
        continue;
      }
      if (payment.status !== 'paid') {
        results.push({ rank, status: payment.status, points });
        continue;
      }
      if (row.user.telegramId) {
        sendNotificationOnce({
          eventKey: `weekly-reward:${selectedKey}:${rank}`,
          type: 'weekly_reward',
          user: payment.user,
          telegramId: row.user.telegramId,
          text: botText('leaderboardReward', row.user.language, rank, payment.points)
        }).catch(error => console.error('Weekly reward notification failed:', error.message || error));
      }
      results.push({ rank, status: 'paid', points, user: payment.user });
    } catch (error) {
      await WeeklyLeaderboardAward.updateOne(
        { weekKey: selectedKey, rank, status: 'processing' },
        { $set: { status: 'failed', error: String(error.message || error).slice(0, 500) } }
      );
      results.push({ rank, status: 'failed', points, error: String(error.message || error) });
    }
  }
  recordAdminLog({ actor: req.adminActor, action: 'weekly_leaderboard_pay', targetType: 'settings', details: `هفته ${selectedKey}: ${results.map(item => `${item.rank}:${item.status}`).join(', ')}` });
  res.json({ success: true, weekKey: selectedKey, results });
});

// گزارش فقط‌خواندنی برای پیدا کردن اختلاف بین موجودی فعلی و جمع Ledger.
// این endpoint هیچ موجودی را تغییر نمی‌دهد و برای کنترل قبل از پرداخت/برداشت است.
router.get('/financial-audit', async (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
  const [users, sums] = await Promise.all([
    User.find({}).select('telegramId firstName username points gramBalance').limit(10000).lean(),
    PointsLedger.aggregate([
      { $group: { _id: { user: '$user', currency: '$currency' }, total: { $sum: '$amount' } } },
      { $group: { _id: '$_id.user', values: { $push: { currency: '$_id.currency', total: '$total' } } } }
    ])
  ]);
  const byUser = new Map(sums.map(row => [String(row._id), Object.fromEntries(row.values.map(item => [item.currency, item.total]))]));
  const discrepancies = users.map(user => buildDiscrepancy(user, byUser.get(String(user._id)) || {})).filter(isDiscrepant).slice(0, limit);
  res.json({ success: true, checkedUsers: users.length, discrepancyCount: discrepancies.length, discrepancies, generatedAt: new Date().toISOString() });
});

// خلاصه‌ی فقط‌خواندنی تعهدات مالی؛ هیچ موجودی یا رکوردی را تغییر نمی‌دهد.
// ذخیره‌ی واقعی فقط وقتی گزارش می‌شود که صراحتاً در تنظیمات پروژه ثبت شده باشد.
router.get('/liability-summary', async (req, res) => {
  const [userBalances, ledgerTotals, withdrawalTotals, depositTotals] = await Promise.all([
    User.aggregate([{ $group: {
      _id: null,
      users: { $sum: 1 },
      currentPoints: { $sum: { $ifNull: ['$points', 0] } },
      currentGram: { $sum: { $ifNull: ['$gramBalance', 0] } }
    } }]),
    PointsLedger.aggregate([{ $group: {
      _id: { currency: '$currency', direction: { $cond: [{ $gt: ['$amount', 0] }, 'positive', 'negative'] } },
      absoluteTotal: { $sum: { $abs: '$amount' } },
      transactions: { $sum: 1 }
    } }]),
    Withdrawal.aggregate([{ $group: {
      _id: '$status',
      amount: { $sum: { $ifNull: ['$cryptoAmount', 0] } },
      count: { $sum: 1 }
    } }]),
    Deposit.aggregate([{ $group: {
      _id: '$status',
      amount: { $sum: { $ifNull: ['$amount', 0] } },
      count: { $sum: 1 }
    } }])
  ]);
  const balances = userBalances[0] || {};
  const ledger = {};
  for (const row of ledgerTotals) {
    const currency = String(row._id?.currency || 'unknown');
    const direction = String(row._id?.direction || 'unknown');
    if (!ledger[currency]) ledger[currency] = { positive: 0, negative: 0, transactions: 0 };
    ledger[currency][direction] = Number(row.absoluteTotal) || 0;
    ledger[currency].transactions += Number(row.transactions) || 0;
  }
  const withdrawals = Object.fromEntries(withdrawalTotals.map(row => [row._id, { amount: Number(row.amount) || 0, count: Number(row.count) || 0 }]));
  const deposits = Object.fromEntries(depositTotals.map(row => [row._id, { amount: Number(row.amount) || 0, count: Number(row.count) || 0 }]));
  res.json({
    success: true,
    generatedAt: new Date().toISOString(),
    users: Number(balances.users) || 0,
    points: {
      currentUserLiability: Number(balances.currentPoints) || 0,
      ledgerPositive: Number(ledger.points?.positive) || 0,
      ledgerNegative: Number(ledger.points?.negative) || 0,
      ledgerTransactions: Number(ledger.points?.transactions) || 0
    },
    gram: {
      currentUserLiability: Number(balances.currentGram) || 0,
      ledgerPositive: Number(ledger.gram?.positive) || 0,
      ledgerNegative: Number(ledger.gram?.negative) || 0,
      ledgerTransactions: Number(ledger.gram?.transactions) || 0
    },
    withdrawals,
    deposits,
    reserve: {
      configured: false,
      amount: null,
      currency: 'GRAM',
      note: 'ذخیره واقعی در تنظیمات پروژه ثبت نشده است؛ برای جلوگیری از گزارش ساختگی نمایش داده نمی‌شود.'
    }
  });
});

function publicAdminDeposit(deposit) {
  const row = deposit.toObject ? deposit.toObject() : deposit;
  return {
    _id: String(row._id),
    reference: row.reference,
    status: row.status,
    network: row.network,
    token: row.token,
    requestedAmount: row.requestedAmount,
    amount: row.amount,
    txHash: row.txHash || row.submittedTxHash || '',
    sourceAddress: row.sourceAddress || row.walletAddressSnapshot || '',
    depositAddress: row.depositAddressSnapshot,
    verificationNote: row.verificationNote || '',
    createdAt: row.createdAt,
    verifiedAt: row.verifiedAt,
    creditedAt: row.creditedAt,
    user: row.user && typeof row.user === 'object' ? {
      _id: row.user._id,
      telegramId: row.user.telegramId || '',
      username: row.user.username || '',
      firstName: row.user.firstName || ''
    } : { _id: row.user }
  };
}

// Deposit operations are deliberately separate from the read-only liability summary.
router.get('/deposits', async (req, res) => {
  const status = String(req.query.status || '').trim();
  if (status && !['pending', 'confirmed', 'rejected'].includes(status)) {
    return res.status(400).json({ success: false, message: 'وضعیت Deposit نامعتبر است.' });
  }
  const filter = { assetType: 'native_gram', ...(status ? { status } : {}) };
  const { page, limit, skip } = pageParams(req.query, 100, 300);
  const [list, total, totals] = await Promise.all([
    Deposit.find(filter).populate('user', 'telegramId username firstName').sort({ createdAt: -1 }).skip(skip).limit(limit),
    Deposit.countDocuments(filter),
    Deposit.aggregate([
      { $match: { assetType: 'native_gram' } },
      { $group: { _id: '$status', amount: { $sum: { $ifNull: ['$amount', 0] } }, count: { $sum: 1 } } }
    ])
  ]);
  const byStatus = Object.fromEntries(totals.map(row => [row._id, { amount: Number(row.amount) || 0, count: Number(row.count) || 0 }]));
  res.json({
    success: true,
    deposits: list.map(publicAdminDeposit),
    summary: {
      pending: byStatus.pending || { amount: 0, count: 0 },
      confirmed: byStatus.confirmed || { amount: 0, count: 0 },
      rejected: byStatus.rejected || { amount: 0, count: 0 },
      totalConfirmedAmount: Number(byStatus.confirmed?.amount) || 0,
      totalConfirmedCount: Number(byStatus.confirmed?.count) || 0
    },
    pagination: { page, limit, total, pages: Math.ceil(total / limit) }
  });
});

router.post('/deposits/:id/approve', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, message: 'Deposit پیدا نشد.' });
  const deposit = await Deposit.findOne({ _id: req.params.id, assetType: 'native_gram' });
  if (!deposit) return res.status(404).json({ success: false, message: 'Deposit پیدا نشد.' });
  if (deposit.status !== 'pending') return res.status(409).json({ success: false, code: 'DEPOSIT_NOT_PENDING', message: 'این Deposit دیگر در انتظار تأیید نیست.' });
  const submittedHash = normalizeTonTxHash(req.body?.txHash);
  let verification;
  try {
    verification = submittedHash
      ? await verifyNativeGramTransfer({ txHash: submittedHash, depositAddress: deposit.depositAddressSnapshot, reference: deposit.reference })
      : await findIncomingNativeGramTransferByReference({ depositAddress: deposit.depositAddressSnapshot, reference: deposit.reference });
  } catch {
    return res.status(503).json({ success: false, code: 'TON_PROVIDER_UNAVAILABLE', message: 'بررسی TON Center فعلاً در دسترس نیست؛ موجودی تغییر نکرد.' });
  }
  if (verification.status !== 'verified') {
    return res.status(400).json({ success: false, code: verification.code || 'DEPOSIT_NOT_VERIFIED', message: 'تراکنش واقعی و نهایی برای این Reference پیدا نشد؛ Deposit تأیید نشد.' });
  }
  const minimumRaw = amountToNanoGram(deposit.minimumDepositSnapshot);
  if (minimumRaw == null || BigInt(verification.amountRaw) < minimumRaw) {
    return res.status(400).json({ success: false, code: 'DEPOSIT_BELOW_MINIMUM', message: 'مبلغ تراکنش از حداقل Deposit کمتر است.' });
  }
  if (deposit.walletAddressSnapshot && normalizeTonAddress(deposit.walletAddressSnapshot) !== verification.sourceAddress) {
    return res.status(400).json({ success: false, code: 'DEPOSIT_SOURCE_WALLET_MISMATCH', message: 'Wallet مبدأ با Wallet ثبت‌شده کاربر مطابقت ندارد.' });
  }
  if (deposit.requestedAmountRaw && BigInt(deposit.requestedAmountRaw) !== BigInt(verification.amountRaw)) {
    return res.status(400).json({ success: false, code: 'DEPOSIT_AMOUNT_MISMATCH', message: 'مبلغ تراکنش با مبلغ درخواست‌شده یکسان نیست.' });
  }
  try {
    const outcome = await creditVerifiedDeposit({ depositId: deposit._id, verification, submittedHash, actor: req.adminActor });
    return res.json({ success: true, alreadyConfirmed: Boolean(outcome.alreadyConfirmed), deposit: publicAdminDeposit(outcome.deposit) });
  } catch (error) {
    const status = ['DEPOSIT_ALREADY_PROCESSED', 'DEPOSIT_LEDGER_ALREADY_EXISTS'].includes(error.code) ? 409 : 500;
    if (status === 500) console.error('Admin deposit approval failed:', error);
    return res.status(status).json({ success: false, code: error.code || 'DEPOSIT_APPROVAL_FAILED', message: error.message || 'تأیید Deposit انجام نشد.' });
  }
});

router.post('/deposits/:id/reject', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, message: 'Deposit پیدا نشد.' });
  try {
    const rejected = await rejectPendingDeposit({ depositId: req.params.id, actor: req.adminActor, reason: req.body?.reason || req.body?.note });
    return res.json({ success: true, deposit: publicAdminDeposit(rejected) });
  } catch (error) {
    const status = error.code === 'DEPOSIT_REASON_REQUIRED' ? 400 : error.code === 'DEPOSIT_NOT_PENDING' ? 409 : 500;
    if (status === 500) console.error('Admin deposit rejection failed:', error);
    return res.status(status).json({ success: false, code: error.code || 'DEPOSIT_REJECTION_FAILED', message: error.message || 'لغو Deposit انجام نشد.' });
  }
});

router.get('/ops-metrics', (req, res) => {
  res.json({ success: true, metrics: metricsSnapshot(), node: process.version, environment: process.env.NODE_ENV || 'production', timestamp: new Date().toISOString() });
});

router.get('/withdrawals', async (req, res) => {
  const status = req.query.status;
  const filter = status ? { status } : {};
  const { page, limit, skip } = pageParams(req.query, 100, 300);
  const [list, total] = await Promise.all([
    Withdrawal.find(filter)
      .populate('user', 'firstName username telegramId')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Withdrawal.countDocuments(filter)
  ]);
  res.json({
    success: true,
    withdrawals: list.map(w => ({ ...w.toObject(), timeline: synthesizeHistory(w) })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) }
  });
});

/**
 * POST /api/admin/withdrawals/:id/approve
 * تأیید یک درخواست برداشت به‌شرط ورود Transaction Hash و بررسی موفق آن روی زنجیره.
 * body: { txHash, note?, forceManualConfirm? }
 * forceManualConfirm فقط وقتی لازم است که توکن Jetton باشد (مثل GRAM) — چون مبلغ/مقصد دقیق
 * داخل payload رمزنگاری‌شده است و سیستم نمی‌تواند به‌تنهایی آن را کامل تایید کند؛ در این حالت
 * ادمین باید جزئیات خام تراکنش (raw) را که در پاسخ خطا برگردانده می‌شود ببیند و صریحاً تایید کند.
 */
router.post('/withdrawals/:id/approve', async (req, res) => {
  const txHash = String((req.body && req.body.txHash) || '').trim();
  const txHashNormalized = normalizeTonTxHash(txHash);
  const forceManualConfirm = req.body?.forceManualConfirm === true;

  if (!txHash) {
    return res.status(400).json({ success: false, message: 'وارد کردن Transaction Hash الزامی است.' });
  }

  let withdrawal = await Withdrawal.findById(req.params.id);
  if (!withdrawal) return res.status(404).json({ success: false, message: 'رکورد پیدا نشد.' });
  if (!['pending', 'approved', 'processing'].includes(withdrawal.status)) {
    return res.status(400).json({ success: false, message: 'این درخواست قبلاً پردازش شده است.' });
  }

  // Early rejection; the unique index remains authoritative under concurrent approvals.
  const duplicate = await Withdrawal.findOne({
    _id: { $ne: withdrawal._id },
    $or: [{ txHashNormalized }, { txHash: legacyTonTxHashMatcher(txHash) }]
  }).select('_id');
  if (duplicate) {
    return res.status(409).json({ success: false, message: 'این TxID قبلاً برای برداشت دیگری ثبت شده است.', code: 'DUPLICATE_TX' });
  }

  const verification = await verifyTonTransaction({
    txHash,
    expectedAddress: withdrawal.address,
    expectedAmount: withdrawal.cryptoAmount,
    token: withdrawal.token
  });

  if (!verification.ok) {
    return res.status(400).json({
      success: false,
      message: `تایید تراکنش روی زنجیره ناموفق بود: ${verification.reason}`,
      code: 'VERIFICATION_FAILED'
    });
  }

  if (verification.requiresManualAmountCheck && !forceManualConfirm) {
    return res.status(409).json({
      success: false,
      message: verification.reason,
      code: 'MANUAL_CONFIRM_REQUIRED',
      raw: verification.raw
    });
  }

  // atomic: از هر سه حالت غیرپایانی (pending/approved/processing) می‌توان پرداخت را نهایی کرد
  // (جلوگیری از تایید/رد هم‌زمان با شرط status فعلی)
  let paid;
  try {
    paid = await withMongoTransaction(async session => {
      const now = new Date();
      const updated = await Withdrawal.findOneAndUpdate(
        { _id: withdrawal._id, status: { $in: ['pending', 'approved', 'processing'] } },
        {
          $set: {
            status: 'paid', txHash, txHashNormalized,
            verified: !verification.requiresManualAmountCheck,
            verificationNote: verification.reason, fromAddress: verification.fromAddress || '',
            paidAt: now, adminNote: (req.body && req.body.note) || withdrawal.adminNote
          },
          $push: { statusHistory: { status: 'paid', at: now, note: (req.body && req.body.note) || '' } }
        },
        { new: true, session }
      );
      if (updated) await recordAdminLogRequired({ actor: req.adminActor, action: 'withdrawal_approve', targetType: 'withdrawal', targetId: updated._id, details: `${updated.cryptoAmount} ${updated.token} — TxID: ${txHash}` }, session);
      return updated;
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, message: 'این TxID قبلاً برای برداشت دیگری ثبت شده است.', code: 'DUPLICATE_TX' });
    }
    throw error;
  }
  if (!paid) {
    return res.status(400).json({ success: false, message: 'این درخواست قبلاً پردازش شده است.' });
  }
  withdrawal = paid;

  res.json({ success: true, withdrawal });

  // اطلاع‌رسانی به خود کاربر که پرداختش انجام شد
  const payeeUser = await User.findById(withdrawal.user, 'telegramId language username firstName');
  postWithdrawalPaid(payeeUser, withdrawal)
    .catch(error => console.error('[withdrawal] payout paid notification failed:', error.message || error));
  if (payeeUser) {
    notifyUser(
      payeeUser.telegramId,
      botText('withdrawalApproved', payeeUser.language, withdrawal.cryptoAmount, withdrawal.token, withdrawal.txHash)
    ).catch(() => {});
  }
});

router.post('/withdrawals/:id/reject', async (req, res) => {
  // طبق مشخصات: رد کردن باید همیشه دلیل داشته باشد (سمت سرور چک می‌شود، نه فقط فرانت)
  const reason = String((req.body && req.body.note) || '').trim();
  if (!reason) {
    return res.status(400).json({ success: false, message: 'برای رد درخواست، وارد کردن دلیل الزامی است.' });
  }

  const existing = await Withdrawal.findById(req.params.id);
  if (!existing) return res.status(404).json({ success: false, message: 'رکورد پیدا نشد.' });

  let withdrawal;
  try {
    ({ withdrawal } = await transitionWithdrawalWithRefund({
      withdrawalId: existing._id,
      targetStatus: 'rejected',
      reason,
      expectedStatus: existing.status,
      allowedStatuses: ['pending', 'approved', 'processing'],
      audit: { actor: req.adminActor, action: 'withdrawal_reject', targetType: 'withdrawal', details: `دلیل: ${reason}` }
    }));
  } catch (error) {
    const status = error.code === 'WITHDRAWAL_NOT_FOUND' ? 404 : error.code === 'WITHDRAWAL_CONFLICT' ? 409 : 400;
    return res.status(status).json({ success: false, message: error.message || 'بازگشت وجه انجام نشد.' });
  }

  res.json({ success: true, withdrawal });

  // اطلاع‌رسانی رد شدن درخواست به کاربر (GRAM قبلاً در بالا برگردانده شده)
  const requesterUser = await User.findById(withdrawal.user, 'telegramId language');
  if (requesterUser) {
    notifyUser(
      requesterUser.telegramId,
      botText('withdrawalRejected', requesterUser.language, reason)
    ).catch(() => {});
  }
});

/**
 * POST /api/admin/withdrawals/:id/status — تغییر وضعیت «فقط نمایشی» (approved/processing/cancelled)
 * برخلاف approve/reject بالا، این مسیر پولی جابه‌جا نمی‌کند مگر برای cancelled (بازگشت GRAM،
 * دقیقاً مثل reject). برای پرداخت نهایی همچنان باید از /approve با txHash استفاده کرد.
 */
router.post('/withdrawals/:id/status', async (req, res) => {
  const targetStatus = String((req.body && req.body.status) || '');
  const reason = String((req.body && req.body.note) || '').trim();

  if (!['approved', 'processing', 'cancelled'].includes(targetStatus)) {
    return res.status(400).json({ success: false, message: 'وضعیت درخواستی نامعتبر است.' });
  }
  if (requiresReason(targetStatus) && !reason) {
    return res.status(400).json({ success: false, message: 'برای لغو درخواست، وارد کردن دلیل الزامی است.' });
  }

  const existing = await Withdrawal.findById(req.params.id);
  if (!existing) return res.status(404).json({ success: false, message: 'رکورد پیدا نشد.' });
  if (!canTransition(existing.status, targetStatus)) {
    return res.status(400).json({ success: false, message: `امکان تغییر وضعیت از «${existing.status}» به «${targetStatus}» وجود ندارد.` });
  }

  let withdrawal;
  if (shouldRefund(targetStatus)) {
    try {
      ({ withdrawal } = await transitionWithdrawalWithRefund({
        withdrawalId: existing._id,
        targetStatus,
        reason,
        expectedStatus: existing.status,
        allowedStatuses: [existing.status],
        audit: { actor: req.adminActor, action: `withdrawal_status_${targetStatus}`, targetType: 'withdrawal', details: reason ? `دلیل: ${reason}` : '' }
      }));
    } catch (error) {
      const status = error.code === 'WITHDRAWAL_NOT_FOUND' ? 404 : error.code === 'WITHDRAWAL_CONFLICT' ? 409 : 400;
      return res.status(status).json({ success: false, message: error.message || 'لغو و بازگشت وجه انجام نشد.' });
    }
  } else {
    // تغییر وضعیت غیرمالی همچنان با شرط وضعیت قبلی atomic است.
    withdrawal = await withMongoTransaction(async session => {
      const updated = await Withdrawal.findOneAndUpdate(
        { _id: existing._id, status: existing.status },
        { $set: { status: targetStatus }, $push: { statusHistory: { status: targetStatus, at: new Date(), note: reason } } },
        { new: true, session }
      );
      if (updated) await recordAdminLogRequired({ actor: req.adminActor, action: `withdrawal_status_${targetStatus}`, targetType: 'withdrawal', targetId: updated._id, details: reason ? `دلیل: ${reason}` : '' }, session);
      return updated;
    });
    if (!withdrawal) {
      return res.status(400).json({ success: false, message: 'وضعیت این درخواست هم‌زمان توسط جای دیگری تغییر کرده؛ صفحه را رفرش کنید.' });
    }
  }

  res.json({ success: true, withdrawal: { ...withdrawal.toObject(), timeline: synthesizeHistory(withdrawal) } });

  const amountLabel = `${withdrawal.cryptoAmount} ${withdrawal.token}`;
  const notifiedUser = await User.findById(withdrawal.user, 'telegramId language');
  if (notifiedUser) {
    const key = targetStatus === 'approved' ? 'withdrawalStatusApproved'
      : targetStatus === 'processing' ? 'withdrawalStatusProcessing'
      : 'withdrawalStatusCancelled';
    const args = targetStatus === 'cancelled' ? [amountLabel, reason] : [amountLabel];
    notifyUser(notifiedUser.telegramId, botText(key, notifiedUser.language, ...args)).catch(() => {});
  }
});

/* -------------------- USERS -------------------- */
/**
 * GET /api/admin/users?search=...&status=banned|active&sort=points|newest
 * جستجو روی نام/یوزرنیم/آیدی تلگرام، فیلتر روی وضعیت بن، مرتب‌سازی.
 */
router.get('/users', async (req, res) => {
  const { search, status, sort } = req.query;
  const filter = {};

  if (search) {
    const regex = new RegExp(escapeRegex(String(search).trim()), 'i');
    filter.$or = [{ firstName: regex }, { lastName: regex }, { username: regex }, { telegramId: regex }, { referralCode: regex }];
  }
  if (status === 'banned') filter.isBanned = true;
  if (status === 'active') filter.isBanned = false;

  const sortMap = { points: { points: -1 }, invited: { invitedCount: -1 }, newest: { createdAt: -1 }, oldest: { createdAt: 1 } };
  const sortBy = sortMap[sort] || sortMap.newest;

  const { page, limit, skip } = pageParams(req.query, 100, 300);
  const [users, total] = await Promise.all([
    User.find(filter).select('-__v -signupIpHash -referralRiskFlags -referralRiskScore').sort(sortBy).skip(skip).limit(limit).lean(),
    User.countDocuments(filter)
  ]);
  res.json({ success: true, users, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

function balanceField(currency) { return currency === 'gram' ? 'gramBalance' : 'points'; }
function referralTransactionSummary(user) {
  return {
    referralLevel: user.referralLevel || null,
    sourceUserId: user.sourceUserId || null,
    recipientUserId: user.recipientUserId || null,
    commissionRatePercent: user.commissionRatePercent ?? null,
    earningTransactionId: user.earningTransactionId || ''
  };
}

router.get('/users/:id/account', async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ success: false, message: 'شناسه کاربر نامعتبر است.' });
  const user = await User.findById(req.params.id).select('-__v -signupIpHash -referralRiskFlags').lean();
  if (!user) return res.status(404).json({ success: false, message: 'کاربر پیدا نشد.' });
  const [earned, gramTotal, withdrawals, referralCount, history, audits] = await Promise.all([
    PointsLedger.aggregate([{ $match: { user: user._id, currency: 'points', amount: { $gt: 0 }, type: { $nin: ['exchange_in', 'admin_adjust', 'vip_principal_return'] } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    PointsLedger.aggregate([{ $match: { user: user._id, currency: 'gram', amount: { $gt: 0 } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    Withdrawal.aggregate([{ $match: { user: user._id, status: 'paid' } }, { $group: { _id: null, total: { $sum: '$cryptoAmount' } } }]),
    User.countDocuments({ referredBy: user._id }),
    PointsLedger.find({ user: user._id }).sort({ createdAt: -1 }).limit(100).lean(),
    BalanceAudit.find({ userId: user._id }).sort({ createdAt: -1 }).limit(50).lean()
  ]);
  res.json({
    success: true,
    user,
    balances: {
      totalEarnedPoints: earned[0]?.total || 0,
      currentPoints: Number(user.points) || 0,
      totalGramCredited: gramTotal[0]?.total || 0,
      currentGram: Number(user.gramBalance) || 0,
      totalWithdrawnGram: withdrawals[0]?.total || 0,
      referralCount,
      activeReferralCount: Number(user.activeInvitedCount) || 0
    },
    transactions: history.map(entry => ({ ...entry, ...referralTransactionSummary(entry) })),
    balanceAudits: audits
  });
});

router.post('/users/:id/balance', async (req, res) => {
  const { currency, action, reason } = req.body || {};
  const actionId = String(req.body?.actionId || '').trim();
  const cleanReason = String(reason || '').trim();
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ success: false, message: 'شناسه کاربر نامعتبر است.' });
  if (!['points', 'gram'].includes(currency) || !['add', 'subtract', 'set', 'zero'].includes(action)) return res.status(400).json({ success: false, message: 'نوع موجودی یا عملیات نامعتبر است.' });
  if (actionId.length < 8 || actionId.length > 150) return res.status(400).json({ success: false, message: 'Action ID معتبر و یکتا لازم است.' });
  if (!cleanReason || cleanReason.length > 500) return res.status(400).json({ success: false, message: 'دلیل الزامی است و حداکثر ۵۰۰ نویسه می‌تواند باشد.' });
  if (action === 'zero' && req.body?.confirmText !== 'ZERO') return res.status(400).json({ success: false, message: 'برای صفرکردن موجودی، تأیید صریح لازم است.' });
  const amount = Number(req.body?.amount);
  if (action !== 'zero' && (!Number.isFinite(amount) || (['add', 'subtract'].includes(action) ? amount <= 0 : amount < 0) || (action === 'set' && amount === 0) || (currency === 'points' && !Number.isInteger(amount)))) return res.status(400).json({ success: false, message: 'مقدار واردشده نامعتبر است؛ صفرکردن فقط با عملیات zero و تایید جداگانه ممکن است.' });
  const roundedAmount = currency === 'gram' && action !== 'zero' ? Math.round(amount * 1e6) / 1e6 : amount;
  const outcome = await withMongoTransaction(async session => {
    const previousAction = await BalanceAudit.findOne({ actionId }).session(session);
    if (previousAction) return { duplicate: true, audit: previousAction };
    const user = await User.findById(req.params.id).session(session);
    if (!user) return { missing: true };
    const field = balanceField(currency);
    const before = Number(user[field]) || 0;
    const after = action === 'zero' ? 0 : action === 'set' ? roundedAmount : before + (action === 'subtract' ? -roundedAmount : roundedAmount);
    if (after < 0) return { insufficient: true };
    const change = after - before;
    const updated = await User.findByIdAndUpdate(user._id, { $set: { [field]: after } }, { new: true, session });
    const transactionId = `ADMIN-${crypto.createHash('sha256').update(actionId).digest('hex')}`;
    await recordLedgerRequired({
      user: updated._id,
      type: 'admin_adjust',
      currency,
      amount: change,
      description: `اصلاح موجودی توسط ادمین: ${cleanReason}`,
      balanceAfter: after,
      sourceId: `admin-balance:${actionId}`,
      transactionId,
      session
    });
    const audit = new BalanceAudit({
      actionId,
      adminId: String(req.adminId || 'legacy-admin-key'),
      actor: String(req.adminActor || 'ادمین'),
      userId: updated._id,
      action,
      currency,
      before,
      change,
      after,
      reason: cleanReason,
      transactionId
    });
    await audit.save({ session });
    await recordAdminLogRequired({ actor: req.adminActor, action: `balance_${action}`, targetType: 'user', targetId: updated._id, details: `${currency}; ${cleanReason}; actionId=${actionId}` }, session);
    return { updated, audit, duplicate: false };
  });
  if (outcome.missing) return res.status(404).json({ success: false, message: 'کاربر پیدا نشد.' });
  if (outcome.insufficient) return res.status(409).json({ success: false, message: 'کسر موجودی باعث منفی‌شدن موجودی می‌شود.' });
  res.json({ success: true, duplicate: outcome.duplicate, user: outcome.updated || null, audit: outcome.audit });
});

router.post('/users/bulk-balance', async (req, res) => {
  const { currency, action, reason } = req.body || {};
  const batchId = String(req.body?.actionId || '').trim();
  const cleanReason = String(reason || '').trim();
  const userIds = Array.isArray(req.body?.userIds) ? [...new Set(req.body.userIds.map(String))] : [];
  if (!['points', 'gram'].includes(currency) || !['add', 'zero'].includes(action)) return res.status(400).json({ success: false, message: 'عملیات گروهی فقط برای افزودن یا صفرکردن Points/GRAM است.' });
  if (batchId.length < 8 || batchId.length > 120) return res.status(400).json({ success: false, message: 'Batch Action ID معتبر و یکتا لازم است.' });
  if (!cleanReason || cleanReason.length > 500) return res.status(400).json({ success: false, message: 'دلیل الزامی است و حداکثر ۵۰۰ نویسه می‌تواند باشد.' });
  if (!userIds.length || userIds.length > 100 || userIds.some(id => !mongoose.Types.ObjectId.isValid(id))) return res.status(400).json({ success: false, message: '۱ تا ۱۰۰ شناسه کاربر معتبر انتخاب کنید.' });
  if (action === 'zero' && req.body?.confirmText !== 'ZERO') return res.status(400).json({ success: false, message: 'برای صفرکردن گروهی، تأیید صریح لازم است.' });
  const amount = Number(req.body?.amount);
  if (action === 'add' && (!Number.isFinite(amount) || amount <= 0 || (currency === 'points' && !Number.isInteger(amount)))) return res.status(400).json({ success: false, message: 'مقدار مثبت و معتبر لازم است.' });
  const value = currency === 'gram' && action === 'add' ? Math.round(amount * 1e6) / 1e6 : amount;
  const outcome = await withMongoTransaction(async session => {
    const results = [];
    for (const id of userIds) {
      const actionId = `${batchId}:${id}`;
      const existing = await BalanceAudit.findOne({ actionId }).session(session);
      if (existing) { results.push({ userId: id, duplicate: true }); continue; }
      const user = await User.findById(id).session(session);
      if (!user) throw new Error(`کاربر با شناسه ${id} پیدا نشد؛ کل عملیات لغو شد.`);
      const field = balanceField(currency);
      const before = Number(user[field]) || 0;
      const after = action === 'zero' ? 0 : before + value;
      const change = after - before;
      const updated = await User.findByIdAndUpdate(user._id, { $set: { [field]: after } }, { new: true, session });
      const transactionId = `ADMIN-${crypto.createHash('sha256').update(actionId).digest('hex')}`;
      await recordLedgerRequired({
        user: updated._id, type: 'admin_adjust', currency, amount: change,
        description: `اصلاح گروهی موجودی توسط ادمین: ${cleanReason}`,
        balanceAfter: after, sourceId: `admin-balance:${actionId}`, transactionId, session
      });
      const audit = new BalanceAudit({
        actionId, batchId, adminId: String(req.adminId || 'legacy-admin-key'), actor: String(req.adminActor || 'ادمین'),
        userId: updated._id, action, currency, before, change, after, reason: cleanReason, transactionId
      });
      await audit.save({ session });
      results.push({ userId: id, duplicate: false, before, change, after });
    }
    if (results.some(result => !result.duplicate)) {
      await recordAdminLogRequired({ actor: req.adminActor, action: `bulk_balance_${action}`, targetType: 'user_batch', targetId: batchId, details: `${userIds.length} users; ${currency}; ${cleanReason}` }, session);
    }
    return results;
  });
  res.json({ success: true, batchId, results: outcome });
});

router.post('/users/:id/review-status', async (req, res) => {
  const status = String(req.body?.status || '').trim();
  const actionId = String(req.body?.actionId || '').trim();
  const reason = String(req.body?.reason || '').trim();
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ success: false, message: 'شناسه کاربر نامعتبر است.' });
  if (!['normal', 'under_review', 'restricted', 'fraud_review'].includes(status)) return res.status(400).json({ success: false, message: 'وضعیت بررسی نامعتبر است.' });
  if (actionId.length < 8 || actionId.length > 150 || !reason || reason.length > 500) return res.status(400).json({ success: false, message: 'Action ID یکتا و دلیل حداکثر ۵۰۰ نویسه الزامی است.' });
  const outcome = await withMongoTransaction(async session => {
    const existing = await BalanceAudit.findOne({ actionId }).session(session);
    if (existing) return { duplicate: true, audit: existing };
    const user = await User.findById(req.params.id).session(session);
    if (!user) return { missing: true };
    const before = user.accountReviewStatus || 'normal';
    user.accountReviewStatus = status;
    await user.save({ session });
    const audit = new BalanceAudit({
      actionId, adminId: String(req.adminId || 'legacy-admin-key'), actor: String(req.adminActor || 'ادمین'),
      userId: user._id, action: 'account_status', currency: 'account', statusBefore: before, statusAfter: status, reason
    });
    await audit.save({ session });
    await recordAdminLogRequired({ actor: req.adminActor, action: 'user_review_status', targetType: 'user', targetId: user._id, details: `${before} -> ${status}; ${reason}` }, session);
    return { duplicate: false, user, audit };
  });
  if (outcome.missing) return res.status(404).json({ success: false, message: 'کاربر پیدا نشد.' });
  res.json({ success: true, duplicate: outcome.duplicate, user: outcome.user || null, audit: outcome.audit });
});

router.post('/users/:id/ban', async (req, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, { isBanned: true }, { new: true });
  res.json({ success: true, user });

  recordAdminLog({
    actor: req.adminActor,
    action: 'user_ban',
    targetType: 'user',
    targetId: req.params.id,
    details: user ? (user.firstName || user.username || user.telegramId) : ''
  });
});

router.post('/users/:id/unban', async (req, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, { isBanned: false }, { new: true });
  res.json({ success: true, user });

  recordAdminLog({
    actor: req.adminActor,
    action: 'user_unban',
    targetType: 'user',
    targetId: req.params.id,
    details: user ? (user.firstName || user.username || user.telegramId) : ''
  });
});

router.delete('/users/:id', async (req, res) => {
  if (!isTestDeleteEnvironment()) {
    return res.status(403).json({ success: false, code: 'TEST_ONLY', message: 'حذف User فقط در محیط TEST مجاز است.' });
  }
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, message: 'شناسه کاربر نامعتبر است.' });
  }

  const transactionStatus = getMongoTransactionStatus();
  if (!transactionStatus.checked || !transactionStatus.supported) {
    return res.status(503).json({
      success: false,
      code: 'TRANSACTIONS_UNAVAILABLE',
      message: 'حذف انجام نشد؛ MongoDB Transaction در محیط TEST در دسترس نیست.',
      reason: transactionStatus.reason || 'Transaction capability was not confirmed.'
    });
  }

  try {
    const outcome = await withMongoTransaction(async session => {
      const user = await User.findById(req.params.id).session(session);
      if (!user) return { missing: true };

      const dependentCount = await User.countDocuments({ referredBy: user._id }).session(session);
      if (dependentCount > 0) return { hasDependents: true, dependentCount };

      const referrer = user.referredBy
        ? await User.findById(user.referredBy).session(session)
        : null;

      await ReferralRelationship.deleteMany({
        $or: [{ referrerId: user._id }, { referredUserId: user._id }]
      }).session(session);
      await PointsLedger.deleteMany({
        $or: [
          { user: user._id },
          { sourceUserId: user._id },
          { recipientUserId: user._id }
        ]
      }).session(session);
      await TaskCompletion.deleteMany({ user: user._id }).session(session);
      await LatestPostEngagementState.deleteMany({ user: user._id }).session(session);
      await Withdrawal.deleteMany({ user: user._id }).session(session);
      await Deposit.deleteMany({ user: user._id }).session(session);
      await VipSubscription.deleteMany({ user: user._id }).session(session);
      await WeeklyLeaderboardAward.deleteMany({ user: user._id }).session(session);
      await NotificationDelivery.deleteMany({
        $or: [
          { user: user._id },
          { eventKey: `referral-initial:${user._id}` }
        ]
      }).session(session);
      await IdempotencyOperation.deleteMany({ userId: user._id }).session(session);
      await BalanceAudit.deleteMany({ userId: user._id }).session(session);
      await User.deleteOne({ _id: user._id }).session(session);

      if (referrer) {
        const remainingInvitedCount = await User.countDocuments({ referredBy: referrer._id }).session(session);
        const activeReferralIds = Array.isArray(referrer.activeReferralIds)
          ? referrer.activeReferralIds.filter(id => String(id) !== String(user._id))
          : [];
        await User.updateOne(
          { _id: referrer._id },
          {
            $set: {
              invitedCount: remainingInvitedCount,
              activeInvitedCount: activeReferralIds.length,
              activeReferralIds
            }
          },
          { session }
        );
      }

      return { deleted: true };
    });

    if (outcome.missing) return res.status(404).json({ success: false, message: 'کاربر پیدا نشد.' });
    if (outcome.hasDependents) {
      return res.status(409).json({
        success: false,
        code: 'REFERRAL_DEPENDENCIES_EXIST',
        message: `حذف انجام نشد؛ این User هنوز Referrer ${outcome.dependentCount} کاربر دیگر است.`
      });
    }
    return res.json({ success: true, message: 'User و داده‌های وابسته‌ی او از محیط TEST حذف شدند.' });
  } catch (error) {
    if (error?.code === 'TRANSACTIONS_UNAVAILABLE') {
      return res.status(503).json({ success: false, code: error.code, message: 'حذف انجام نشد؛ MongoDB Transaction در دسترس نیست.' });
    }
    throw error;
  }
});

router.post('/users/:id/test-weekly-reward-notification', async (req, res) => {
  if (!isTestEnvironment()) {
    return res.status(403).json({ success: false, code: 'TEST_ONLY', message: 'تست Notification فقط در محیط TEST مجاز است.' });
  }
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, message: 'شناسه کاربر نامعتبر است.' });
  }

  const rank = Number(req.body?.rank);
  const reward = Number(req.body?.reward);
  if (!Number.isInteger(rank) || rank < 1 || rank > 3) {
    return res.status(400).json({ success: false, message: 'مقام باید عدد صحیح بین ۱ تا ۳ باشد.' });
  }
  if (!Number.isSafeInteger(reward) || reward <= 0) {
    return res.status(400).json({ success: false, message: 'مقدار Reward باید یک عدد صحیح مثبت باشد.' });
  }

  const user = await User.findById(req.params.id).select('_id telegramId language').lean();
  if (!user) return res.status(404).json({ success: false, message: 'کاربر پیدا نشد.' });
  const telegramId = String(user.telegramId || '').trim();
  if (!/^\d{1,20}$/.test(telegramId)) {
    return res.status(422).json({ success: false, message: 'کاربر Telegram ID معتبر ندارد.' });
  }

  const delivery = await sendNotificationOnce({
    eventKey: `weekly-reward-test:${user._id}:${crypto.randomUUID()}`,
    type: 'weekly_reward',
    user: user._id,
    telegramId,
    text: botText('leaderboardReward', user.language, rank, reward)
  });
  if (delivery.status !== 'sent') {
    return res.status(502).json({ success: false, code: 'TELEGRAM_NOTIFICATION_FAILED', status: delivery.status, message: `ارسال پیام آزمایشی Telegram تأیید نشد (delivery: ${delivery.status}).` });
  }
  return res.json({ success: true, status: delivery.status, message: 'پیام آزمایشی Weekly Reward با موفقیت ارسال شد.' });
});

/* -------------------- REQUIRED CHANNELS (عضویت اجباری) -------------------- */
function publicChannel(c) {
  return {
    _id: c._id,
    name: c.name,
    username: c.username,
    chatId: c.chatId,
    url: c.url,
    isActive: c.isActive,
    lastCheckOk: c.lastCheckOk,
    lastCheckError: c.lastCheckError,
    lastCheckAt: c.lastCheckAt,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt
  };
}

const channelRefOf = v => v.chatId || `@${v.username}`;

router.get('/required-channels', async (req, res) => {
  const list = await RequiredChannel.find().sort({ sortOrder: 1, createdAt: 1 });
  res.json({ success: true, channels: list.map(publicChannel), max: MAX_REQUIRED_CHANNELS });
});

router.post('/required-channels', async (req, res) => {
  const { value, error } = normalizeChannelInput(req.body);
  if (error) return res.status(400).json({ success: false, message: error });

  if ((await RequiredChannel.countDocuments()) >= MAX_REQUIRED_CHANNELS) {
    return res.status(400).json({ success: false, message: `حداکثر ${MAX_REQUIRED_CHANNELS} کانال اجباری مجاز است.` });
  }

  const dupFilter = [];
  if (value.username) dupFilter.push({ username: new RegExp(`^${escapeRegex(value.username)}$`, 'i') });
  if (value.chatId) dupFilter.push({ chatId: value.chatId });
  if (dupFilter.length && (await RequiredChannel.findOne({ $or: dupFilter }))) {
    return res.status(400).json({ success: false, message: 'این کانال قبلاً ثبت شده است.' });
  }

  const check = await validateChannelRef(channelRefOf(value));
  if (check.chat && !value.chatId) value.chatId = check.chat.id; // آیدی عددی پایدارتر از یوزرنیم است
  if (!check.ok && !(req.body && req.body.force)) {
    return res.status(400).json({
      success: false,
      code: 'CHANNEL_VALIDATION_FAILED',
      message: check.reason
    });
  }

  const channel = await RequiredChannel.create({
    ...value,
    lastCheckOk: check.ok,
    lastCheckError: check.ok ? '' : String(check.reason || '').slice(0, 300),
    lastCheckAt: new Date()
  });
  membership.clearCache();

  res.json({ success: true, channel: publicChannel(channel), warning: check.ok ? '' : check.reason });

  recordAdminLog({
    actor: req.adminActor,
    action: 'required_channel_create',
    targetType: 'required_channel',
    targetId: channel._id,
    details: `«${channel.name}» ${channel.username ? '@' + channel.username : channel.chatId}`
  });
});

router.put('/required-channels/:id', async (req, res) => {
  const existing = await RequiredChannel.findById(req.params.id);
  if (!existing) return res.status(404).json({ success: false, message: 'کانال پیدا نشد.' });

  const body = req.body || {};
  const merged = {
    name: body.name !== undefined ? body.name : existing.name,
    username: body.username !== undefined ? body.username : existing.username,
    chatId: body.chatId !== undefined ? body.chatId : existing.chatId,
    url: body.url !== undefined ? body.url : existing.url,
    isActive: body.isActive !== undefined ? body.isActive : existing.isActive
  };
  const { value, error } = normalizeChannelInput(merged);
  if (error) return res.status(400).json({ success: false, message: error });

  const identityChanged = value.username.toLowerCase() !== (existing.username || '').toLowerCase() || value.chatId !== (existing.chatId || '');

  if (identityChanged) {
    const dupFilter = [];
    if (value.username) dupFilter.push({ username: new RegExp(`^${escapeRegex(value.username)}$`, 'i') });
    if (value.chatId) dupFilter.push({ chatId: value.chatId });
    if (dupFilter.length && (await RequiredChannel.findOne({ _id: { $ne: existing._id }, $or: dupFilter }))) {
      return res.status(400).json({ success: false, message: 'این کانال قبلاً ثبت شده است.' });
    }
  }

  let check = null;
  if (identityChanged) {
    check = await validateChannelRef(channelRefOf(value));
    if (check.chat && !value.chatId) value.chatId = check.chat.id;
    if (!check.ok && !body.force) {
      return res.status(400).json({ success: false, code: 'CHANNEL_VALIDATION_FAILED', message: check.reason });
    }
  }

  Object.assign(existing, value);
  if (check) {
    existing.lastCheckOk = check.ok;
    existing.lastCheckError = check.ok ? '' : String(check.reason || '').slice(0, 300);
    existing.lastCheckAt = new Date();
  }
  await existing.save();
  membership.clearCache();

  res.json({ success: true, channel: publicChannel(existing), warning: check && !check.ok ? check.reason : '' });

  recordAdminLog({
    actor: req.adminActor,
    action: 'required_channel_update',
    targetType: 'required_channel',
    targetId: existing._id,
    details: `«${existing.name}» ${existing.isActive ? 'فعال' : 'غیرفعال'}`
  });
});

router.delete('/required-channels/:id', async (req, res) => {
  const channel = await RequiredChannel.findByIdAndDelete(req.params.id);
  if (!channel) return res.status(404).json({ success: false, message: 'کانال پیدا نشد.' });
  membership.clearCache();
  res.json({ success: true });

  recordAdminLog({
    actor: req.adminActor,
    action: 'required_channel_delete',
    targetType: 'required_channel',
    targetId: channel._id,
    details: `«${channel.name}» حذف شد`
  });
});

// تست اتصال: آیا کانال معتبر است و ربات در آن ادمین است؟
router.post('/required-channels/:id/test', async (req, res) => {
  const channel = await RequiredChannel.findById(req.params.id);
  if (!channel) return res.status(404).json({ success: false, message: 'کانال پیدا نشد.' });

  const check = await validateChannelRef(channelRefOf(channel));
  await RequiredChannel.updateOne(
    { _id: channel._id },
    {
      $set: {
        lastCheckOk: check.ok,
        lastCheckError: check.ok ? '' : String(check.reason || '').slice(0, 300),
        lastCheckAt: new Date()
      }
    },
    { timestamps: false }
  );

  res.json({
    success: true,
    ok: check.ok,
    message: check.ok
      ? `✅ اتصال سالم است — «${(check.chat && check.chat.title) || channel.name}». ربات ادمین است و عضویت کاربران را می‌تواند بررسی کند.`
      : `❌ ${check.reason}`
  });
});

/* -------------------- SETTINGS -------------------- */
router.get('/vip/summary', async (req, res) => {
  const now = new Date();
  const activeExpression = { $and: [{ $eq: ['$status', 'active'] }, { $gt: ['$endAt', now] }] };
  const expiredExpression = { $or: [
    { $eq: ['$status', 'completed'] },
    { $and: [{ $eq: ['$status', 'active'] }, { $lte: ['$endAt', now] }] }
  ] };
  const [rows, uniqueUsers] = await Promise.all([
    VipSubscription.aggregate([{ $group: {
      _id: null,
      totalVipPurchases: { $sum: 1 },
      activeVips: { $sum: { $cond: [activeExpression, 1, 0] } },
      expiredVips: { $sum: { $cond: [expiredExpression, 1, 0] } },
      cancelledVips: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
      totalVipRevenuePoints: { $sum: { $ifNull: ['$pricePoints', 0] } },
      totalDailyVipEarningsPoints: { $sum: { $cond: [activeExpression, { $ifNull: ['$dailyRewardAveragePoints', 0] }, 0] } }
    } }]),
    VipSubscription.distinct('user', { user: { $type: 'objectId' } })
  ]);
  const summary = rows[0] || {};
  return res.json({
    success: true,
    asOf: now.toISOString(),
    totalVipPurchases: Number(summary.totalVipPurchases) || 0,
    activeVips: Number(summary.activeVips) || 0,
    expiredVips: Number(summary.expiredVips) || 0,
    cancelledVips: Number(summary.cancelledVips) || 0,
    totalVipRevenuePoints: Number(summary.totalVipRevenuePoints) || 0,
    totalDailyVipEarningsPoints: Number(summary.totalDailyVipEarningsPoints) || 0,
    totalVipUsers: uniqueUsers.length
  });
});

router.get('/vip/subscriptions', async (req, res) => {
  const { page, limit, skip } = pageParams(req.query, 25, 100);
  const now = new Date();
  const match = {};

  if (req.query.planNumber != null && String(req.query.planNumber).trim()) {
    const planNumber = Number(req.query.planNumber);
    if (!Number.isInteger(planNumber) || planNumber < 1 || planNumber > 10) {
      return res.status(400).json({ success: false, code: 'VIP_FILTER_INVALID', message: 'پلن VIP نامعتبر است.' });
    }
    match.planNumber = planNumber;
  }

  const requestedStatus = String(req.query.status || '').trim().toLowerCase();
  if (requestedStatus && !['active', 'expired', 'cancelled'].includes(requestedStatus)) {
    return res.status(400).json({ success: false, code: 'VIP_FILTER_INVALID', message: 'وضعیت VIP نامعتبر است.' });
  }
  if (requestedStatus) match.adminDisplayStatus = requestedStatus;

  const dateFilter = {};
  const dateFrom = String(req.query.dateFrom || '').trim();
  const dateTo = String(req.query.dateTo || '').trim();
  const parseDate = (value, endOfDay = false) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
    return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
  };
  if (dateFrom) {
    const parsed = parseDate(dateFrom);
    if (!parsed) return res.status(400).json({ success: false, code: 'VIP_FILTER_INVALID', message: 'تاریخ شروع نامعتبر است.' });
    dateFilter.$gte = parsed;
  }
  if (dateTo) {
    const parsed = parseDate(dateTo, true);
    if (!parsed) return res.status(400).json({ success: false, code: 'VIP_FILTER_INVALID', message: 'تاریخ پایان نامعتبر است.' });
    dateFilter.$lte = parsed;
  }
  if (dateFilter.$gte && dateFilter.$lte && dateFilter.$gte > dateFilter.$lte) {
    return res.status(400).json({ success: false, code: 'VIP_FILTER_INVALID', message: 'محدوده تاریخ نامعتبر است.' });
  }
  if (Object.keys(dateFilter).length) match.createdAt = dateFilter;

  const search = String(req.query.search || '').trim().slice(0, 100);
  const pipeline = [
    { $lookup: { from: User.collection.name, localField: 'user', foreignField: '_id', as: 'vipUser' } },
    { $unwind: { path: '$vipUser', preserveNullAndEmptyArrays: true } },
    { $addFields: { adminDisplayStatus: { $switch: { branches: [
      { case: { $eq: ['$status', 'cancelled'] }, then: 'cancelled' },
      { case: { $eq: ['$status', 'completed'] }, then: 'expired' },
      { case: { $and: [{ $eq: ['$status', 'active'] }, { $lte: ['$endAt', now] }] }, then: 'expired' },
      { case: { $and: [{ $eq: ['$status', 'active'] }, { $gt: ['$endAt', now] }] }, then: 'active' }
    ], default: 'unknown' } } } },
    { $match: {
      ...match,
      ...(search ? { $or: [
        { 'vipUser.telegramId': new RegExp(escapeRegex(search), 'i') },
        { 'vipUser.username': new RegExp(escapeRegex(search), 'i') },
        { 'vipUser.firstName': new RegExp(escapeRegex(search), 'i') },
        { 'vipUser.lastName': new RegExp(escapeRegex(search), 'i') },
        ...(mongoose.isValidObjectId(search) ? [{ 'vipUser._id': new mongoose.Types.ObjectId(search) }] : [])
      ] } : {})
    } },
    { $facet: {
      items: [
        { $sort: { createdAt: -1, _id: -1 } },
        { $skip: skip },
        { $limit: limit },
        { $project: {
          _id: 1,
          user: { _id: '$vipUser._id', telegramId: '$vipUser.telegramId', username: '$vipUser.username', firstName: '$vipUser.firstName', lastName: '$vipUser.lastName' },
          planNumber: 1,
          pricePoints: 1,
          monthlyRewardPercent: 1,
          durationDays: 1,
          totalRewardPoints: 1,
          dailyRewardAveragePoints: 1,
          claimedRewardPoints: 1,
          claimsCompleted: 1,
          startAt: 1,
          endAt: 1,
          createdAt: 1,
          status: 1,
          displayStatus: '$adminDisplayStatus'
        } }
      ],
      metadata: [{ $count: 'total' }]
    } }
  ];

  const [result] = await VipSubscription.aggregate(pipeline);
  const total = Number(result?.metadata?.[0]?.total) || 0;
  const subscriptions = (result?.items || []).map(item => toVipAdminRecord(item, now));
  return res.json({ success: true, subscriptions, page, limit, total, totalPages: Math.ceil(total / limit), asOf: now.toISOString() });
});

router.get('/vip/subscriptions/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ success: false, code: 'VIP_SUBSCRIPTION_INVALID', message: 'شناسه اشتراک VIP نامعتبر است.' });
  }
  const subscription = await VipSubscription.findById(req.params.id)
    .populate('user', 'telegramId username firstName lastName')
    .lean();
  if (!subscription) return res.status(404).json({ success: false, code: 'VIP_SUBSCRIPTION_NOT_FOUND', message: 'اشتراک VIP پیدا نشد.' });
  return res.json({ success: true, subscription: toVipAdminRecord(subscription) });
});

router.get('/vip/plans', async (req, res) => {
  const [plans, settings] = await Promise.all([
    VipPlan.find({}).sort({ planNumber: 1 }).lean(),
    Settings.getGlobal()
  ]);
  const rate = Number(settings.rate);
  res.json({
    success: true,
    rate,
    plans: plans.map(plan => ({
      ...plan,
      pricing: pricingForVipPlan(plan.planNumber, rate),
      priceMatchesPolicy: Number(plan.pricePoints) === pricePointsForVipPlan(plan.planNumber, rate)
    }))
  });
});

router.put('/vip/plans', async (req, res) => {
  const input = req.body && req.body.plans;
  if (!Array.isArray(input) || input.length !== 10) {
    return res.status(400).json({ success: false, code: 'VIP_CATALOG_INVALID', message: 'باید تنظیمات هر ۱۰ پلن VIP ارسال شود.' });
  }

  const seen = new Set();
  const plans = [];
  const settings = await Settings.getGlobal();
  const rate = Number(settings.rate);
  for (const item of input) {
    const planNumber = Number(item?.planNumber);
    const expectedPricePoints = pricePointsForVipPlan(planNumber, rate);
    const submittedPricePoints = Number(item?.pricePoints);
    const pricePoints = expectedPricePoints;
    const monthlyRewardPercent = Number(item?.monthlyRewardPercent);
    const durationDays = Number(item?.durationDays);
    const enabled = item?.enabled === true;
    const comingSoon = item?.comingSoon === true;
    if (!Number.isInteger(planNumber) || planNumber < 1 || planNumber > 10 || seen.has(planNumber)
      || !Number.isInteger(pricePoints) || pricePoints < 0 || pricePoints > 100000000
      || submittedPricePoints !== expectedPricePoints
      || !Number.isFinite(monthlyRewardPercent) || monthlyRewardPercent < 0 || monthlyRewardPercent > 100
      || !Number.isInteger(durationDays) || durationDays < 1 || durationDays > 3650
      || durationDays !== 100
      || (enabled && comingSoon)
      || (enabled && (pricePoints < 1 || monthlyRewardPercent <= 0))) {
      const pricing = pricingForVipPlan(planNumber, rate);
      const message = submittedPricePoints !== expectedPricePoints
        ? `قیمت پلن ${planNumber || '?'} باید ${expectedPricePoints || 0} Points معادل ${pricing?.grams || '?'} GRAM باشد.`
        : `مقادیر پلن شماره ${planNumber || '?'} معتبر نیست؛ پلن‌های سیاست جدید باید ۱۰۰ روزه باشند.`;
      return res.status(400).json({ success: false, code: 'VIP_PLAN_INVALID', message, expectedPricePoints, expectedGrams: pricing?.grams || null, rate });
    }
    if (enabled) {
      const totalRewardCents = calculateTotalRewardCents(pricePoints, monthlyRewardPercent, durationDays);
      if (totalRewardCents == null || totalRewardCents < durationDays) {
        return res.status(400).json({ success: false, code: 'VIP_REWARD_TOO_SMALL', message: `پاداش پلن ${planNumber} باید حداقل ۰٫۰۱ پوینت برای هر دریافت روزانه داشته باشد.` });
      }
    }
    seen.add(planNumber);
    plans.push({ planNumber, pricePoints, monthlyRewardPercent, durationDays, enabled, comingSoon });
  }

  await VipPlan.bulkWrite(plans.map(plan => ({
    updateOne: {
      filter: { planNumber: plan.planNumber },
      update: { $set: plan },
      upsert: true
    }
  })), { ordered: true });
  const savedPlans = await VipPlan.find({}).sort({ planNumber: 1 }).lean();
  res.json({
    success: true,
    rate,
    plans: savedPlans.map(plan => ({ ...plan, pricing: pricingForVipPlan(plan.planNumber, rate), priceMatchesPolicy: true }))
  });
  recordAdminLog({
    actor: req.adminActor,
    action: 'vip_plan_catalog_update',
    targetType: 'vip_plan_catalog',
    details: plans.map(plan => `${plan.planNumber}:${plan.enabled ? 'active' : plan.comingSoon ? 'soon' : 'off'}`).join(', ')
  });
});

router.get('/vip/reserve', async (req, res) => {
  const reserve = await VipReserve.findOne({ key: 'global' }).lean();
  return res.json({ success: true, reserve: vipReserveSnapshot(reserve) || {
    availablePoints: 0, reservedPoints: 0, paidPoints: 0, fundedPoints: 0, updatedAt: null
  } });
});

router.post('/vip/reserve/fund', async (req, res) => {
  const amountPoints = Number(req.body?.amountPoints);
  const reason = String(req.body?.reason || '').trim();
  const amountCents = vipReserveToCents(amountPoints);
  if (!amountCents || amountPoints > 1000000000 || reason.length < 5 || reason.length > 500) {
    return res.status(400).json({ success: false, code: 'VIP_RESERVE_FUND_INVALID', message: 'مقدار Reserve مثبت و Reason حداقل ۵ کاراکتر باشد.' });
  }
  const reserve = await withMongoTransaction(async session => fundVipReserve(amountCents, session));
  if (!reserve) return res.status(503).json({ success: false, code: 'VIP_RESERVE_UNAVAILABLE', message: 'Reserve در دسترس نیست.' });
  recordAdminLog({
    actor: req.adminActor,
    action: 'vip_reserve_fund_declaration',
    targetType: 'vip_reserve',
    targetId: 'global',
    details: `declared=${amountPoints} points; reason=${reason}`
  });
  return res.json({ success: true, reserve: vipReserveSnapshot(reserve), warning: 'این عملیات فقط موجودی Reserve حسابداری را ثبت می‌کند؛ انتقال خارجی وجه را انجام نمی‌دهد.' });
});

router.get('/vip/reserve/dashboard', async (req, res) => {
  const now = new Date();
  const [reserve, subscriptionTotals, payoutTotals, settings] = await Promise.all([
    VipReserve.findOne({ key: 'global' }).lean(),
    VipSubscription.aggregate([
      { $match: { policyVersion: 'v2_100d' } },
      { $group: {
        _id: null,
        subscriptions: { $sum: 1 },
        activeSubscriptions: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'active'] }, { $gt: ['$endAt', now] }] }, 1, 0] } },
        completedSubscriptions: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        cancelledSubscriptions: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
        liabilityCents: { $sum: { $ifNull: ['$reserveLiabilityCents', 0] } },
        paidCents: { $sum: { $ifNull: ['$reservePaidCents', 0] } },
        activeRemainingLiabilityCents: { $sum: { $cond: [
          { $and: [{ $eq: ['$status', 'active'] }, { $gt: ['$endAt', now] }] },
          { $max: [{ $subtract: [{ $ifNull: ['$reserveLiabilityCents', 0] }, { $ifNull: ['$reservePaidCents', 0] }] }, 0] },
          0
        ] } },
        dailyRewardPoints: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'active'] }, { $gt: ['$endAt', now] }] }, { $ifNull: ['$dailyRewardAveragePoints', 0] }, 0] } },
        dailyPrincipalCents: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'active'] }, { $gt: ['$endAt', now] }] }, { $divide: [{ $multiply: [{ $ifNull: ['$pricePoints', 0] }, { $ifNull: ['$principalDailyBps', 0] }] }, 10000] }, 0] } }
      } }
    ]),
    PointsLedger.aggregate([
      { $match: { type: { $in: ['vip_daily_principal', 'vip_daily_reward'] }, currency: 'points' } },
      { $group: { _id: '$type', totalPoints: { $sum: '$amount' }, events: { $sum: 1 } } }
    ]),
    Settings.getGlobal()
  ]);
  const totals = subscriptionTotals[0] || {};
  const rawReserve = reserve || { availablePointsCents: 0, reservedPointsCents: 0, paidPointsCents: 0, fundedPointsCents: 0 };
  const reserveData = vipReserveSnapshot(rawReserve);
  const activeRemainingLiabilityCents = Number(totals.activeRemainingLiabilityCents) || 0;
  const reservedPointsCents = Number(rawReserve.reservedPointsCents) || 0;
  const coveragePercent = activeRemainingLiabilityCents > 0
    ? Number(((reservedPointsCents / activeRemainingLiabilityCents) * 100).toFixed(2))
    : null;
  const reconciliationDifferencePoints = Number(((reservedPointsCents - activeRemainingLiabilityCents) / 100).toFixed(2));
  const ledger = Object.fromEntries(payoutTotals.map(row => [row._id, { points: Number(row.totalPoints) || 0, events: Number(row.events) || 0 }]));
  return res.json({
    success: true,
    asOf: now.toISOString(),
    reserve: reserveData,
    reserveCents: {
      available: Number(rawReserve.availablePointsCents) || 0,
      reserved: reservedPointsCents,
      paid: Number(rawReserve.paidPointsCents) || 0,
      funded: Number(rawReserve.fundedPointsCents) || 0
    },
    liabilities: {
      allV2Points: Number(((Number(totals.liabilityCents) || 0) / 100).toFixed(2)),
      paidV2Points: Number(((Number(totals.paidCents) || 0) / 100).toFixed(2)),
      activeRemainingPoints: Number((activeRemainingLiabilityCents / 100).toFixed(2)),
      reconciliationDifferencePoints,
      coveragePercent
    },
    subscriptions: {
      total: Number(totals.subscriptions) || 0,
      active: Number(totals.activeSubscriptions) || 0,
      completed: Number(totals.completedSubscriptions) || 0,
      cancelled: Number(totals.cancelledSubscriptions) || 0
    },
    dailyPayout: {
      rewardPointsAverage: Number(totals.dailyRewardPoints) || 0,
      principalPointsAverage: Number(totals.dailyPrincipalCents) || 0,
      totalPointsAverage: (Number(totals.dailyRewardPoints) || 0) + (Number(totals.dailyPrincipalCents) || 0)
    },
    ledger,
    policy: {
      version: settings.vipPolicyVersion || 'legacy_v1',
      effectiveAt: settings.vipPolicyEffectiveAt || null,
      newPurchasesEnabled: settings.vipNewPurchasesEnabled === true,
      payoutsEnabled: settings.vipPayoutsEnabled === true
    }
  });
});

router.get('/vip/reserve/report', async (req, res) => {
  try {
    const report = await buildVipReserveReport(req.query || {});
    return res.json({ success: true, report });
  } catch (error) {
    const status = ['VIP_REPORT_DATE_RANGE_INVALID', 'VIP_REPORT_DATE_RANGE_TOO_LARGE'].includes(error.code) ? 400 : 500;
    if (status === 500) console.error('VIP Reserve report failed:', error);
    return res.status(status).json({ success: false, code: error.code || 'VIP_REPORT_FAILED', message: error.message || 'گزارش Reserve ساخته نشد.' });
  }
});

router.get('/vip/reserve/export.xlsx', async (req, res) => {
  try {
    const report = await buildVipReserveReport(req.query || {});
    const workbook = await buildVipReserveWorkbook(report);
    const buffer = await workbook.xlsx.writeBuffer();
    const safeFrom = String(report.range.from).replace(/[^0-9-]/g, '');
    const safeTo = String(report.range.to).replace(/[^0-9-]/g, '');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="gramup-vip-reserve-${safeFrom}-to-${safeTo}.xlsx"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.send(buffer);
  } catch (error) {
    const status = ['VIP_REPORT_DATE_RANGE_INVALID', 'VIP_REPORT_DATE_RANGE_TOO_LARGE'].includes(error.code) ? 400 : 500;
    if (status === 500) console.error('VIP Reserve export failed:', error);
    return res.status(status).json({ success: false, code: error.code || 'VIP_EXPORT_FAILED', message: error.message || 'خروجی Excel ساخته نشد.' });
  }
});

router.get('/settings', async (req, res) => {
  const settings = await Settings.getGlobal();
  res.json({
    success: true,
    settings: {
      ...settings.toObject(),
      referralInitialRewardPoints: DEFAULT_REFERRAL_INITIAL_REWARD_POINTS,
      referralLevelRates: safeAdminReferralRates(settings)
    },
    timezones: COMMON_TIMEZONES
  });
});

router.get('/daily-reminder/status', async (req, res) => {
  const settings = await Settings.getGlobal();
  const now = new Date();
  const lastRunAt = settings.dailyReminderLastRunAt ? new Date(settings.dailyReminderLastRunAt) : null;
  const lastRunAgeSeconds = lastRunAt ? Math.max(0, Math.floor((now.getTime() - lastRunAt.getTime()) / 1000)) : null;
  return res.json({
    success: true,
    scheduler: 'render_cron',
    schedule: { cron: '0 4 * * *', timezone: 'UTC', localTimezone: 'Asia/Kabul', localTime: '08:30' },
    enabled: settings.dailyReminderEnabled === true,
    lastRun: {
      at: lastRunAt,
      ageSeconds: lastRunAgeSeconds,
      sent: Number(settings.dailyReminderLastSentCount || 0),
      failed: Number(settings.dailyReminderLastFailedCount || 0),
      status: settings.dailyReminderLastStatus || 'never',
      error: settings.dailyReminderLastError || ''
    },
    expectedTargetForToday: kabulReminderTarget(now),
    healthy: settings.dailyReminderEnabled === true
      && Boolean(lastRunAt)
      && settings.dailyReminderLastStatus === 'ok'
      && Number(settings.dailyReminderLastFailedCount || 0) === 0
  });
});

router.get('/daily-reminder/last-run', async (req, res) => {
  const settings = await Settings.getGlobal();
  return res.json({
    success: true,
    lastRunAt: settings.dailyReminderLastRunAt || null,
    sentCount: Number(settings.dailyReminderLastSentCount || 0),
    failedCount: Number(settings.dailyReminderLastFailedCount || 0),
    status: settings.dailyReminderLastStatus || 'never',
    error: settings.dailyReminderLastError || ''
  });
});

router.get('/maintenance', async (req, res) => {
  if (!isTestEnvironment()) return res.status(403).json({ success: false, code: 'TEST_ONLY', message: 'Maintenance Mode فقط در محیط TEST مجاز است.' });
  const settings = await Settings.getGlobal();
  res.json({
    success: true,
    enabled: settings.maintenanceEnabled === true,
    allowedTelegramIds: normalizeAllowedTelegramIds(settings.maintenanceAllowedTelegramIds || []) || []
  });
});

router.put('/maintenance', async (req, res) => {
  if (!isTestEnvironment()) return res.status(403).json({ success: false, code: 'TEST_ONLY', message: 'Maintenance Mode فقط در محیط TEST مجاز است.' });
  const body = req.body || {};
  const allowedTelegramIds = normalizeAllowedTelegramIds(body.allowedTelegramIds);
  if (allowedTelegramIds === null) {
    return res.status(400).json({ success: false, code: 'INVALID_ALLOWED_USERS', message: 'Allowed Users باید حداکثر ۱۰۰ Telegram User ID عددی باشد.' });
  }
  if (typeof body.enabled !== 'boolean') {
    return res.status(400).json({ success: false, code: 'INVALID_MAINTENANCE_STATE', message: 'وضعیت Maintenance باید boolean باشد.' });
  }
  const settings = await Settings.getGlobal();
  settings.maintenanceEnabled = body.enabled;
  settings.maintenanceAllowedTelegramIds = allowedTelegramIds;
  await settings.save();
  recordAdminLog({
    actor: req.adminActor,
    action: 'maintenance_mode_update',
    targetType: 'settings',
    details: `${body.enabled ? 'enabled' : 'disabled'}; allowed=${allowedTelegramIds.length}`
  });
  res.json({ success: true, enabled: settings.maintenanceEnabled === true, allowedTelegramIds });
});

router.put('/settings', async (req, res) => {
  const body = req.body || {};
  const rules = {
    rate: v => v > 0,
    minWithdrawPoints: v => v >= 0,
    dailyCheckInPoints: v => v >= 0,
    streakBonusPoints: v => v >= 0,
    gramUsdPrice: v => v >= 0,
    dailyReminderLocalHour: v => Number.isInteger(v) && v >= 0 && v <= 23,
    dailyReminderLocalMinute: v => Number.isInteger(v) && v >= 0 && v <= 59
  };

  const changes = {};
  for (const [key, isOk] of Object.entries(rules)) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    const value = Number(body[key]);
    if (!Number.isFinite(value) || !isOk(value)) {
      return res.status(400).json({ success: false, message: `مقدار «${key}» نامعتبر است.` });
    }
    changes[key] = value;
  }

  // dailyReminderEnabled یک boolean است، نه یک عدد؛ جدا از قاعده‌ی بالا پردازش می‌شود
  if (Object.prototype.hasOwnProperty.call(body, 'dailyReminderEnabled')) {
    changes.dailyReminderEnabled = body.dailyReminderEnabled === true || body.dailyReminderEnabled === 'true';
  }
  if (Object.prototype.hasOwnProperty.call(body, 'dailyReminderTimezone')) {
    const tz = String(body.dailyReminderTimezone || 'UTC');
    if (!isValidTimezone(tz)) {
      return res.status(400).json({ success: false, message: 'منطقه‌ی زمانی نامعتبر است.' });
    }
    changes.dailyReminderTimezone = tz;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'dailyReminderAudience')) {
    if (!['all', 'active'].includes(body.dailyReminderAudience)) {
      return res.status(400).json({ success: false, message: 'مخاطبان یادآوری نامعتبر است.' });
    }
    changes.dailyReminderAudience = body.dailyReminderAudience;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'dailyReminderMessage')) {
    const msg = String(body.dailyReminderMessage || '').trim();
    if (msg.length > 500) {
      return res.status(400).json({ success: false, message: 'متن یادآوری نباید بیشتر از ۵۰۰ کاراکتر باشد.' });
    }
    changes.dailyReminderMessage = msg;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'weeklyLeaderboardEnabled')) {
    changes.weeklyLeaderboardEnabled = body.weeklyLeaderboardEnabled === true || body.weeklyLeaderboardEnabled === 'true';
  }
  if (Object.prototype.hasOwnProperty.call(body, 'vipPolicyVersion')) {
    if (!['legacy_v1', 'v2_100d'].includes(body.vipPolicyVersion)) {
      return res.status(400).json({ success: false, message: 'نسخه سیاست VIP نامعتبر است.' });
    }
    changes.vipPolicyVersion = body.vipPolicyVersion;
  }
  for (const key of ['vipNewPurchasesEnabled', 'vipPayoutsEnabled']) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      changes[key] = body[key] === true || body[key] === 'true';
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'vipPolicyEffectiveAt')) {
    const effectiveAt = body.vipPolicyEffectiveAt ? new Date(body.vipPolicyEffectiveAt) : null;
    if (effectiveAt && Number.isNaN(effectiveAt.getTime())) {
      return res.status(400).json({ success: false, message: 'زمان فعال‌سازی سیاست VIP نامعتبر است.' });
    }
    changes.vipPolicyEffectiveAt = effectiveAt;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'weeklyLeaderboardPrizes')) {
    const prizes = Array.isArray(body.weeklyLeaderboardPrizes) ? body.weeklyLeaderboardPrizes.map(Number) : null;
    if (!prizes || prizes.length < 3 || prizes.length > 10 || prizes.some(value => !Number.isInteger(value) || value < 0 || value > 100000000)) {
      return res.status(400).json({ success: false, message: 'جوایز leaderboard هفتگی باید ۳ تا ۱۰ عدد صحیح غیرمنفی باشد.' });
    }
    changes.weeklyLeaderboardPrizes = prizes;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'referralInitialRewardPoints')) {
    const points = Number(body.referralInitialRewardPoints);
    if (points !== DEFAULT_REFERRAL_INITIAL_REWARD_POINTS) {
      return res.status(400).json({ success: false, message: 'پاداش دعوت مستقیم طبق سیاست فعلی دقیقاً ۱۰ Points است.' });
    }
    changes.referralInitialRewardPoints = DEFAULT_REFERRAL_INITIAL_REWARD_POINTS;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'referralLevelRates')) {
    try {
      changes.referralLevelRates = normalizeReferralRates(body.referralLevelRates);
    } catch (error) {
      return res.status(400).json({ success: false, message: `نرخ‌های Referral نامعتبر است: ${error.message}` });
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'depositEnabled')) {
    changes.depositEnabled = body.depositEnabled === true || body.depositEnabled === 'true';
  }
  if (Object.prototype.hasOwnProperty.call(body, 'depositNetwork')) {
    if (body.depositNetwork !== 'TON_MAINNET') {
      return res.status(400).json({ success: false, message: 'شبکه Deposit فقط TON Mainnet است.' });
    }
    changes.depositNetwork = 'TON_MAINNET';
  }
  for (const key of ['depositWalletAddress']) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    const value = String(body[key] || '').trim();
    if (value && !normalizeTonAddress(value)) {
      return res.status(400).json({ success: false, message: `آدرس TON واردشده برای «${key}» معتبر نیست.` });
    }
    changes[key] = value;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'minimumDepositGram')) {
    const minimum = Number(body.minimumDepositGram);
    if (amountToNanoGram(minimum) == null) {
      return res.status(400).json({ success: false, message: 'حداقل Deposit باید مثبت و تا حداکثر ۹ رقم اعشار قابل نمایش در Native GRAM باشد.' });
    }
    changes.minimumDepositGram = minimum;
  }

  const settings = await Settings.getGlobal();

  const finalDepositEnabled = changes.depositEnabled !== undefined ? changes.depositEnabled : settings.depositEnabled;
  const finalDepositWallet = changes.depositWalletAddress !== undefined ? changes.depositWalletAddress : settings.depositWalletAddress;
  const finalMinimumDeposit = changes.minimumDepositGram !== undefined ? changes.minimumDepositGram : settings.minimumDepositGram;
  const finalDepositNetwork = changes.depositNetwork !== undefined ? changes.depositNetwork : (settings.depositNetwork || 'TON_MAINNET');
  if (finalDepositEnabled) {
    if (!normalizeTonAddress(finalDepositWallet) || amountToNanoGram(finalMinimumDeposit) == null
      || finalDepositNetwork !== 'TON_MAINNET') {
      return res.status(400).json({
        success: false,
        message: 'برای فعال‌سازی Deposit Native GRAM، آدرس TON Mainnet تحت کنترل پروژه و حداقل مبلغ معتبر را تنظیم کنید.'
      });
    }
  }

  // ساعت واقعی اجرا (UTC) از روی «ساعت محلی + منطقه‌ی زمانی» محاسبه می‌شود، نه مستقیم از ادمین
  if (changes.dailyReminderLocalHour !== undefined || changes.dailyReminderTimezone !== undefined) {
    const localHour = changes.dailyReminderLocalHour !== undefined ? changes.dailyReminderLocalHour : settings.dailyReminderLocalHour;
    const timezone = changes.dailyReminderTimezone !== undefined ? changes.dailyReminderTimezone : settings.dailyReminderTimezone;
    changes.dailyReminderHourUtc = targetUtcHour(localHour, timezone);
  }
  if (changes.dailyReminderLocalMinute !== undefined) {
    changes.dailyReminderMinuteUtc = changes.dailyReminderLocalMinute;
  }


  Object.assign(settings, changes);
  await settings.save();
  res.json({
    success: true,
    settings: {
      ...settings.toObject(),
      referralInitialRewardPoints: DEFAULT_REFERRAL_INITIAL_REWARD_POINTS,
      referralLevelRates: safeAdminReferralRates(settings)
    },
    timezones: COMMON_TIMEZONES
  });

  recordAdminLog({
    actor: req.adminActor,
    action: 'settings_update',
    targetType: 'settings',
    details: Object.keys(changes).join(', ')
  });
});

/**
 * POST /api/admin/daily-reminder/test — ارسال پیام یادآوری (با متن فعلی تنظیمات) به یک
 * آیدی عددی تلگرام مشخص، برای اینکه ادمین قبل از فعال کردن، پیام را واقعاً ببیند.
 * این اندپوینت خودِ Settings.dailyReminderEnabled را روشن نمی‌کند و شمارنده‌ها را تغییر نمی‌دهد.
 */
router.post('/daily-reminder/test', async (req, res) => {
  const telegramId = String((req.body && req.body.telegramId) || '').trim();
  const lang = ['fa', 'ps', 'en'].includes(req.body && req.body.lang) ? req.body.lang : 'fa';
  if (!telegramId || !/^\d{3,15}$/.test(telegramId)) {
    return res.status(400).json({ success: false, message: 'آیدی عددی تلگرام معتبر وارد کنید (فقط عدد).' });
  }
  const ok = await sendTestReminder(telegramId, lang);
  if (!ok) {
    return res.status(400).json({
      success: false,
      message: 'ارسال ناموفق بود. مطمئن شوید این آیدی درست است و قبلاً /start را به ربات زده.'
    });
  }
  res.json({ success: true, message: 'پیام آزمایشی ارسال شد.' });
});

/**
 * POST /api/admin/daily-reminder/test-all — ارسال فوری و شخصی‌سازی‌شده‌ی پیام تست
 * برای همه‌ی کاربران شروع‌کرده. این عملیات زمان‌بندی روزانه و markerهای کاربران را تغییر نمی‌دهد.
 */
router.post('/daily-reminder/test-all', async (req, res) => {
  if (!bot) return res.status(503).json({ success: false, message: 'ربات پیکربندی نشده.' });
  const users = await User.find({ isBanned: false, telegramBlockedAt: null, telegramId: { $exists: true, $nin: ['', null] } }, 'telegramId');
  const job = await BroadcastJob.create({
    actor: `${req.adminActor} — daily reminder test`,
    hasImage: false,
    textPreview: '[TEST] Daily Check reminder — personalized',
    totalRecipients: users.length
  });
  res.json({
    success: true,
    message: `ارسال آزمایشی برای ${users.length} کاربر آغاز شد.`,
    broadcastId: String(job._id),
    statusUrl: `/api/admin/broadcast/${job._id}`,
    totalRecipients: users.length,
    status: job.status
  });
  recordAdminLog({
    actor: req.adminActor,
    action: 'daily_reminder_test_all',
    targetType: 'broadcast',
    details: `${users.length} گیرنده — personalized daily reminder test`
  });
  void sendTestReminderToAll({
    User,
    Settings,
    now: new Date(),
    onProgress: progress => BroadcastJob.updateOne({ _id: job._id }, {
      $set: { sent: progress.sent, failed: progress.failed, lastError: progress.lastError || '' }
    })
  }).then(result => BroadcastJob.updateOne({ _id: job._id }, {
    $set: { status: 'completed', sent: result.sent, failed: result.failed, lastError: result.lastError || '', finishedAt: new Date() }
  })).catch(error => BroadcastJob.updateOne({ _id: job._id }, {
    $set: { status: 'failed', finishedAt: new Date(), lastError: String(error.message || error).slice(0, 500) }
  }).catch(() => {}));
});

/* -------------------- STATS (داشبورد آمار) -------------------- */
/**
 * GET /api/admin/stats — خلاصه‌ی امروز + روند ۷ روز اخیر، برای داشبورد گرافیکی.
 */
router.get('/stats', async (req, res) => {
  const now = new Date();
  // همه‌چیز بر پایه‌ی روز UTC است (همان مبنای ریست روزانه و $dateToString در MongoDB)،
  // تا نمودار به منطقه‌ی زمانی سرور وابسته نباشد.
  const DAY_MS = 86400000;
  const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const sevenDaysAgo = new Date(startOfToday.getTime() - 6 * DAY_MS); // شامل خود امروز = ۷ روز

  const [
    newUsersToday,
    tasksCompletedToday,
    totalUsers,
    bannedUsers,
    totalReferred,
    activeReferred,
    legacyConvertedReferred,
    initialRewardedReferred,
    referralCommissionStats,
    referralLevelStats,
    topReferralActivity,
    pendingWithdrawals,
    paidTodayAgg,
    newUsersTrend,
    tasksTrend
  ] = await Promise.all([
    User.countDocuments({ createdAt: { $gte: startOfToday } }),
    TaskCompletion.countDocuments({ status: 'approved', createdAt: { $gte: startOfToday } }),
    User.countDocuments({}),
    User.countDocuments({ isBanned: true }),
    User.countDocuments({ referredBy: { $ne: null } }),
    User.countDocuments({ referredBy: { $ne: null }, referralEligibilityStatus: 'eligible' }),
    User.countDocuments({ referredBy: { $ne: null }, referralBonusAwarded: true }),
    ReferralRelationship.countDocuments({ level: 1, initialRewardStatus: 'paid' }),
    PointsLedger.aggregate([
      { $match: { type: 'referral_commission', currency: 'points', amount: { $gt: 0 } } },
      { $group: { _id: null, totalPoints: { $sum: '$amount' }, transactions: { $sum: 1 } } }
    ]),
    ReferralRelationship.aggregate([
      { $group: {
        _id: '$level',
        members: { $sum: 1 },
        activeMembers: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } }
      } },
      { $sort: { _id: 1 } }
    ]),
    User.aggregate([
      { $match: { referredBy: { $ne: null } } },
      { $group: {
        _id: '$referredBy',
        totalReferrals: { $sum: 1 },
        activeReferrals: { $sum: { $cond: [{ $eq: ['$referralEligibilityStatus', 'eligible'] }, 1, 0] } }
      } },
      { $sort: { totalReferrals: -1, activeReferrals: -1 } },
      { $limit: 10 },
      { $lookup: { from: User.collection.name, localField: '_id', foreignField: '_id', as: 'owner' } },
      { $unwind: { path: '$owner', preserveNullAndEmptyArrays: true } },
      { $project: {
        _id: 0,
        userId: '$_id',
        firstName: '$owner.firstName',
        username: '$owner.username',
        totalReferrals: 1,
        activeReferrals: 1
      } }
    ]),
    Withdrawal.countDocuments({ status: 'pending' }),
    Withdrawal.aggregate([
      { $match: { status: 'paid', paidAt: { $gte: startOfToday } } },
      { $group: { _id: '$token', total: { $sum: '$cryptoAmount' } } }
    ]),
    User.aggregate([
      { $match: { createdAt: { $gte: sevenDaysAgo } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } }
    ]),
    TaskCompletion.aggregate([
      { $match: { status: 'approved', createdAt: { $gte: sevenDaysAgo } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } }
    ])
  ]);

  // پر کردن روزهای بدون داده با صفر، تا نمودار ۷ ستون کامل داشته باشد
  const convertedReferred = legacyConvertedReferred + initialRewardedReferred;
  const referralCommissionTotalPoints = Number(referralCommissionStats[0]?.totalPoints) || 0;
  const referralCommissionTransactions = Number(referralCommissionStats[0]?.transactions) || 0;
  function buildTrend(aggResult) {
    const map = new Map(aggResult.map(r => [r._id, r.count]));
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(startOfToday.getTime() - i * DAY_MS);
      const key = d.toISOString().slice(0, 10);
      days.push({ date: key, count: map.get(key) || 0 });
    }
    return days;
  }

  const referralConversionRate = totalReferred > 0 ? Math.round((convertedReferred / totalReferred) * 1000) / 10 : 0;

  res.json({
    success: true,
    stats: {
      newUsersToday,
      tasksCompletedToday,
      totalUsers,
      bannedUsers,
      totalReferred,
      activeReferred,
      convertedReferred,
      referralConversionRate,
      referralCommissionTotalPoints,
      referralCommissionTransactions,
      referralLevelStats: referralLevelStats.map(row => ({
        level: Number(row._id) || null,
        members: Number(row.members) || 0,
        activeMembers: Number(row.activeMembers) || 0
      })),
      topReferralActivity: topReferralActivity.map(row => ({
        userId: String(row.userId || ''),
        firstName: String(row.firstName || ''),
        username: String(row.username || ''),
        totalReferrals: Number(row.totalReferrals) || 0,
        activeReferrals: Number(row.activeReferrals) || 0
      })),
      pendingWithdrawals,
      paidToday: paidTodayAgg,
      newUsersTrend: buildTrend(newUsersTrend),
      tasksTrend: buildTrend(tasksTrend)
    }
  });
});

/* -------------------- ADMIN ACTIVITY LOG -------------------- */
/**
 * GET /api/admin/logs?action=...&targetType=...&limit=100
 */
router.get('/logs', async (req, res) => {
  const { action, targetType } = req.query;
  const filter = {};
  if (action) filter.action = action;
  if (targetType) filter.targetType = targetType;

  const { page, limit, skip } = pageParams(req.query, 100, 300);
  const [logs, total] = await Promise.all([
    AdminLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    AdminLog.countDocuments(filter)
  ]);
  res.json({ success: true, logs, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

/* -------------------- BROADCAST (پیام همگانی) -------------------- */
router.get('/broadcast/:id', async (req, res) => {
  const job = await BroadcastJob.findById(req.params.id).lean();
  if (!job) return res.status(404).json({ success: false, message: 'Broadcast پیدا نشد.' });
  res.json({
    success: true,
    job: {
      id: String(job._id),
      status: job.status,
      totalRecipients: job.totalRecipients,
      sent: job.sent,
      failed: job.failed,
      pending: Math.max(0, job.totalRecipients - job.sent - job.failed),
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      lastError: job.lastError || ''
    }
  });
});

router.post('/broadcast', upload.single('image'), async (req, res) => {
  if (!bot) {
    return res.status(500).json({ success: false, message: 'ربات پیکربندی نشده.' });
  }
  const text = String((req.body && req.body.text) || '').trim();
  if (!text) {
    return res.status(400).json({ success: false, message: 'متن پیام الزامی است.' });
  }

  const users = await User.find({ isBanned: false, telegramBlockedAt: null }, 'telegramId');
  const job = await BroadcastJob.create({
    actor: req.adminActor,
    hasImage: Boolean(req.file),
    textPreview: text.slice(0, 120),
    totalRecipients: users.length
  });

  // برای جلوگیری از برخورد با محدودیت نرخ تلگرام (~۳۰ پیام در ثانیه)،
  // ارسال را به‌صورت دسته‌ای و با تأخیر کوتاه انجام می‌دهیم.
  const BATCH_SIZE = 20;
  const DELAY_MS = 1100;

  res.json({
    success: true,
    message: `ارسال برای ${users.length} کاربر آغاز شد. وضعیت ارسال قابل پیگیری است.`,
    broadcastId: String(job._id),
    statusUrl: `/api/admin/broadcast/${job._id}`,
    totalRecipients: users.length,
    status: job.status
  });

  recordAdminLog({
    actor: req.adminActor,
    action: 'broadcast_send',
    targetType: 'broadcast',
    details: `${users.length} گیرنده — ${text.slice(0, 80)}${text.length > 80 ? '…' : ''}`
  });

  void (async () => {
    let sent = 0;
    let failed = 0;
    try {
      for (let i = 0; i < users.length; i += BATCH_SIZE) {
        const batch = users.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(batch.map(async user => {
          try {
            if (req.file) await bot.sendPhoto(user.telegramId, req.file.buffer, { caption: text });
            else await bot.sendMessage(user.telegramId, text);
            return true;
          } catch (error) {
            if (isTelegramDeliveryBlocked(error)) await markTelegramBlocked(user.telegramId);
            return false;
          }
        }));
        sent += results.filter(Boolean).length;
        failed += results.length - results.filter(Boolean).length;
        await BroadcastJob.updateOne({ _id: job._id }, { $set: { sent, failed } });
        if (i + BATCH_SIZE < users.length) await new Promise(resolve => setTimeout(resolve, DELAY_MS));
      }
      await BroadcastJob.updateOne({ _id: job._id }, { $set: { status: 'completed', sent, failed, finishedAt: new Date() } });
      console.log(`📣 Broadcast finished: job=${job._id} sent=${sent} failed=${failed} total=${users.length}`);
    } catch (error) {
      await BroadcastJob.updateOne({ _id: job._id }, { $set: { status: 'failed', sent, failed, finishedAt: new Date(), lastError: String(error.message || error).slice(0, 500) } }).catch(() => {});
      console.error(`[broadcast:${job._id}] failed:`, error.message || error);
    }
  })();
});

module.exports = router;
