'use strict';

// VIP returns are now continuously accrued and claimed from the VIP Mining hub.
// Keep a no-op export for any already-deployed job runner that still imports it.
async function runVipRewardNotificationSweep() {
  return { sent: 0, failed: 0, duplicate: 0, missingUser: 0, totalReady: 0, disabled: true };
}

module.exports = { runVipRewardNotificationSweep };
