'use strict';
const assert = require('assert');
const http = require('http');
const express = require('express');
const mongoose = require('mongoose');

const dbUserId = new mongoose.Types.ObjectId();
const pipelineCalls = [];
const stubs = [
  ['../utils/unifiedAuth', { requireUnifiedAuth: () => (req, res, next) => { req.dbUser = { _id: dbUserId, points: 0 }; next(); } }],
  ['../utils/membership', { withMembership: middleware => middleware }],
  ['../models/User', {}],
  ['../models/PointsLedger', { aggregate: async pipeline => {
    pipelineCalls.push(pipeline);
    if (pipeline.at(-1)?.$count) return [{ count: 0 }];
    if (pipeline.length === 2) return [{ points: 50 }];
    return [{ _id: dbUserId, points: 50, user: { firstName: 'Eligible', isBanned: false } }];
  } }],
  ['../models/Settings', { getGlobal: async () => ({ weeklyLeaderboardEnabled: true, weeklyLeaderboardPrizes: [100, 50, 25] }) }],
  ['../utils/weeklyLeaderboard', { startOfUtcWeek: () => new Date('2026-10-26T00:00:00.000Z'), endOfUtcWeek: () => new Date('2026-11-02T00:00:00.000Z'), weekKey: () => '2026-10-26' }],
  ['../utils/weeklyLeaderboardSettlement', { settleClosedWeeks: async () => {}, POSITIVE_TYPES: ['task', 'checkin'] }]
];
for (const [request, exports] of stubs) {
  const resolved = require.resolve(request);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const app = express();
app.use('/api/leaderboard', require('../routes/leaderboard'));
function get(path) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const req = http.get({ host: '127.0.0.1', port: server.address().port, path }, response => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { body += chunk; });
        response.on('end', () => server.close(error => error ? reject(error) : resolve({ status: response.statusCode, body: JSON.parse(body) })));
      });
      req.on('error', error => server.close(() => reject(error)));
    });
    server.on('error', reject);
  });
}

(async () => {
  const response = await get('/api/leaderboard/weekly');
  assert.strictEqual(response.status, 200);
  assert.strictEqual(response.body.top[0].rank, 1);
  assert.strictEqual(pipelineCalls.length, 3, 'weekly display computes top, personal total, and rank-above pipelines');
  const top = pipelineCalls[0];
  const topBannedFilter = top.findIndex(stage => stage.$match?.['user.isBanned'] === false);
  const topSort = top.findIndex(stage => stage.$sort);
  const topLimit = top.findIndex(stage => stage.$limit === 50);
  assert.ok(topBannedFilter > -1 && topBannedFilter < topSort && topSort < topLimit, 'eligible accounts are filtered before sort and top-50 limit');
  const above = pipelineCalls[2];
  const aboveBannedFilter = above.findIndex(stage => stage.$match?.['user.isBanned'] === false);
  const aboveRankFilter = above.findIndex(stage => Array.isArray(stage.$match?.$or));
  assert.ok(aboveBannedFilter > -1 && aboveBannedFilter < aboveRankFilter, 'banned accounts do not inflate the personal rank');
  console.log('PASS — weekly leaderboard display filters ineligible accounts before ranking and rank counting');
})().catch(error => { console.error(error); process.exitCode = 1; });
