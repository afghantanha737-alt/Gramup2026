'use strict';

const PointsLedger = require('../models/PointsLedger');
const User = require('../models/User');
const Settings = require('../models/Settings');
const WeeklyLeaderboardAward = require('../models/WeeklyLeaderboardAward');
const { withMongoTransaction } = require('./mongoTransaction');
const { recordLedgerRequired } = require('./ledger');
const { botText } = require('./botMessages');
const { sendNotificationOnce } = require('./notificationDelivery');
const { startOfUtcWeek, endOfUtcWeek, weekKey: buildWeekKey } = require('./weeklyLeaderboard');

const POSITIVE_TYPES = Object.freeze(['task', 'checkin', 'spin', 'referral_bonus']);
const MAX_PRIZE_RANKS = 3;
const STALE_PROCESSING_MS = 10 * 60 * 1000;

function parseWeekKey(value) {
  const key = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const start = new Date(`${key}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || buildWeekKey(start) !== key) return null;
  return { key, start, end: new Date(start.getTime() + 7 * 86400000) };
}

function previousClosedWeek(now = new Date()) {
  const currentStart = startOfUtcWeek(now);
  return parseWeekKey(buildWeekKey(new Date(currentStart.getTime() - 1)));
}

async function getStandings(window, limit = MAX_PRIZE_RANKS) {
  return PointsLedger.aggregate([
    {
      $match: {
        createdAt: { $gte: window.start, $lt: window.end },
        currency: 'points',
        amount: { $gt: 0 },
        type: { $in: POSITIVE_TYPES }
      }
    },
    { $group: { _id: '$user', points: { $sum: '$amount' } } },
    { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
    { $unwind: '$user' },
    { $match: { 'user.isBanned': false } },
    { $sort: { points: -1, _id: 1 } },
    { $limit: limit }
  ]);
}

function isStaleProcessing(award, now = Date.now()) {
  if (award.status !== 'processing') return false;
  if (!award.processingAt) return true;
  return now - new Date(award.processingAt).getTime() >= STALE_PROCESSING_MS;
}

async function settleWeek(week, options = {}) {
  const window = typeof week === 'string' ? parseWeekKey(week) : week;
  if (!window) throw new Error('هفته نامعتبر است.');
  if (window.end > new Date() && options.force !== true) {
    return { status: 'open', weekKey: window.key, results: [] };
  }

  const settings = await Settings.getGlobal();
  if (settings.weeklyLeaderboardEnabled === false && options.force !== true) {
    return { status: 'disabled', weekKey: window.key, results: [] };
  }

  const prizes = (settings.weeklyLeaderboardPrizes || [])
    .slice(0, MAX_PRIZE_RANKS)
    .map(value => Math.floor(Number(value) || 0));
  const standings = await getStandings(window, prizes.length);
  const results = [];

  for (let index = 0; index < standings.length; index += 1) {
    const rank = index + 1;
    const rewardPoints = prizes[index];
    if (rewardPoints <= 0) continue;

    const row = standings[index];
    try {
      const payment = await withMongoTransaction(async session => {
        const existing = await WeeklyLeaderboardAward.findOne({ weekKey: window.key, rank }).session(session);
        if (existing?.status === 'paid') return { status: 'already_paid', user: existing.user };
        if (existing && String(existing.user) !== String(row._id)) {
          throw new Error(`برنده رتبه ${rank} برای هفته ${window.key} قبلاً ثبت شده است.`);
        }
        if (existing?.status === 'processing' && !isStaleProcessing(existing)) {
          return { status: 'processing', user: existing.user };
        }

        const award = await WeeklyLeaderboardAward.findOneAndUpdate(
          { weekKey: window.key, rank },
          {
            $setOnInsert: {
              user: row._id,
              points: rewardPoints,
              status: 'pending'
            }
          },
          { upsert: true, new: true, setDefaultsOnInsert: true, session }
        );

        if (award.status === 'paid') return { status: 'already_paid', user: award.user };
        const effectivePoints = Math.floor(Number(award.points) || rewardPoints);

        const claimed = await WeeklyLeaderboardAward.findOneAndUpdate(
          {
            _id: award._id,
            $or: [
              { status: { $in: ['pending', 'failed'] } },
              { status: 'processing', processingAt: null },
              { status: 'processing', processingAt: { $lt: new Date(Date.now() - STALE_PROCESSING_MS) } }
            ]
          },
          {
            $set: {
              status: 'processing',
              processingAt: new Date(),
              error: ''
            },
            $inc: { attempts: 1 }
          },
          { new: true, session }
        );
        if (!claimed) return { status: 'processing', user: award.user };

        const sourceId = `weekly-leaderboard:${window.key}:${rank}`;
        const existingLedger = await PointsLedger.findOne({ sourceId }).session(session);
        let updatedUser;

        if (existingLedger) {
          if (String(existingLedger.user) !== String(row._id) || Number(existingLedger.amount) !== effectivePoints) {
            throw new Error(`Ledger جایزه رتبه ${rank} با برنده فعلی مطابقت ندارد.`);
          }
          updatedUser = await User.findById(row._id).session(session);
          if (!updatedUser) throw new Error('کاربر برنده پیدا نشد.');
        } else {
          updatedUser = await User.findOneAndUpdate(
            { _id: row._id, isBanned: false },
            { $inc: { points: effectivePoints } },
            { new: true, session }
          );
          if (!updatedUser) throw new Error('کاربر برنده پیدا نشد یا مسدود شده است.');

          await recordLedgerRequired({
            user: updatedUser._id,
            type: 'leaderboard_reward',
            amount: effectivePoints,
            description: `جایزه رتبه ${rank} مسابقه هفتگی ${window.key}`,
            balanceAfter: updatedUser.points,
            sourceId,
            session
          });
        }

        await WeeklyLeaderboardAward.updateOne(
          { _id: claimed._id, status: 'processing' },
          {
            $set: {
              status: 'paid',
              paidAt: new Date(),
              finalizedAt: new Date(),
              winnerPoints: Number(row.points) || 0,
              processingAt: null,
              error: ''
            }
          },
          { session }
        );

        return { status: 'paid', user: updatedUser._id, points: effectivePoints };
      });

      if (payment.status === 'paid' && options.notify !== false && row.user?.telegramId) {
        sendNotificationOnce({
          eventKey: `weekly-reward:${window.key}:${rank}`,
          type: 'weekly_reward',
          user: payment.user,
          telegramId: row.user.telegramId,
          text: botText('leaderboardReward', row.user.language, rank, payment.points, window.key)
        }).catch(error => console.error('Weekly reward notification failed:', error.message || error));
      }

      results.push({ rank, status: payment.status, points: payment.points || rewardPoints, user: payment.user });
    } catch (error) {
      await WeeklyLeaderboardAward.updateOne(
        { weekKey: window.key, rank, status: 'processing' },
        {
          $set: {
            status: 'failed',
            processingAt: null,
            error: String(error.message || error).slice(0, 500)
          }
        }
      ).catch(() => {});
      results.push({ rank, status: 'failed', points: rewardPoints, error: String(error.message || error) });
    }
  }

  const paid = results.filter(item => item.status === 'paid' || item.status === 'already_paid').length;
  return {
    status: results.some(item => item.status === 'failed') ? 'partial' : 'paid',
    weekKey: window.key,
    weekStart: window.start,
    weekEnd: window.end,
    results,
    paidCount: paid
  };
}

async function settleClosedWeeks(options = {}) {
  const previous = previousClosedWeek(options.now || new Date());
  if (!previous) return { status: 'none', results: [] };
  return settleWeek(previous, options);
}

module.exports = {
  POSITIVE_TYPES,
  parseWeekKey,
  previousClosedWeek,
  getStandings,
  settleWeek,
  settleClosedWeeks
};
