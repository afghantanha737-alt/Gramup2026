'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pointsRoute = fs.readFileSync(path.join(root, 'routes/points.js'), 'utf8');
const proofPage = fs.readFileSync(path.join(root, 'public/proof.html'), 'utf8');

const routeStart = pointsRoute.indexOf("router.get('/public-history'");
assert.notStrictEqual(routeStart, -1, 'public history route exists');
const routeEnd = pointsRoute.indexOf('\n});', routeStart);
const publicHistoryRoute = pointsRoute.slice(routeStart, routeEnd);

assert.match(publicHistoryRoute, /Withdrawal\.find\(\{ status: 'paid' \}\)/);
assert.match(publicHistoryRoute, /\.limit\(5\)/, 'public payout history is capped to five recent records');
assert.match(publicHistoryRoute, /\.populate\('user', 'firstName username'\)/, 'public payout cards use limited user fields');
assert.match(publicHistoryRoute, /maskPublicPayoutName/);
assert.match(publicHistoryRoute, /Withdrawal\.aggregate\(/, 'all-time totals are calculated by MongoDB');
assert.match(publicHistoryRoute, /total: \{ \$sum: \{ \$ifNull: \['\$cryptoAmount', 0\] \} \}/);
assert.match(publicHistoryRoute, /totalByToken/);
assert.match(proofPage, /data\.totalByToken/);
assert.match(proofPage, /history\.map\(item =>/);
assert.match(proofPage, /5 most recent payments/);
assert.match(proofPage, /proofUser/);
assert.match(proofPage, /formatExactDate/);
assert.match(proofPage, /gram-logo\.svg/);

console.log('PASS — public payouts show five masked, compact recent cards and report all-time totals by token');
