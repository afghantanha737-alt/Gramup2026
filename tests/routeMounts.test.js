'use strict';

const assert = require('assert');
const fs = require('fs');

const server = fs.readFileSync('server.js', 'utf8');

for (const [name, prefix] of [
  ['auth', '/api/auth'],
  ['required channels', '/api/required-channels'],
  ['app info', '/api/app-info'],
  ['tasks', '/api/tasks'],
  ['points', '/api/points'],
  ['ads', '/api/ads'],
  ['referral', '/api/referral'],
  ['leaderboard', '/api/leaderboard'],
  ['mobile auth', '/api/mobile-auth'],
  ['admin', '/api/admin'],
  ['maintenance', '/api/maintenance'],
  ['telegram webhook', '/api/telegram']
]) {
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
  assert.match(server, new RegExp(`app\\.use\\(['"]${escapedPrefix}['"]`), `${name} route is not mounted`);
}

console.log('ALL PASS — every application API route is mounted in server.js');
