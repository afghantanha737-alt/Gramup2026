'use strict';
const assert = require('assert');
const { EventEmitter } = require('events');
const { requestId, startRequest, snapshot } = require('../utils/metrics');

const first = requestId();
const second = requestId();
assert.ok(first.length >= 20);
assert.notStrictEqual(first, second);
const metrics = snapshot();
assert.ok(typeof metrics.uptimeSeconds === 'number');
assert.ok(typeof metrics.requests === 'number');
assert.ok(typeof metrics.completedRequests === 'number');
assert.ok(typeof metrics.memory.rss === 'number');

const req = { headers: {}, method: 'GET' };
const res = new EventEmitter();
res.setHeader = () => {};
res.statusCode = 200;
startRequest(req, res, () => {});
const inFlight = snapshot();
assert.strictEqual(inFlight.requests - metrics.requests, 1);
assert.strictEqual(inFlight.completedRequests, metrics.completedRequests);
assert.strictEqual(inFlight.averageLatencyMs, metrics.averageLatencyMs, 'unfinished work must not dilute average latency');
res.emit('finish');
assert.strictEqual(snapshot().completedRequests, metrics.completedRequests + 1);
console.log('ALL PASS — operations metrics track completed-request latency without in-flight bias');
