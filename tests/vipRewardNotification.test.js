'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runVipRewardNotificationSweep } = require('../utils/vipRewardNotification');

(async () => {
  const result = await runVipRewardNotificationSweep();
  assert.deepStrictEqual(result, { sent: 0, failed: 0, duplicate: 0, missingUser: 0, totalReady: 0, disabled: true });
  const root = path.join(__dirname, '..');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const points = fs.readFileSync(path.join(root, 'routes/points.js'), 'utf8');
  const mining = fs.readFileSync(path.join(root, 'routes/mining.js'), 'utf8');
  assert.doesNotMatch(server, /runVipRewardNotificationSweep|vip-reward-notification-sweep/);
  assert.match(points, /VIP_REWARDS_MOVED_TO_MINING/);
  assert.match(mining, /releaseForPayout\(reserveCentsToRelease, session\)/);
  assert.match(mining, /vipMiningReserveRemainderMicros/);
  console.log('PASS — daily VIP claim reminders are disabled; continuous mining pays within the existing VIP reserve');
})().catch(error => { console.error(error); process.exitCode = 1; });
