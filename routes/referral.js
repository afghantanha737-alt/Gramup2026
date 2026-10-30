'use strict';
const express = require('express');
const router = express.Router();
require('../utils/asyncHandler').wrapRouter(router);
const { requireUnifiedAuth } = require('../utils/unifiedAuth');
const { sensitiveRateLimit } = require('../utils/apiSecurity');
const User = require('../models/User');
const Settings = require('../models/Settings');
const PointsLedger = require('../models/PointsLedger');
const { recordLedgerRequired } = require('../utils/ledger');
const { withMongoTransaction } = require('../utils/mongoTransaction');
const { referralTaskId, buildReferralTaskProgress, REFERRAL_REWARD_TASKS } = require('../utils/referralRewards');
const { REFERRAL_MIN_TASKS, REFERRAL_MIN_ACTIVE_DAYS, REFERRAL_WAIT_DAYS } = require('../utils/referralEligibility');
const {
  normalizeReferralRates,
  createMiniAppReferralLink,
  DEFAULT_REFERRAL_INITIAL_REWARD_POINTS,
  reviewStatusOf
} = require('../utils/referralCore');
const { buildReferralViewData, calculateReferralEarningsTotal } = require('../utils/referralView');

const { withMembership } = require('../utils/membership');
const auth = withMembership(requireUnifiedAuth(process.env.BOT_TOKEN));
const REFERRAL_LEDGER_TYPES = ['referral_initial', 'referral_bonus', 'referral_commission', 'referral_welcome'];
const HISTORY_LIMIT = 40;

