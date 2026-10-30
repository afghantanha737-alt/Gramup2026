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
assert.match(pointsRoute, /nextResetTimestamp\(\)/);
assert.match(app, /data-daily-checkin-countdown/);
assert.match(app, /checkin_next_available_in/);
assert.match(css, /\.dailyCheckCountdown/);

console.log('ALL PASS — Daily Check cycle rewards, Kabul reset boundary and countdown contract');
