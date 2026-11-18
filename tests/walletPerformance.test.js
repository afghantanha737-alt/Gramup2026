'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const points = fs.readFileSync(path.join(root, 'routes/points.js'), 'utf8');
const withdrawal = fs.readFileSync(path.join(root, 'models/Withdrawal.js'), 'utf8');
const ledger = fs.readFileSync(path.join(root, 'models/PointsLedger.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');

const publicRoute = points.slice(points.indexOf("router.get('/public-history'"));
assert.match(points, /PUBLIC_PAYOUT_CACHE_TTL_MS\s*=\s*45\s*\*\s*1000/);
assert.match(publicRoute, /publicPayoutCache && publicPayoutCache\.expiresAt > Date\.now\(\)/);
assert.match(publicRoute, /public, max-age=30, stale-while-revalidate=15/);
assert.match(publicRoute, /publicPayoutCache = \{ expiresAt: Date\.now\(\) \+ PUBLIC_PAYOUT_CACHE_TTL_MS/);
assert.match(withdrawal, /withdrawalSchema\.index\(\{ user: 1, createdAt: -1 \}\)/);
assert.match(ledger, /pointsLedgerSchema\.index\(\{ user: 1, createdAt: -1 \}\)/);
assert.match(app, /let walletHistoryFetchedAt = 0/);
assert.match(app, /let publicHistoryFetchedAt = 0/);
assert.match(app, /Date\.now\(\) - walletHistoryFetchedAt < CLIENT_DATA_TTL_MS/);
assert.match(app, /Date\.now\(\) - publicHistoryFetchedAt < CLIENT_DATA_TTL_MS/);
assert.match(app, /function hasWarmTabCache\(tab\)/);
assert.match(app, /if \(!warmTab\) showLoading\(\)/);
assert.match(app, /renderWalletHistoryList\(\);/);
assert.match(app, /renderPublicHistoryList\(\);/);

console.log('ALL PASS — Payout Board server cache, wallet/ledger indexes, wallet SWR cache, and warm tab navigation contract');
