'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const points = fs.readFileSync(path.join(root, 'routes/points.js'), 'utf8');
const mining = fs.readFileSync(path.join(root, 'routes/mining.js'), 'utf8');
const settlement = fs.readFileSync(path.join(root, 'utils/vipSettlement.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
const claimRouteStart = points.indexOf("router.post('/vip/:subscriptionId/claim'");
const claimRoute = points.slice(claimRouteStart, points.indexOf("/**\n * GET /api/points/history", claimRouteStart));

assert.ok(claimRouteStart >= 0);
assert.match(claimRoute, /VIP_REWARDS_MOVED_TO_MINING/);
assert.doesNotMatch(claimRoute, /scope: 'vip_daily_claim'|releaseForPayout\(/);
assert.doesNotMatch(server, /runVipRewardNotificationSweep|vip-reward-notification-sweep/);
assert.match(settlement, /policyVersion: \{ \$in: \[null, 'legacy_v1'\] \}/,
  'automatic maturity settlement remains limited to legacy principal-only contracts');
assert.match(mining, /executeIdempotently/);
assert.match(mining, /releaseForPayout\(reserveCentsToRelease, session\)/,
  'new-policy miner payouts release their reserved liability transactionally');
assert.match(mining, /findOneAndUpdate\(subscriptionFilter, subscriptionUpdate/,
  'mining claims use a compare-and-set subscription update');
assert.match(mining, /recordLedgerRequired\([\s\S]*type: 'mining_claim'/);
assert.match(app, /if \(!readModelActionAllowed\(\) \|\| vipMiningClaimBusy\) return;/,
  'wallet claims retain fresh-data safeguards');
assert.doesNotMatch(app, /function claimAllVipRewards\(\)|function claimVipReward\(/);
console.log('PASS — VIP payouts use idempotent mining claims, reserve-backed transactions, and no scheduled daily claim flow');
