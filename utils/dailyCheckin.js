'use strict';

const DAILY_CHECKIN_REWARDS = Object.freeze([5, 7, 9, 11, 13, 14, 15]);

function cycleDayForStreak(streak) {
  const value = Math.floor(Number(streak));
  if (!Number.isFinite(value) || value <= 0) return 0;
  return ((value - 1) % DAILY_CHECKIN_REWARDS.length) + 1;
}

function dailyCheckinReward(streak) {
  const day = cycleDayForStreak(streak);
  return day > 0 ? DAILY_CHECKIN_REWARDS[day - 1] : DAILY_CHECKIN_REWARDS[0];
}

module.exports = { DAILY_CHECKIN_REWARDS, cycleDayForStreak, dailyCheckinReward };
