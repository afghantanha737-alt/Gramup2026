'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { getMiningState } = require('../routes/mining');

const root = path.join(__dirname, '..');
const miningSource = fs.readFileSync(path.join(root, 'routes/mining.js'), 'utf8');
const adsSource = fs.readFileSync(path.join(root, 'routes/ads.js'), 'utf8');
const adsCore = fs.readFileSync(path.join(root, 'utils/adsgram.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
const translations = fs.readFileSync(path.join(root, 'public/js/i18n.js'), 'utf8');

const start = new Date('2026-01-01T00:00:00.000Z');
const activeAt = new Date(start.getTime() + 15 * 60 * 1000);
const expiredAt = new Date(start.getTime() + 45 * 60 * 1000);
const user = {
  createdAt: start,
  miningLastClaimAt: start,
  miningLevel: 1,
  miningStorageLevel: 1,
  miningSavedPoints: 0,
  miningBoostExpiresAt: new Date(start.getTime() + 30 * 60 * 1000),
  points: 12,
  totalMinedPoints: 0
};
const active = getMiningState(user, activeAt);
assert.strictEqual(active.isBoosted, true);
assert.strictEqual(active.effectiveRatePerHour, 40);
assert.strictEqual(active.accumulatedPoints, 10, '15 minutes at 2x a 20 points/hour base rate');
assert.strictEqual(active.maxStoragePoints, 60, 'temporary boost does not resize storage');
const expired = getMiningState(user, expiredAt);
assert.strictEqual(expired.isBoosted, false);
assert.strictEqual(expired.accumulatedPoints, 25, 'past boost yield is retained plus normal mining after expiry');
assert.strictEqual(expired.maxStoragePoints, 60, 'storage capacity cannot shrink on boost expiry');

assert.match(miningSource, /withMongoTransaction/);
assert.match(miningSource, /recordLedgerRequired/);
assert.match(miningSource, /MINING_CONFLICT/);
assert.doesNotMatch(miningSource, /PointsLedger\.create\(/, 'mining balance changes must not write ledger outside transaction');
assert.match(adsSource, /ADS_REWARD_CALLBACK_REQUIRED/);
assert.match(adsSource, /grantMiningBoost\(user\._id, 'adsgram'\)/);
assert.match(adsCore, /async function grantMiningBoost/);
assert.match(adsCore, /config\.rewardSecret/);
assert.match(adsCore, /miningBoostExpiresAt: new Date\(now\.getTime\(\) \+ 30 \* 60 \* 1000\)/);
assert.doesNotMatch(client, /api\("\/api\/ads\/mining-boost"/, 'client must not mint a boost directly');
assert.match(client, /state\.ads\.serverRewardMode/);
for (const key of ['mining_hero_kicker', 'mining_hero_desc', 'mining_boost_server_unavailable']) {
  assert.ok((translations.match(new RegExp(`${key}:`, 'g')) || []).length >= 3, `translation missing in one of three languages: ${key}`);
}
console.log('ALL PASS — Mining accrual, stable storage, atomic ledger contract and AdsGram callback verification');
