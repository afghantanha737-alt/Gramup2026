'use strict';
const crypto = require('crypto');

const startedAt = Date.now();
const state = { requests: 0, completedRequests: 0, errors: 0, byMethod: Object.create(null), byStatus: Object.create(null), totalLatencyMs: 0 };

function requestId() { return crypto.randomUUID(); }
function startRequest(req, res, next) {
  const id = String(req.headers['x-request-id'] || requestId()).slice(0, 100);
  const started = Date.now();
  req.requestId = id;
  res.setHeader('x-request-id', id);
  state.requests += 1;
  state.byMethod[req.method] = (state.byMethod[req.method] || 0) + 1;
  res.on('finish', () => {
    const latency = Date.now() - started;
    state.completedRequests += 1;
    state.totalLatencyMs += latency;
    state.byStatus[res.statusCode] = (state.byStatus[res.statusCode] || 0) + 1;
    if (res.statusCode >= 500) state.errors += 1;
  });
  next();
}
function snapshot() {
  return {
    startedAt: new Date(startedAt).toISOString(),
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    requests: state.requests,
    completedRequests: state.completedRequests,
    errors: state.errors,
    averageLatencyMs: state.completedRequests ? Math.round(state.totalLatencyMs / state.completedRequests) : 0,
    byMethod: { ...state.byMethod },
    byStatus: { ...state.byStatus },
    memory: process.memoryUsage()
  };
}
module.exports = { requestId, startRequest, snapshot };
