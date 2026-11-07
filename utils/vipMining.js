'use strict';

const SECONDS_PER_DAY = 86400;
const MICRO_UNITS_PER_POINT = 1000000;
const MICRO_UNITS_PER_CENT = 10000;
const ACTIVE_STATUSES = new Set(['active', 'completed']);

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function safeMicros(points) {
  const value = Number(points);
  if (!Number.isFinite(value) || value <= 0) return 0;
  const micros = Math.round(value * MICRO_UNITS_PER_POINT);
  return Number.isSafeInteger(micros) ? micros : 0;
}

function ceilDiv(numerator, denominator) {
  return denominator > 0n ? (numerator + denominator - 1n) / denominator : 0n;
}

function isVipMiningEligible(subscription) {
  if (!ACTIVE_STATUSES.has(subscription?.status)) return false;
  const durationDays = Number(subscription?.durationDays) || 0;
  const claimsCompleted = Number(subscription?.claimsCompleted) || 0;
  if (durationDays > 0 && claimsCompleted >= durationDays) return false;
  const liabilityCents = Number(subscription?.reserveLiabilityCents) || 0;
  const paidCents = Number(subscription?.reservePaidCents) || 0;
  if (liabilityCents > 0 && paidCents >= liabilityCents) return false;
  return true;
}

function getVipMiningDailyRatePoints(subscription) {
  const pricePoints = finiteNonNegative(subscription?.pricePoints);
  const principalBps = finiteNonNegative(subscription?.principalDailyBps);
  const rewardBps = finiteNonNegative(subscription?.rewardDailyBps);
  const totalBps = principalBps + rewardBps;
  if (pricePoints > 0 && totalBps > 0) return pricePoints * totalBps / 10000;

  const totalRewardPoints = finiteNonNegative(subscription?.totalRewardPoints);
  const durationDays = Math.max(1, Number(subscription?.durationDays) || 1);
  if (totalRewardPoints > 0) return totalRewardPoints / durationDays;

  const legacyDailyAverage = finiteNonNegative(subscription?.dailyRewardAveragePoints);
  if (legacyDailyAverage > 0) return legacyDailyAverage;

  const monthlyRewardPercent = finiteNonNegative(subscription?.monthlyRewardPercent);
  if (pricePoints > 0 && monthlyRewardPercent > 0) {
    return pricePoints * monthlyRewardPercent / 100 / durationDays;
  }
  return 0;
}

function getVipMiningDailyRateCents(subscription) {
  return Math.max(0, Math.round(getVipMiningDailyRatePoints(subscription) * 100));
}

function calculateVipSubscriptionAccrual(subscription, now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const startMs = new Date(subscription?.startAt || 0).getTime();
  const endMs = new Date(subscription?.endAt || 0).getTime();
  const durationDays = Math.max(1, Number(subscription?.durationDays) || 1);
  const dailyRatePoints = getVipMiningDailyRatePoints(subscription);
  const dailyRateCents = getVipMiningDailyRateCents(subscription);
  const validRange = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs;
  const accrualNowMs = validRange ? Math.min(nowMs, endMs) : nowMs;
  const elapsedSeconds = validRange && accrualNowMs > startMs
    ? Math.max(0, Math.floor((accrualNowMs - startMs) / 1000))
    : 0;
  const liabilityCents = Math.max(0, Number(subscription?.reserveLiabilityCents) || 0);
  const totalRewardCents = Math.max(0, Number(subscription?.totalRewardCents) || 0);
  let targetNumerator;
  let targetDenominator;
  let totalLiabilityMicros;

  if (liabilityCents > 0 && Number.isSafeInteger(liabilityCents)) {
    targetNumerator = BigInt(dailyRateCents) * BigInt(MICRO_UNITS_PER_CENT) * BigInt(elapsedSeconds);
    targetDenominator = BigInt(SECONDS_PER_DAY);
    totalLiabilityMicros = liabilityCents * MICRO_UNITS_PER_CENT;
  } else if (totalRewardCents > 0 && Number.isSafeInteger(totalRewardCents)) {
    targetNumerator = BigInt(totalRewardCents) * BigInt(MICRO_UNITS_PER_CENT) * BigInt(elapsedSeconds);
    targetDenominator = BigInt(durationDays) * BigInt(SECONDS_PER_DAY);
    totalLiabilityMicros = totalRewardCents * MICRO_UNITS_PER_CENT;
  } else {
    const dailyRateMicros = safeMicros(dailyRatePoints);
    targetNumerator = BigInt(dailyRateMicros) * BigInt(elapsedSeconds);
    targetDenominator = BigInt(SECONDS_PER_DAY);
    totalLiabilityMicros = safeMicros(subscription?.totalRewardPoints);
  }

  const targetMicros = targetDenominator > 0n
    ? Number(targetNumerator / targetDenominator)
    : 0;
  const miningPaidMicrosRaw = Number(subscription?.vipMiningPaidMicros) || 0;
  const miningPaidMicros = Number.isSafeInteger(miningPaidMicrosRaw) && miningPaidMicrosRaw > 0
    ? miningPaidMicrosRaw
    : 0;
  let previousPayoutMicros;
  if (liabilityCents > 0) {
    const reservePaidCents = Math.max(0, Number(subscription?.reservePaidCents) || 0);
    const alreadyReleasedByMiningCents = Math.floor(miningPaidMicros / MICRO_UNITS_PER_CENT);
    const previouslyScheduledPaidCents = Math.max(0, reservePaidCents - alreadyReleasedByMiningCents);
    previousPayoutMicros = previouslyScheduledPaidCents * MICRO_UNITS_PER_CENT + miningPaidMicros;
  } else {
    previousPayoutMicros = safeMicros(subscription?.claimedRewardPoints) + miningPaidMicros;
  }

  let remainingMicros = totalLiabilityMicros > 0
    ? Math.max(0, totalLiabilityMicros - previousPayoutMicros)
    : Number.MAX_SAFE_INTEGER;
  let earnedMicros = Math.max(0, targetMicros - previousPayoutMicros);
  earnedMicros = Math.min(earnedMicros, remainingMicros);
  if (validRange && nowMs >= endMs && totalLiabilityMicros > 0) {
    // At maturity, settle any final rounding remainder without changing the total contract liability.
    earnedMicros = remainingMicros;
  }

  const active = subscription?.status === 'active'
    && validRange && startMs <= nowMs && nowMs < endMs;
  let nextAccrualAt = null;
  if (active && targetDenominator > 0n && previousPayoutMicros > 0 && earnedMicros === 0) {
    let secondsUntilPaidOffsetIsRecovered;
    if (liabilityCents > 0) {
      const dailyMicros = BigInt(dailyRateCents) * BigInt(MICRO_UNITS_PER_CENT);
      secondsUntilPaidOffsetIsRecovered = Number(ceilDiv(BigInt(previousPayoutMicros) * BigInt(SECONDS_PER_DAY), dailyMicros));
    } else if (totalRewardCents > 0) {
      const totalMicros = BigInt(totalRewardCents) * BigInt(MICRO_UNITS_PER_CENT);
      const denominator = totalMicros;
      secondsUntilPaidOffsetIsRecovered = Number(ceilDiv(BigInt(previousPayoutMicros) * BigInt(durationDays) * BigInt(SECONDS_PER_DAY), denominator));
    } else {
      const dailyMicros = BigInt(safeMicros(dailyRatePoints));
      secondsUntilPaidOffsetIsRecovered = Number(ceilDiv(BigInt(previousPayoutMicros) * BigInt(SECONDS_PER_DAY), dailyMicros));
    }
    nextAccrualAt = new Date(Math.max(nowMs, startMs + secondsUntilPaidOffsetIsRecovered * 1000));
  } else if (active) {
    nextAccrualAt = new Date(nowMs);
  }

  return {
    active,
    dailyRateCents,
    dailyRate: dailyRatePoints,
    elapsedSeconds,
    earnedMicros,
    earnedPoints: earnedMicros / MICRO_UNITS_PER_POINT,
    remainder: 0,
    accrualUntil: new Date(Math.max(startMs, accrualNowMs)),
    nextAccrualAt,
    startAt: validRange ? new Date(startMs) : null,
    endAt: validRange ? new Date(endMs) : null
  };
}

