'use strict';

const VIP_DISPLAY_NAMES = Object.freeze({
  0: 'Bronze Miner',
  1: 'Silver Miner',
  2: 'Gold Miner',
  3: 'Platinum Miner',
  4: 'Emerald Miner',
  5: 'Sapphire Miner',
  6: 'Ruby Miner',
  7: 'Diamond Miner',
  8: 'Obsidian Miner',
  9: 'Crown Miner',
  10: 'Imperial Miner'
});

function getVipDisplayName(planNumber) {
  const key = Number(planNumber);
  return VIP_DISPLAY_NAMES[key] || `Miner ${Number.isFinite(key) ? key : ''}`.trim();
}

module.exports = { VIP_DISPLAY_NAMES, getVipDisplayName };
