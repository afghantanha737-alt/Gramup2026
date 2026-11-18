'use strict';
const assert = require('assert');
const fs = require('fs');

const route = fs.readFileSync('routes/referral.js', 'utf8');
const app = fs.readFileSync('public/js/app.js', 'utf8');
const ledger = fs.readFileSync('models/PointsLedger.js', 'utf8');

assert.match(route, /REFERRAL_CACHE_TTL_MS\s*=\s*45\s*\*\s*1000/);
assert.match(route, /getCachedReferralResponse\(u\._id\)/);
assert.match(route, /setCachedReferralResponse\(u\._id, response\)/);
assert.match(route, /referralResponseCache\.delete\(String\(req\.dbUser\._id\)\)/);
assert.match(ledger, /user: 1, currency: 1, type: 1, createdAt: -1/);

assert.match(app, /buildInstantReferralLink/);
assert.match(app, /startapp=\$\{encodeURIComponent\(telegramId\)\}/);
assert.match(app, /REFERRAL_CLIENT_CACHE_TTL_MS\s*=\s*45\s*\*\s*1000/);
assert.match(app, /const cacheKey = `\$\{REFERRAL_CLIENT_CACHE_KEY\}:\$\{getClientTelegramId\(\) \|\| "anonymous"\}/);
assert.match(app, /applyReferralPayload\(cached\)/);
assert.match(app, /writeReferralClientCache\(data\)/);

console.log('ALL PASS — Referral instant link rendering, per-user SWR cache, backend TTL cache, and ledger index contract');
