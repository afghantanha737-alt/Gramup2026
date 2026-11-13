'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '..', 'public/js/app.js'), 'utf8');
const start = app.indexOf('function vipMinerRemainingValues(');
const end = app.indexOf('\nfunction tickVipMiningConsole()', start);
assert.ok(start >= 0 && end > start, 'live miner progress calculator exists');
const context = { state: { vipServerOffsetMs: 0 } };
vm.createContext(context);
vm.runInContext(`${app.slice(start, end)}\nglobalThis.calculateRemaining = vipMinerRemainingValues;`, context);

const startAt = Date.parse('2026-11-01T00:00:00.000Z');
const endAt = startAt + 100 * 86400000;
const miner = { startAt: new Date(startAt).toISOString(), endAt: new Date(endAt).toISOString() };
const atStart = context.calculateRemaining(miner, startAt);
assert.equal(atStart.daysRemaining, 100);
assert.equal(atStart.remainingPercent, 100);
const atHalf = context.calculateRemaining(miner, startAt + 50 * 86400000);
assert.equal(atHalf.daysRemaining, 50);
assert.equal(atHalf.remainingPercent, 50);
const atEnd = context.calculateRemaining(miner, endAt);
assert.equal(atEnd.daysRemaining, 0);
assert.equal(atEnd.remainingPercent, 0);

assert.ok(app.includes('formatNumber(miner.dailyRate, 2)} UP/day'));
assert.match(app, /data-vip-miner-days/);
assert.match(app, /data-vip-miner-percent/);
assert.match(app, /data-vip-miner-progress/);
assert.match(app, /tickVipMiningConsole\(\)/);
assert.match(app, /setInterval\(\(\) => \{\s*void loadVipMiningStatus\(\{ force: true \}\)\.then\(tickVipMiningConsole\);\s*\}, 60000\)/);
console.log('PASS — VIP miner progress counts down days and remaining percentage from full term to expiry');
