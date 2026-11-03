'use strict';

const { calculateVipAccrual } = require('./vipAccrual');
const { safelySendTelegram } = require('./telegramNotification');
const DAY_MS = 24 * 60 * 60 * 1000;
const STORAGE_FULL_ALERT = '⚠️ Your Gramup Cloud Miner storage is full (24h limit)! Claim your accrued UP now to resume mining.';

function utcDayKey(date = new Date()) {
  return Math.floor(date.getTime() / DAY_MS);
}

function normalizeWebAppUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return ['https:', 'http:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function vipRewardNotificationText() {
  return STORAGE_FULL_ALERT;
}

function storageFullState(subscription, now = new Date()) {
  if (subscription?.status !== 'active') return null;
  const accrual = calculateVipAccrual(subscription, now);
  if (!accrual?.storageFull) return null;
  return {
    subscription,
    accrual,
    storageCapAt: accrual.storageCapAt
  };
}

// Kept as a compatibility helper for admin/tests; the scheduled sweep now
// alerts only when the 24-hour storage cap is reached, never per plan.
function claimReadiness(subscription, now = new Date()) {
  const full = storageFullState(subscription, now);
  if (!full) return null;
  const claimNumber = Math.max(0, Math.floor(Number(subscription.claimsCompleted) || 0)) + 1;
  return {
    claimNumber,
    rewardPoints: full.accrual.rewardPoints,
    principalPoints: full.accrual.principalPoints,
    totalPayoutPoints: full.accrual.unclaimedPoints,
    nextClaimAt: null
  };
}

async function reserveStorageFullNotification(eventKey, leaseUntil, DistributedJobLock) {
  try {
    await DistributedJobLock.create({ _id: eventKey, owner: 'vip-storage-full-notification', leaseUntil });
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
  const fullByUser = new Map();

  for (const subscription of subscriptions) {
    const full = storageFullState(subscription, now);
    if (!full) continue;
    const userId = String(subscription.user);
    const current = fullByUser.get(userId);
    // One user-level alert is enough even if all eight plans are full.
    if (!current || full.storageCapAt < current.storageCapAt) fullByUser.set(userId, full);
  }

  if (!fullByUser.size) return { sent: 0, failed: 0, duplicate: 0, notReady: subscriptions.length, usersFull: 0 };
  const userIds = [...fullByUser.keys()];
  const users = await User.find({ _id: { $in: userIds } }, '_id telegramId').lean();
  const userById = new Map(users.map(user => [String(user._id), user]));
  // Keep the deduplication record for the contract lifetime so a user who
  // remains full is not reminded again until a claim starts a new cap cycle.
  const leaseUntil = new Date(now.getTime() + 100 * DAY_MS);
  const webAppUrl = normalizeWebAppUrl(
    process.env.MINI_APP_PUBLIC_URL || process.env.GRAM_APP_PUBLIC_URL || process.env.PUBLIC_APP_URL
  );
  let sent = 0;
  let failed = 0;
  let duplicate = 0;
  let missingUser = 0;

  for (const [userId, full] of fullByUser.entries()) {
    const user = userById.get(userId);
    if (!user?.telegramId) {
      missingUser += 1;
      continue;
    }
    const cycle = full.storageCapAt instanceof Date ? full.storageCapAt.getTime() : utcDayKey(now);
    const eventKey = `vip-storage-full:${userId}:${cycle}`;
    const reserved = await reserveStorageFullNotification(eventKey, leaseUntil, DistributedJobLock);
    if (!reserved) {
      duplicate += 1;
      continue;
    }
    const options = webAppUrl
      ? { reply_markup: { inline_keyboard: [[{ text: 'Open GramUp', web_app: { url: webAppUrl } }]] } }
      : {};
    const delivered = await safelySendTelegram(
      () => notifyUser(user.telegramId, STORAGE_FULL_ALERT, options),
      { context: 'vip_storage_full_notification' }
    );
    if (delivered) sent += 1;
    else failed += 1;
  }

  return { sent, failed, duplicate, missingUser, totalReady: fullByUser.size, usersFull: fullByUser.size };
}

module.exports = {
  STORAGE_FULL_ALERT,
  claimReadiness,
  storageFullState,
  utcDayKey,
  vipRewardNotificationText,
  runVipRewardNotificationSweep
};