function utcMonthStart(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function validEarningType(type) {
  return ['task', 'checkin', 'spin', 'leaderboard_reward'].includes(type) ? type : 'other';
}

// GET /api/referral/me — dashboard, aggregated network counts and real ledger history.
router.get('/me', auth, async (req, res) => {
  const u = req.dbUser;
  const botUsername = String(process.env.BOT_USERNAME || '').replace(/^@/, '');
  const shareLink = createMiniAppReferralLink(botUsername, u.telegramId);
  const miniAppConfigured = Boolean(shareLink);
  const referralSettings = await Settings.getGlobal();
  let referralLevelRates;
  try { referralLevelRates = normalizeReferralRates(referralSettings.referralLevelRates); }
  catch { referralLevelRates = normalizeReferralRates(); }

  const monthStart = utcMonthStart();
  const [totalReferralCount, networkRows, referralLedgerRows, commissionSummaryRows, monthlyRows, historyRows] = await Promise.all([
    User.countDocuments({ referredBy: u._id }),
    User.aggregate([
      { $match: { _id: u._id } },
      { $graphLookup: {
        from: User.collection.name,
        startWith: '$_id',
        connectFromField: '_id',
        connectToField: 'referredBy',
        as: 'descendants',
        maxDepth: Math.max(0, referralLevelRates.length - 1),
        depthField: 'depth'
      } },
      { $project: { descendants: 1 } }
    ]),
    PointsLedger.aggregate([
      { $match: { user: u._id, currency: 'points', amount: { $gt: 0 }, type: { $in: REFERRAL_LEDGER_TYPES } } },
      { $group: { _id: '$type', total: { $sum: '$amount' } } }
    ]),
    PointsLedger.aggregate([
      { $match: { user: u._id, currency: 'points', type: 'referral_commission', amount: { $gt: 0 } } },
      { $facet: {
        byLevel: [{ $group: { _id: '$referralLevel', earnedPoints: { $sum: '$amount' } } }],
        byFriend: [{ $match: { sourceUserId: { $ne: null } } }, { $group: { _id: '$sourceUserId', earnedPoints: { $sum: '$amount' } } }]
      } }
    ]),
    PointsLedger.aggregate([
      { $match: { user: u._id, currency: 'points', amount: { $gt: 0 }, type: { $in: REFERRAL_LEDGER_TYPES }, createdAt: { $gte: monthStart } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]),
    PointsLedger.find({ user: u._id, currency: 'points', amount: { $gt: 0 }, type: { $in: REFERRAL_LEDGER_TYPES } })
      .select('_id type amount createdAt referralLevel commissionRatePercent earningTransactionId transactionId')
      .sort({ createdAt: -1, _id: -1 })
      .limit(HISTORY_LIMIT)
      .lean()
  ]);

  const commissionSummary = commissionSummaryRows[0] || {};
  const descendants = networkRows[0]?.descendants || [];
  const referralView = buildReferralViewData({
    rates: referralLevelRates,
    descendants,
    earningsByLevel: commissionSummary.byLevel || [],
    earningsByFriend: commissionSummary.byFriend || [],
    rootUserId: u._id
  });
  const ledgerTotals = Object.fromEntries(referralLedgerRows.map(row => [row._id, Number(row.total) || 0]));
  const initialInviteRewardPoints = ledgerTotals.referral_initial || 0;
  const milestoneRewardPoints = ledgerTotals.referral_bonus || 0;
  const welcomeRewardPoints = ledgerTotals.referral_welcome || 0;
  const totalTeamCommissionPoints = ledgerTotals.referral_commission || 0;
  const totalReferralEarningsPoints = calculateReferralEarningsTotal({
    initialInviteRewardPoints,
    milestoneRewardPoints,
    teamCommissionPoints: totalTeamCommissionPoints
  }) + welcomeRewardPoints;

  const activeCounts = {};
  for (const person of descendants) {
    if (String(person._id) === String(u._id)) continue;
    const level = Number(person.depth) + 1;
    if (!Number.isInteger(level) || level < 1 || level > referralLevelRates.length) continue;
    const isActive = person.referralEligibilityStatus === 'eligible'
      && reviewStatusOf(person) === 'active';
    if (isActive) activeCounts[String(level)] = (activeCounts[String(level)] || 0) + 1;
  }

  const earningsByLevel = referralView.earningsByLevel.filter(row => row.level != null);
  const networkLevels = referralLevelRates.map((rate, index) => {
    const level = index + 1;
    const earningsRow = earningsByLevel.find(row => Number(row.level) === level);
    return {
      level,
      members: Number(referralView.levelCounts[String(level)]) || 0,
      activeMembers: Number(activeCounts[String(level)]) || 0,
      rate,
      commissionPoints: Number(earningsRow?.earnedPoints) || 0
    };
  });
  const currentReferralLevel = networkLevels.reduce((max, row) => row.activeMembers > 0 ? Math.max(max, row.level) : max, 0);

  const sourceRefs = [...new Set(historyRows
    .filter(row => row.type === 'referral_commission' && row.earningTransactionId)
    .map(row => String(row.earningTransactionId))
    .filter(Boolean))];
  const sourceRows = sourceRefs.length
    ? await PointsLedger.find({ $or: [{ sourceId: { $in: sourceRefs } }, { transactionId: { $in: sourceRefs } }] })
      .select('sourceId transactionId type amount description')
      .lean()
    : [];
  const sourceMap = new Map();
  for (const row of sourceRows) {
    if (row.sourceId) sourceMap.set(String(row.sourceId), row);
    if (row.transactionId) sourceMap.set(String(row.transactionId), row);
  }

  const referralHistory = historyRows.map(row => {
    const sourceEntry = row.type === 'referral_commission'
      ? sourceMap.get(String(row.earningTransactionId || ''))
      : null;
    const kind = row.type === 'referral_initial' ? 'direct_invite'
      : row.type === 'referral_bonus' ? 'milestone'
        : row.type === 'referral_welcome' ? 'welcome'
        : 'commission';
    return {
      id: String(row._id),
      date: row.createdAt,
      kind,
      level: Number.isInteger(row.referralLevel) ? row.referralLevel : null,
      rate: Number.isFinite(Number(row.commissionRatePercent)) ? Number(row.commissionRatePercent) : null,
      source: kind === 'commission' ? validEarningType(sourceEntry?.type) : kind,
      sourceEarnedPoints: Number(sourceEntry?.amount) || 0,
      points: Number(row.amount) || 0
    };
  });

  const monthlyTotal = Number(monthlyRows[0]?.total) || 0;
  res.json({
    success: true,
    referralCode: u.referralCode,
    invitedCount: totalReferralCount,
    activeInvitedCount: Number(u.activeInvitedCount) || 0,
    shareLink,
    botUsernameConfigured: Boolean(botUsername),
    miniAppConfigured,
    referralMinTasks: REFERRAL_MIN_TASKS,
    referralInitialRewardPoints: DEFAULT_REFERRAL_INITIAL_REWARD_POINTS,
    referralLevelRates,
    referralStats: {
      totalReferrals: totalReferralCount,
      activeReferrals: Number(u.activeInvitedCount) || 0,
      totalNetwork: referralView.totalReferrals,
      currentReferralLevel,
      thisMonthReferralEarningsPoints: monthlyTotal,
      totalReferralEarningsPoints,
      totalReferralCommissionPoints: totalTeamCommissionPoints,
      initialInviteRewardPoints,
      milestoneRewardPoints,
      welcomeRewardPoints,
      totalInviteRewardsPoints: initialInviteRewardPoints + milestoneRewardPoints + welcomeRewardPoints,
      totalTeamCommissionPoints,
      levelCounts: referralView.levelCounts,
      activeLevelCounts: activeCounts,
      earningsByLevel: referralView.earningsByLevel
    },
    referralHistory,
    networkLevels,
    referralEligibility: {
      minTasks: REFERRAL_MIN_TASKS,
      minActiveDays: REFERRAL_MIN_ACTIVE_DAYS,
      waitDays: REFERRAL_WAIT_DAYS
    },
    referralTasks: buildReferralTaskProgress(u.activeInvitedCount, u.referralRewardClaims),
    // Per-person identities, Telegram IDs, and earnings are deliberately omitted.
    invited: [],
    team: []
  });
});

// POST /api/referral/claim — اتمیک و تکرارنشدنی؛ سوابق milestone قبلی حفظ می‌شوند.
router.post('/claim', auth, sensitiveRateLimit('claim'), async (req, res) => {
  const taskId = referralTaskId(req.body && req.body.taskId);
  if (!taskId) {
    return res.status(400).json({ success: false, message: 'تسک ریفرال نامعتبر است.', code: 'INVALID_REFERRAL_TASK' });
  }

  const task = REFERRAL_REWARD_TASKS.find(item => item.id === taskId);
  const updated = await withMongoTransaction(async session => {
    const result = await User.findOneAndUpdate(
      {
        _id: req.dbUser._id,
        activeInvitedCount: { $gte: task.requiredInvites },
        'referralRewardClaims.taskId': { $ne: taskId }
      },
      {
        $inc: { points: task.rewardPoints },
        $push: { referralRewardClaims: { taskId, claimedAt: new Date() } }
      },
      { new: true, runValidators: true, session }
    );
    if (!result) return null;
    const ledgerResult = await recordLedgerRequired({
      user: result._id,
      type: 'referral_bonus',
      amount: task.rewardPoints,
      description: `پاداش تسک دعوت ${task.requiredInvites} نفر`,
      balanceAfter: result.points,
      sourceId: `referral-task:${result._id}:${taskId}`,
      session
    });
    if (!ledgerResult.created) {
      const error = new Error('این پاداش قبلاً ثبت شده است.');
      error.code = 'REFERRAL_TASK_DUPLICATE';
      throw error;
    }
    return result;
  });

  if (!updated) {
    const latest = await User.findById(req.dbUser._id).select('activeInvitedCount referralRewardClaims');
    if (!latest || latest.activeInvitedCount < task.requiredInvites) {
      return res.status(400).json({
        success: false,
        message: `${Math.max(0, task.requiredInvites - (latest?.activeInvitedCount || 0))} دعوت‌شده فعال دیگر لازم است.`,
        code: 'REFERRAL_TASK_LOCKED'
      });
    }
    return res.status(409).json({ success: false, message: 'این پاداش قبلاً دریافت شده است.', code: 'REFERRAL_TASK_ALREADY_CLAIMED' });
  }

  res.json({
    success: true,
    taskId,
    rewardPoints: task.rewardPoints,
    points: updated.points,
    invitedCount: updated.invitedCount,
    activeInvitedCount: updated.activeInvitedCount,
    referralTasks: buildReferralTaskProgress(updated.activeInvitedCount, updated.referralRewardClaims)
  });
});

module.exports = router;
