'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { livenessStatus, readinessStatus, createHealthHandlers } = require('../utils/healthStatus');

const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const helper = fs.readFileSync(path.join(root, 'utils/healthStatus.js'), 'utf8');

const live = livenessStatus({ now: new Date('2026-10-30T00:00:00.000Z'), uptimeSeconds: 12.9 });
assert.strictEqual(live.statusCode, 200);
assert.strictEqual(live.body.liveness, 'alive');
assert.strictEqual(live.body.uptime, 12);
assert.ok(!Object.keys(live.body).some(key => /token|secret|password|uri|key/i.test(key)));

const notReady = readinessStatus({ databaseReady: false, transactionReady: true, now: new Date('2026-10-30T00:00:00.000Z') });
assert.strictEqual(notReady.statusCode, 503, 'database-not-ready readiness must be 503');
assert.strictEqual(notReady.body.status, 'not_ready');
const ready = readinessStatus({ databaseReady: true, transactionReady: true });
assert.strictEqual(ready.statusCode, 200);
assert.strictEqual(ready.body.status, 'ready');
const txNotReady = readinessStatus({ databaseReady: true, transactionReady: false });
assert.strictEqual(txNotReady.statusCode, 503);

let calls = 0;
const handlers = createHealthHandlers({
  databaseReady: () => { calls += 1; return false; },
  transactionReady: () => true
});
const responses = [];
const response = {
  status(code) { responses.push(code); return this; },
  json(body) { this.body = body; return this; }
};
handlers.liveness({}, response);
assert.strictEqual(responses[0], 200, 'liveness is public and does not wait for DB');
handlers.readiness({}, response);
assert.strictEqual(responses[1], 503);
assert.strictEqual(calls, 1);

assert.match(helper, /no auth material|secrets/i);
assert.match(helper, /statusCode: ready \? 200 : 503/);
assert.doesNotMatch(helper, /setTimeout|mongoose|fetch\(/);
// Parent owns server.js: this test records the integration contract without editing it.
assert.match(server, /app\.get\('\/api\/health'/);
assert.match(server, /app\.get\('\/api\/ready'/);

console.log('PASS — health helper liveness/readiness semantics are synchronous, secret-free, and parent-mountable');
