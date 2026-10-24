'use strict';

const { dailyRewardCents, pointsFromCents } = require('./vipRewards');
const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 20;
const BATCH_DELAY_MS = 1100;

function claimReadiness(subscription, now = new Date()) {
  const startAt = new Date(subscription.startAt);
  const endAt = new Date(subscription.endAt);
  const lastClaimAt = subscription.lastClaimAt ? new Date(subscription.lastClaimAt) : null;
  const claimsCompleted = Math.max(0, Math.floor(Number(subscription.claimsCompleted) || 0));
  const durationDays = Math.max(0, Math.floor(Number(subscription.durationDays) || 0));
  const nextClaimAt = lastClaimAt ? new Date(lastClaimAt.getTime() + DAY_MS) : startAt;

  if (subscription.status !== 'active' || now < startAt || now >= endAt || claimsCompleted >= durationDays || now < nextClaimAt) {
    return null;
  }

  const rewardCents = dailyRewardCents(subscription.totalRewardCents, durationDays, claimsCompleted);
  const rewardPoints = pointsFromCents(rewardCents);
  if (!rewardCents || rewardPoints == null) return null;

  return { claimNumber: claimsCompleted + 1, rewardPoints, nextClaimAt };
}

function utcDayKey(date = new Date()) {
  return Math.floor(date.getTime() / DAY_MS);
}

function vipRewardNotificationText(subscription, rewardPoints) {
  const planName = `VIP Plan ${Math.max(1, Number(subscription.planNumber) || 1)}`;
  return `Your VIP reward for ${planName} (${rewardPoints} Points) is ready to claim! Head over to your VIP dashboard and claim your reward.`;
}

async function reserveDailyNotification(eventKey, leaseUntil, DistributedJobLock) {
  try {
    await DistributedJobLock.create({ _id: eventKey, owner: 'vip-reward-notification', leaseUntil });
    return true;
  } catch (error) {
    if (error?.code === 11000) return false;
    throw error;
  }
}

async function runVipRewardNotificationSweep(now = new Date(), dependencies = {}) {
  const VipSubscription = dependencies.VipSubscription || require('../models/VipSubscription');
  const User = dependencies.User || require('../models/User');
  const DistributedJobLock = dependencies.DistributedJobLock || require('../models/DistributedJobLock');
  const notifyUser = dependencies.notifyUser || require('./bot').notifyUser;

  const subscriptions = await VipSubscription.find({ status: 'active', startAt: { $lte: now }, endAt: { $gt: now } }).lean();
  const ready = subscriptions
    .map(subscription => ({ subscription, claim: claimReadiness(subscription, now) }))
    .filter(item => item.claim);

  if (!ready.length) return { sent: 0, failed: 0, duplicate: 0, notReady: subscriptions.length };

  const userIds = [...new Set(ready.map(item => String(item.subscription.user)))];
  const users = await User.find({ _id: { $in: userIds } }, '_id telegramId').lean();
  const userById = new Map(users.map(user => [String(user._id), user]));
  const nextUtcDay = new Date((utcDayKey(now) + 1) * DAY_MS);
  let sent = 0;
  let failed = 0;
  let duplicate = 0;
  let missingUser = 0;

  for (let offset = 0; offset < ready.length; offset += BATCH_SIZE) {
    const batch = ready.slice(offset, offset + BATCH_SIZE);
    await Promise.all(batch.map(async ({ subscription, claim }) => {
      const user = userById.get(String(subscription.user));
      if (!user?.telegramId) {
        missingUser += 1;
        return;
      }

      // A new claim number can be notified on a later day if still unclaimed,
      // while this event key prevents repeated notices during the same UTC day.
      const eventKey = `vip-ready:${subscription._id}:${claim.claimNumber}:${utcDayKey(now)}`;
      const reserved = await reserveDailyNotification(eventKey, nextUtcDay, DistributedJobLock);
      if (!reserved) {
        duplicate += 1;
        return;
      }

      const delivered = await notifyUser(user.telegramId, vipRewardNotificationText(subscription, claim.rewardPoints));
      if (delivered) sent += 1;
      else failed += 1;
    }));
    if (offset + BATCH_SIZE < ready.length) await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
  }

  return { sent, failed, duplicate, missingUser, totalReady: ready.length };
}

module.exports = { claimReadiness, utcDayKey, vipRewardNotificationText, runVipRewardNotificationSweep };
