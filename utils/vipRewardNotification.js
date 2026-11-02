'use strict';

const { calculateVipAccrual } = require('./vipAccrual');
const { safelySendTelegram } = require('./telegramNotification');
const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 20;
const BATCH_DELAY_MS = 1100;

function claimReadiness(subscription, now = new Date()) {
  if (subscription.status !== 'active') return null;
  const accrual = calculateVipAccrual(subscription, now);
  if (!accrual?.canClaim) return null;
  const claimNumber = Math.max(0, Math.floor(Number(subscription.claimsCompleted) || 0)) + 1;
  return {
    claimNumber,
    rewardPoints: accrual.rewardPoints,
    principalPoints: accrual.principalPoints,
    totalPayoutPoints: accrual.unclaimedPoints,
    nextClaimAt: null
  };
}

function utcDayKey(date = new Date()) {
  return Math.floor(date.getTime() / DAY_MS);
}

function vipRewardNotificationText(subscription, rewardPoints) {
  const planName = `VIP Plan ${Math.max(1, Number(subscription.planNumber) || 1)}`;
  return `Your unclaimed mining balance for ${planName} is ${rewardPoints} Points. Claim it to your wallet any time from the VIP dashboard.`;
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

  const subscriptions = await VipSubscription.find({ status: 'active', startAt: { $lte: now } }).lean();
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

      // At most one reminder is sent per subscription per UTC day.
      const eventKey = `vip-ready:${subscription._id}:${utcDayKey(now)}`;
      const reserved = await reserveDailyNotification(eventKey, nextUtcDay, DistributedJobLock);
      if (!reserved) {
        duplicate += 1;
        return;
      }

      const delivered = await safelySendTelegram(() => notifyUser(user.telegramId, vipRewardNotificationText(subscription, claim.totalPayoutPoints)),
        { context: 'vip_reward_reminder' });
      if (delivered) sent += 1;
      else failed += 1;
    }));
    if (offset + BATCH_SIZE < ready.length) await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
  }

  return { sent, failed, duplicate, missingUser, totalReady: ready.length };
}

module.exports = { claimReadiness, utcDayKey, vipRewardNotificationText, runVipRewardNotificationSweep };
