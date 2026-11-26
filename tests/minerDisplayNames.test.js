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
const styles = fs.readFileSync(path.join(__dirname, '..', 'public/css/style.css'), 'utf8');
assert.match(app, /function minerDisplayName\(planNumber\)/);
assert.match(app, /plan\.displayName \|\| minerDisplayName\(plan\.planNumber\)/);
assert.match(app, /subscription\.displayName \|\| minerDisplayName\(subscription\.planNumber\)/);
assert.match(index, /data-tab="vip"[^>]*aria-label="Miners"/);
const minerTab = index.match(/<button[^>]*data-tab="vip"[\s\S]*?<\/button>/)?.[0];
assert.ok(minerTab, 'the Miners navigation tab remains present');
assert.match(minerTab, /class="tabSvg tabSvg--miner"/);
assert.match(minerTab, /<circle cx="18\.1" cy="17\.1" r="2\.45"/, 'the mining pickaxe icon includes its energy core');
assert.match(styles, /\.tabSvg--miner\s*\{[^}]*color:\s*#8792a2;/);
assert.match(styles, /\.bottomNav button\.active \.tabSvg--miner\s*\{[^}]*var\(--aurora-brand-secondary\)[^}]*drop-shadow/s);
assert.match(styles, /html\[data-theme="light"\] \.bottomNav button\.active \.tabSvg--miner\s*\{[^}]*#0891b2[^}]*drop-shadow/s);
assert.doesNotMatch(app, /data-vip-plan="\$\{plan\.displayName/);
console.log('PASS — all VIP plan IDs retain their contracts while the Mini App displays gemstone and metal Miner names');
