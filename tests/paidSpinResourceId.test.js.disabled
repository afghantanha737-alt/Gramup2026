'use strict';

const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync(require.resolve('../routes/points'), 'utf8');
const freeRoute = source.slice(source.indexOf("router.post('/spin'"), source.indexOf("router.post('/spin/paid'"));
const paidRoute = source.slice(source.indexOf("router.post('/spin/paid'"), source.indexOf("router.post('/exchange'"));

assert.match(freeRoute, /resourceId:\s*null/);
assert.match(paidRoute, /resourceId:\s*null/);
assert.doesNotMatch(freeRoute, /resourceId:\s*sourceId/);
assert.doesNotMatch(paidRoute, /resourceId:\s*rewardSourceId/);
assert.match(paidRoute, /scope: 'spin_paid'/);
assert.match(paidRoute, /type: 'spin_paid'/);

const i18n = fs.readFileSync(require.resolve('../public/js/i18n.js'), 'utf8');
assert.match(i18n, /SPIN_PAYMENT_UNAVAILABLE:/);

console.log('PASS — free and paid spin do not persist Ledger journal strings into ObjectId resourceId');
