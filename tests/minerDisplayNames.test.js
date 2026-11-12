'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { getVipDisplayName, VIP_DISPLAY_NAMES } = require('../utils/vipDisplayNames');

const expected = [
  'Bronze Miner', 'Silver Miner', 'Gold Miner', 'Platinum Miner',
  'Emerald Miner', 'Sapphire Miner', 'Ruby Miner', 'Diamond Miner',
  'Obsidian Miner', 'Crown Miner', 'Imperial Miner'
];

assert.deepStrictEqual(Object.values(VIP_DISPLAY_NAMES), expected);
expected.forEach((name, planNumber) => assert.strictEqual(getVipDisplayName(planNumber), name));

const app = fs.readFileSync(path.join(__dirname, '..', 'public/js/app.js'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '..', 'public/index.html'), 'utf8');
assert.match(app, /function minerDisplayName\(planNumber\)/);
assert.match(app, /plan\.displayName \|\| minerDisplayName\(plan\.planNumber\)/);
assert.match(app, /subscription\.displayName \|\| minerDisplayName\(subscription\.planNumber\)/);
assert.match(index, /data-tab="vip"[^>]*aria-label="Miners"/);
assert.doesNotMatch(app, /data-vip-plan="\$\{plan\.displayName/);

console.log('PASS — all VIP plan IDs retain their contracts while the Mini App displays gemstone and metal Miner names');
