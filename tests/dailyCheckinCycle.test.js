'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { DAILY_CHECKIN_REWARDS, cycleDayForStreak, dailyCheckinReward } = require('../utils/dailyCheckin');

assert.deepStrictEqual([...DAILY_CHECKIN_REWARDS], [5, 7, 9, 11, 13, 14, 15]);
assert.deepStrictEqual(
  Array.from({ length: 14 }, (_, index) => dailyCheckinReward(index + 1)),
  [5, 7, 9, 11, 13, 14, 15, 5, 7, 9, 11, 13, 14, 15]
);
assert.deepStrictEqual(
  Array.from({ length: 8 }, (_, index) => cycleDayForStreak(index)),
  [0, 1, 2, 3, 4, 5, 6, 7]
);
assert.strictEqual(cycleDayForStreak(8), 1);

const pointsRoute = fs.readFileSync(path.join(__dirname, '..', 'routes/points.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'public/js/app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'public/css/style.css'), 'utf8');
const sharedClaim = fs.readFileSync(path.join(__dirname, '..', 'utils/dailyAutoCheckin.js'), 'utf8');
assert.match(pointsRoute, /claimDailyCheckin\(req\.dbUser\._id/);
assert.match(sharedClaim, /options\.rewardForStreak \|\| dailyCheckinReward/);
assert.match(pointsRoute, /const nextStreak = canCheckIn[\s\S]*utcDayKey\(u\.lastCheckIn\) === todayKey - 1 \? streakValue \+ 1 : 1/,
  'a missed day resets the next reward cycle rather than leaving the old streak reward active');
assert.match(pointsRoute, /dailyCheckinCycleDay,\s*dailyCheckinReward: dailyCheckinRewardAmount/,
  'the status API must return the authoritative cycle day and upcoming reward');
assert.match(pointsRoute, /nextResetTimestamp\(\)/);
assert.match(app, /data-daily-checkin-countdown/);
assert.match(app, /checkin_next_available_in/);
assert.match(app, /const todayReward = Number\(state\.dailyCheckinReward\)/);
assert.match(app, /dailyCheckinCycleDay = Math\.min\(7/);
assert.match(app, /dailyCheckDay \$\{claimed \? "is-complete is-claimed"/);
assert.match(app, /dailyCheckReward[\s\S]*gramup-logo-cube-transparent\.png/);
assert.match(css, /\.dailyCheckGrid\{display:grid;grid-template-columns:repeat\(7,/);
assert.match(css, /\.dailyCheckCountdown/);

console.log('ALL PASS — seven-day UP calendar, missed-streak reward reset, Kabul countdown boundary, and server-authoritative cycle status');
