'use strict';

const { calculateDaysRemaining } = require('./vipRewards');

function effectiveVipStatus(subscription, now = new Date()) {
  const storedStatus = String(subscription?.status || '');
  if (storedStatus === 'cancelled') return 'cancelled';
  if (storedStatus === 'completed') return 'expired';
  if (storedStatus === 'active') {
    const endAt = new Date(subscription?.endAt).getTime();
    return Number.isFinite(endAt) && endAt > new Date(now).getTime() ? 'active' : 'expired';
  }
  return 'unknown';
}

function toVipAdminRecord(subscription, now = new Date()) {
  const user = subscription?.user && typeof subscription.user === 'object' ? subscription.user : {};
  const status = ['active', 'expired', 'cancelled'].includes(subscription?.displayStatus)
    ? subscription.displayStatus
    : effectiveVipStatus(subscription, now);
  const isGram = subscription?.pricingCurrency === 'gram' || Number.isFinite(Number(subscription?.priceGram));
  const expected = Math.max(0, Number(isGram ? subscription?.totalRewardGram : subscription?.totalRewardPoints) || 0);
  const earned = Math.max(0, Number(isGram ? subscription?.claimedRewardGram : subscription?.claimedRewardPoints) || 0);
  const fullName = [user.firstName, user.lastName].map(value => String(value || '').trim()).filter(Boolean).join(' ');
  const remainingDays = status === 'active' ? calculateDaysRemaining(subscription?.endAt, now) : 0;

  return {
    id: String(subscription?._id || ''),
    userId: String(user.telegramId || user._id || ''),
    userMongoId: String(user._id || ''),
    username: String(user.username || ''),
    name: fullName,
    planNumber: Number(subscription?.planNumber) || 0,
    purchaseDate: subscription?.createdAt || null,
    startDate: subscription?.startAt || null,
    expiryDate: subscription?.endAt || null,
    durationDays: Number(subscription?.durationDays) || 0,
    pricingCurrency: isGram ? 'gram' : 'points',
    purchaseAmountGram: isGram ? Number(subscription?.priceGram) || 0 : 0,
    purchaseAmountPoints: !isGram ? Number(subscription?.pricePoints) || 0 : 0,
    monthlyRewardPercent: Number(subscription?.monthlyRewardPercent) || 0,
    dailyEarningGram: isGram ? Number(subscription?.dailyRewardAverageGram) || 0 : 0,
    dailyEarningPoints: !isGram ? Number(subscription?.dailyRewardAveragePoints) || 0 : 0,
    totalExpectedEarningGram: isGram ? expected : 0,
    totalExpectedEarningPoints: !isGram ? expected : 0,
    earnedToDateGram: isGram ? earned : 0,
    earnedToDatePoints: !isGram ? earned : 0,
    remainingEarningGram: isGram ? Math.max(0, expected - earned) : 0,
    remainingEarningPoints: !isGram ? Math.max(0, expected - earned) : 0,
    claimsCompleted: Number(subscription?.claimsCompleted) || 0,
    totalClaims: Number(subscription?.durationDays) || 0,
    status,
    remainingDays
  };
}

module.exports = { effectiveVipStatus, toVipAdminRecord };