function calculateVipMiningStatus(subscriptions, now = new Date()) {
  const nowDate = now instanceof Date ? now : new Date(now);
  let totalAccruedMicros = 0;
  let pendingCompletedMicros = 0;
  let activeDailyRate = 0;
  const activeMiners = [];

  for (const subscription of Array.isArray(subscriptions) ? subscriptions : []) {
    if (!isVipMiningEligible(subscription)) continue;
    const accrual = calculateVipSubscriptionAccrual(subscription, nowDate);
    totalAccruedMicros += accrual.earnedMicros;
    const durationMs = accrual.startAt && accrual.endAt
      ? Math.max(0, accrual.endAt.getTime() - accrual.startAt.getTime())
      : 0;
    const remainingMs = accrual.active && accrual.endAt
      ? Math.max(0, Math.min(durationMs, accrual.endAt.getTime() - nowDate.getTime()))
      : 0;
    const daysRemaining = accrual.active ? Math.ceil(remainingMs / (SECONDS_PER_DAY * 1000)) : 0;
    const remainingPercent = accrual.active && durationMs > 0
      ? Math.max(0, Math.min(100, Math.round(remainingMs / durationMs * 100)))
      : 0;
    const miner = {
      id: String(subscription._id || subscription.id || ''),
      planNumber: Number(subscription.planNumber) || 0,
      dailyRate: accrual.dailyRate,
      dailyRateCents: accrual.dailyRateCents,
      durationDays: Math.max(1, Number(subscription.durationDays) || 1),
      daysRemaining,
      remainingPercent,
      startAt: accrual.startAt?.toISOString() || null,
      endAt: accrual.endAt?.toISOString() || null,
      nextAccrualAt: accrual.nextAccrualAt?.toISOString() || null,
      accruedPoints: accrual.earnedPoints
    };
    if (accrual.active) {
      activeMiners.push(miner);
      activeDailyRate += accrual.dailyRate;
    } else {
      pendingCompletedMicros += accrual.earnedMicros;
    }
  }

  return {
    activeMinerCount: activeMiners.length,
    dailyRate: activeDailyRate,
    hourlyRate: activeDailyRate / 24,
    perSecondRate: activeDailyRate / SECONDS_PER_DAY,
    accruedMicros: totalAccruedMicros,
    accruedPoints: totalAccruedMicros / MICRO_UNITS_PER_POINT,
    pendingCompletedPoints: pendingCompletedMicros / MICRO_UNITS_PER_POINT,
    activeMiners,
    serverNow: nowDate.toISOString()
  };
}

module.exports = {
  SECONDS_PER_DAY,
  MICRO_UNITS_PER_POINT,
  MICRO_UNITS_PER_CENT,
  ACTIVE_STATUSES,
  isVipMiningEligible,
  getVipMiningDailyRatePoints,
  getVipMiningDailyRateCents,
  calculateVipSubscriptionAccrual,
  calculateVipMiningStatus
};
