'use strict';
const DAY_MS = 24 * 60 * 60 * 1000;
const REWARD_BASE_DAYS = 30;
const POINTS_DECIMALS = 2;
const GRAM_DECIMALS = 6;
const GRAM_SCALE = 10 ** GRAM_DECIMALS;
function calculateTotalRewardCents(pricePoints, monthlyRewardPercent, durationDays) {
  const price = Number(pricePoints), percent = Number(monthlyRewardPercent), days = Number(durationDays);
  if (!Number.isInteger(price) || price < 1 || !Number.isFinite(percent) || percent <= 0 || percent > 100 || !Number.isInteger(days) || days < 1 || days > 3650) return null;
  return Math.round(price * percent * days / REWARD_BASE_DAYS + Number.EPSILON);
}
function dailyRewardCents(totalRewardCents, durationDays, completedClaims) {
  const total = Number(totalRewardCents), days = Number(durationDays), index = Number(completedClaims);
  if (!Number.isInteger(total) || total < 0 || !Number.isInteger(days) || days < 1 || !Number.isInteger(index) || index < 0 || index >= days) return null;
  return Math.round(total * (index + 1) / days) - Math.round(total * index / days);
}
function calculateTotalRewardMicros(priceGram, monthlyRewardPercent, durationDays) {
  const price = Number(priceGram), percent = Number(monthlyRewardPercent), days = Number(durationDays);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(percent) || percent <= 0 || percent > 100 || !Number.isInteger(days) || days < 1 || days > 3650) return null;
  return Math.round(price * GRAM_SCALE * percent * days / REWARD_BASE_DAYS / 100 + Number.EPSILON);
}
function dailyRewardMicros(totalRewardMicros, durationDays, completedClaims) {
  const total = Number(totalRewardMicros), days = Number(durationDays), index = Number(completedClaims);
  if (!Number.isInteger(total) || total < 0 || !Number.isInteger(days) || days < 1 || !Number.isInteger(index) || index < 0 || index >= days) return null;
  return Math.round(total * (index + 1) / days) - Math.round(total * index / days);
}
function gramFromMicros(micros) {
  const value = Number(micros);
  return Number.isInteger(value) && value >= 0 ? Number((value / GRAM_SCALE).toFixed(GRAM_DECIMALS)) : null;
}
function pointsFromCents(cents) { const amount = Number(cents); return Number.isInteger(amount) ? Number((amount / 100).toFixed(POINTS_DECIMALS)) : null; }
function calculateDaysRemaining(endAt, now = new Date()) { return Math.max(0, Math.ceil((new Date(endAt).getTime() - new Date(now).getTime()) / DAY_MS)); }
function calculateDaysCompleted(startAt, durationDays, now = new Date()) { return Math.min(Number(durationDays), Math.floor(Math.max(0, new Date(now).getTime() - new Date(startAt).getTime()) / DAY_MS)); }
module.exports = { DAY_MS, REWARD_BASE_DAYS, GRAM_SCALE, calculateTotalRewardCents, dailyRewardCents, calculateTotalRewardMicros, dailyRewardMicros, gramFromMicros, pointsFromCents, calculateDaysRemaining, calculateDaysCompleted };
