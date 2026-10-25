'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;
const REWARD_BASE_DAYS = 30;
const POINTS_DECIMALS = 2;

function calculateTotalRewardCents(pricePoints, monthlyRewardPercent, durationDays) {
  const price = Number(pricePoints);
  const percent = Number(monthlyRewardPercent);
  const days = Number(durationDays);
  if (!Number.isInteger(price) || price < 1 || !Number.isFinite(percent) || percent <= 0 || percent > 100
    || !Number.isInteger(days) || days < 1 || days > 3650) return null;
  // Percentage is monthly. A 30-day subscription therefore receives price × rate%.
  return Math.round(price * percent * days / REWARD_BASE_DAYS + Number.EPSILON);
}

function dailyRewardCents(totalRewardCents, durationDays, completedClaims) {
  const total = Number(totalRewardCents);
  const days = Number(durationDays);
  const index = Number(completedClaims);
  if (!Number.isInteger(total) || total < 0 || !Number.isInteger(days) || days < 1
    || !Number.isInteger(index) || index < 0 || index >= days) return null;
  // Cumulative rounding distributes remainder cents while guaranteeing an exact total.
  const before = Math.round(total * index / days);
  const after = Math.round(total * (index + 1) / days);
  return after - before;
}

function pointsFromCents(cents) {
  const amount = Number(cents);
  if (!Number.isInteger(amount)) return null;
  return Number((amount / 100).toFixed(POINTS_DECIMALS));
}

function calculateDaysRemaining(endAt, now = new Date()) {
  const remainingMs = new Date(endAt).getTime() - new Date(now).getTime();
  return Math.max(0, Math.ceil(remainingMs / DAY_MS));
}

function calculateDaysCompleted(startAt, durationDays, now = new Date()) {
  const elapsedMs = Math.max(0, new Date(now).getTime() - new Date(startAt).getTime());
  return Math.min(Number(durationDays), Math.floor(elapsedMs / DAY_MS));
}

module.exports = {
  DAY_MS,
  REWARD_BASE_DAYS,
  calculateTotalRewardCents,
  dailyRewardCents,
  pointsFromCents,
  calculateDaysRemaining,
  calculateDaysCompleted
};
