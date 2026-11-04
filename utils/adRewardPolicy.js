'use strict';

const { utcDayKey } = require('./utcDay');

const DAILY_AD_CAP = 5;
const AD_REWARD_POINTS = 5;
const AD_COOLDOWN_MS = 60 * 1000;
const MINING_BOOST_MS = 60 * 60 * 1000;
const MINING_BOOST_PERCENT = 5;

function dailyAdsWatchedToday(user, now = new Date()) {
  const lastWatch = user?.lastAdWatchDate;
  if (!lastWatch || utcDayKey(lastWatch) !== utcDayKey(now)) return 0;
  const count = Math.floor(Number(user?.dailyAdsWatched) || 0);
  return Math.max(0, Math.min(DAILY_AD_CAP, count));
}

function adCooldownRemainingMs(user, now = new Date()) {
  const lastWatchMs = user?.lastAdWatchDate ? new Date(user.lastAdWatchDate).getTime() : NaN;
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(lastWatchMs) || !Number.isFinite(nowMs)) return 0;
  return Math.max(0, lastWatchMs + AD_COOLDOWN_MS - nowMs);
}

module.exports = {
  DAILY_AD_CAP,
  AD_REWARD_POINTS,
  AD_COOLDOWN_MS,
  MINING_BOOST_MS,
  MINING_BOOST_PERCENT,
  dailyAdsWatchedToday,
  adCooldownRemainingMs
};
