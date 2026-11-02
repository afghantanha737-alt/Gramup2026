'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const points = fs.readFileSync(path.join(root, 'routes/points.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
const claimRoute = points.slice(
  points.indexOf("router.post('/vip/:subscriptionId/claim'"),
  points.indexOf("router.post('/vip/:subscriptionId/claim'") + 9000
);

assert.doesNotMatch(server, /settleMaturedVipSubscriptions\(/,
  'startup and timer jobs must never settle user VIP balances');
assert.match(server, /Matured VIP balances settle only through the user's explicit claim action/);
assert.doesNotMatch(points, /settleMaturedVipSubscriptions\(/,
  'VIP catalog reads must not move user funds');
assert.match(claimRoute, /scope: 'vip_partial_claim'/,
  'partial claims must use the idempotency layer');
assert.match(claimRoute, /releaseForPayout\(totalPayoutCents, session\)/,
  'Reserve-backed principal and reward credits must remain transactional');
assert.match(claimRoute, /findOneAndUpdate\(/,
  'the partial claim update must use a compare-and-set subscription update');
assert.match(app, /if \(!readModelActionAllowed\(\)\) return;/,
  'wallet claims must retain fresh-data safeguards');
console.log('PASS — no automatic or read-side settlement; explicit partial claims remain idempotent and transaction-safe');
