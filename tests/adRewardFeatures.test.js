'use strict';

const assert = require('assert');
const fs = require('fs');
const {
  DAILY_AD_CAP,
  AD_REWARD_POINTS,
  AD_COOLDOWN_MS,
  MINING_BOOST_MS,
  dailyAdsWatchedToday,
  adCooldownRemainingMs
} = require('../utils/adRewardPolicy');

const now = new Date('2026-11-03T12:00:00.000Z');
assert.strictEqual(DAILY_AD_CAP, 5);
assert.strictEqual(AD_REWARD_POINTS, 5);
assert.strictEqual(AD_COOLDOWN_MS, 60000);
assert.strictEqual(MINING_BOOST_MS, 3600000);
assert.strictEqual(dailyAdsWatchedToday({ dailyAdsWatched: 4, lastAdWatchDate: new Date(now.getTime() - 1000) }, now), 4);
assert.strictEqual(dailyAdsWatchedToday({ dailyAdsWatched: 5, lastAdWatchDate: new Date(now.getTime() - 86400000) }, now), 0,
  'the daily counter resets when the UTC calendar day changes');
assert.strictEqual(adCooldownRemainingMs({ lastAdWatchDate: new Date(now.getTime() - 25000) }, now), 35000);
assert.strictEqual(adCooldownRemainingMs({ lastAdWatchDate: new Date(now.getTime() - 60000) }, now), 0);

const model = fs.readFileSync('models/User.js', 'utf8');
const tasks = fs.readFileSync('routes/tasks.js', 'utf8');
const points = fs.readFileSync('routes/points.js', 'utf8');
const app = fs.readFileSync('public/js/app.js', 'utf8');
const translations = fs.readFileSync('public/js/i18n.js', 'utf8');
const index = fs.readFileSync('public/index.html', 'utf8');
assert.match(model, /dailyAdsWatched:\s*\{ type: Number, default: 0/);
assert.match(model, /lastAdWatchDate:\s*\{ type: Date/);
assert.match(model, /miningBoostExpiresAt:\s*\{ type: Date/);
assert.match(tasks, /router\.post\('\/ad-reward\/claim'/);
assert.match(tasks, /AD_DAILY_LIMIT/);
assert.match(tasks, /AD_COOLDOWN/);
assert.match(points, /router\.post\('\/vip\/mining-boost'/);
assert.match(points, /MINING_BOOST_MS/);
assert.match(app, /function showAd\(\)/);
assert.match(app, /result\?\.done === true/);
assert.match(app, /claimDailyAdReward/);
assert.match(app, /activateMiningBoost/);
assert.match(app, /ad_reward:\s*\{ icon: "🎥" \}/);
assert.strictEqual((translations.match(/history_type_ad_reward:/g) || []).length, 3);
assert.strictEqual((translations.match(/ad_task_title:/g) || []).length, 3);
assert.strictEqual((translations.match(/mining_boost_button:/g) || []).length, 3);
assert.match(index, /sad\.adsgram\.ai\/js\/sad\.min\.js/);
assert.match(index, /v=up_v7_ads/);
assert.doesNotMatch(index, /v=up_v7_phone/);

console.log('PASS — rewarded ad limits, cooldown, persistent fields, endpoints, Adsgram wrapper, and Mine boost controls');
