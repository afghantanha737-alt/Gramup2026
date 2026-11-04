'use strict';

const { NEW_VIP_POLICY_VERSION, dailyPointsCentsFromBps } = require('./vipPolicy');
const { DAY_MS } = require('./vipRewards');
const MINING_STORAGE_CAP_SECONDS = 24 * 60 * 60;
const MINING_STORAGE_CAP_MS = MINING_STORAGE_CAP_SECONDS * 1000;

function centsFromPoints(points) {
  const value = Number(points);
  if (!Number.isFinite(value) || value < 0) return null;
  const cents = Math.round((value + Number.EPSILON) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

function pointsFromCents(cents) {
  const value = Number(cents);
  if (!Number.isSafeInteger(value) || value < 0) return null;
  return Number((value / 100).toFixed(2));
}

function dateMs(value) {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function elapsedWithinContract(startAt, endAt, now) {
  const start = dateMs(startAt);
  const end = dateMs(endAt);
  const time = dateMs(now);
  if (start == null || end == null || time == null || end <= start) return null;
  return { start, end, now: Math.min(end, Math.max(start, time)), duration: end - start };
}

function cumulativeAccruedCents(totalCents, startAt, endAt, now) {
  const total = Number(totalCents);
  const timing = elapsedWithinContract(startAt, endAt, now);
  if (!Number.isSafeInteger(total) || total < 0 || !timing) return null;
  const elapsed = BigInt(timing.now - timing.start);
  const duration = BigInt(timing.duration);
  return Number((BigInt(total) * elapsed) / duration);
}

function estimatedAccruedPoints(totalCents, paidCents, startAt, endAt, now) {
  const total = Number(totalCents);
  const paid = Number(paidCents);
  const timing = elapsedWithinContract(startAt, endAt, now);
  if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(paid) || paid < 0 || !timing) return null;
  const elapsed = BigInt(timing.now - timing.start);
  const duration = BigInt(timing.duration);
  // A thousandth of a point is ten cents-units. Keep estimates at 0.001
  // Points, while actual credits remain exact to the ledger's 0.01 precision.
  const accruedThousandths = (BigInt(total) * elapsed * 10n) / duration;
  const paidThousandths = BigInt(paid) * 10n;
  const pending = accruedThousandths > paidThousandths ? accruedThousandths - paidThousandths : 0n;
  return Number(pending) / 1000;
}

function calculateVipAccrual(subscription, now = new Date()) {
  const startAt = subscription?.startAt;
  const endAt = subscription?.endAt;
  const timing = elapsedWithinContract(startAt, endAt, now);
  const totalRewardCents = Number(subscription?.totalRewardCents);
  const rewardPaidCents = centsFromPoints(subscription?.claimedRewardPoints || 0);
  if (!timing || !Number.isSafeInteger(totalRewardCents) || totalRewardCents < 0 || rewardPaidCents == null) return null;

  const nowMs = new Date(now).getTime();
  const lastClaimMs = dateMs(subscription?.lastClaimAt);
  const storageAnchorMs = Math.max(timing.start, lastClaimMs == null ? timing.start : lastClaimMs);
  const elapsedSeconds = Math.min(
    Math.max(0, (nowMs - storageAnchorMs) / 1000),
    MINING_STORAGE_CAP_SECONDS
  );
  const storageCapAtMs = Math.min(timing.end, storageAnchorMs + MINING_STORAGE_CAP_MS);
  const accrualNowMs = Math.min(nowMs, timing.end, storageAnchorMs + elapsedSeconds * 1000);
  const accrualNow = new Date(Math.max(timing.start, accrualNowMs));
  const storageFull = nowMs >= storageCapAtMs && nowMs < timing.end;
  const storageRemainingMs = storageFull ? 0 : Math.max(0, storageCapAtMs - nowMs);
  const matured = nowMs >= timing.end;
  const rewardAccruedCents = cumulativeAccruedCents(totalRewardCents, startAt, endAt, accrualNow);
  const isNewPolicy = String(subscription?.policyVersion || '') === NEW_VIP_POLICY_VERSION;

  let totalPrincipalCents = 0;
  let principalPaidCents = centsFromPoints(subscription?.principalPaidPoints || 0);
  if (principalPaidCents == null) return null;
  if (isNewPolicy) {
    const dailyPrincipalCents = dailyPointsCentsFromBps(subscription?.pricePoints, subscription?.principalDailyBps);
    const durationDays = Number(subscription?.durationDays);
    if (!Number.isSafeInteger(dailyPrincipalCents) || dailyPrincipalCents < 0 || !Number.isInteger(durationDays) || durationDays < 1) return null;
    totalPrincipalCents = dailyPrincipalCents * durationDays;
    if (!Number.isSafeInteger(totalPrincipalCents)) return null;
  } else if (!subscription?.principalReturnedAt) {
    totalPrincipalCents = centsFromPoints(subscription?.pricePoints);
    if (totalPrincipalCents == null) return null;
  }

  const principalAccruedCents = isNewPolicy
    ? cumulativeAccruedCents(totalPrincipalCents, startAt, endAt, accrualNow)
    : (matured ? totalPrincipalCents : 0);
  const totalMiningCents = totalRewardCents + (isNewPolicy ? totalPrincipalCents : 0);
  const totalAccruedCents = isNewPolicy
    ? cumulativeAccruedCents(totalMiningCents, startAt, endAt, accrualNow)
    : rewardAccruedCents + (matured ? totalPrincipalCents : 0);
  const rewardPaidAndPrincipalCents = rewardPaidCents + principalPaidCents;
  const totalPendingCents = Math.max(0, totalAccruedCents - rewardPaidAndPrincipalCents);
  let rewardPendingCents = Math.max(0, rewardAccruedCents - rewardPaidCents);
  let principalPendingCents = Math.max(0, principalAccruedCents - principalPaidCents);
  // Round the combined liability once, then assign any residual cent to a
  // remaining reward liability. This prevents split streams from losing a
  // cent whenever each stream is individually below half a cent.
  let residualCents = Math.max(0, totalPendingCents - rewardPendingCents - principalPendingCents);
  const rewardRoomCents = Math.max(0, totalRewardCents - rewardPaidCents - rewardPendingCents);
  const residualRewardCents = Math.min(residualCents, rewardRoomCents);
  rewardPendingCents += residualRewardCents;
  residualCents -= residualRewardCents;
  principalPendingCents += residualCents;
  const estimatedUnclaimedPoints = isNewPolicy
    ? estimatedAccruedPoints(totalMiningCents, rewardPaidAndPrincipalCents, startAt, endAt, accrualNow)
    : Number((Math.max(0, estimatedAccruedPoints(totalRewardCents, rewardPaidCents, startAt, endAt, accrualNow) || 0)
      + (matured ? Math.max(0, totalPrincipalCents - principalPaidCents) / 100 : 0)).toFixed(3));

  const durationDays = Number(subscription?.durationDays);
  const dailyMiningRatePoints = !matured && Number.isFinite(durationDays) && durationDays > 0
    ? Number((totalMiningCents / 100 / durationDays).toFixed(4))
    : 0;
  const rewardRemainingCents = Math.max(0, totalRewardCents - rewardPaidCents);
  const principalRemainingCents = Math.max(0, totalPrincipalCents - principalPaidCents);
  const unclaimedPoints = Number((totalPendingCents / 100).toFixed(2));
  const estimateCapPoints = Number((rewardRemainingCents / 100 + principalRemainingCents / 100).toFixed(2));

  return {
    matured,
    isNewPolicy,
    rewardAccruedCents,
    rewardPendingCents,
    principalAccruedCents,
    principalPendingCents,
    totalPrincipalCents,
    rewardPoints: Number((rewardPendingCents / 100).toFixed(2)),
    principalPoints: Number((principalPendingCents / 100).toFixed(2)),
    unclaimedPoints,
    estimatedUnclaimedPoints,
    unclaimedEstimateCapPoints: Math.max(estimateCapPoints, estimatedUnclaimedPoints),
    dailyMiningRatePoints,
    totalMiningCents,
    storageCapAt: new Date(storageCapAtMs),
    elapsedSeconds,
    storageFull,
    storageRemainingMs,
    rewardRemainingCents,
    principalRemainingCents,
    canClaim: subscription?.status === 'active' && unclaimedPoints >= 0.01
  };
}

function accruedByElapsed(totalCentsPerDay, elapsedMs) {
  const rate = Number(totalCentsPerDay);
  const elapsed = Number(elapsedMs);
  if (!Number.isSafeInteger(rate) || rate < 0 || !Number.isFinite(elapsed) || elapsed < 0) return null;
  const elapsedWholeMs = BigInt(Math.floor(elapsed));
  const cents = (BigInt(rate) * elapsedWholeMs) / BigInt(DAY_MS);
  return Number(cents);
}

module.exports = {
  DAY_MS,
  MINING_STORAGE_CAP_MS,
  MINING_STORAGE_CAP_SECONDS,
  centsFromPoints,
  pointsFromCents,
  cumulativeAccruedCents,
  estimatedAccruedPoints,
  calculateVipAccrual,
  accruedByElapsed
};
