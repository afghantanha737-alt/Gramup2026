'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/css/style.css'), 'utf8');
const miningRoute = fs.readFileSync(path.join(root, 'routes/mining.js'), 'utf8');
const vipConsoleStart = app.indexOf('function renderVipMiningConsole()');
const vipConsoleEnd = app.indexOf('\nfunction renderProfileVip()', vipConsoleStart);
assert.ok(vipConsoleStart >= 0 && vipConsoleEnd > vipConsoleStart, 'VIP mining console renderer exists');
const consoleMarkup = app.slice(vipConsoleStart, vipConsoleEnd);
for (const pattern of [
  /vipMiningConsole/,
  /data-vip-miner-count/,
  /data-vip-mining-earned/,
  /data-vip-mining-second/,
  /vip_mining_claim/,
  /claimVipMining\(\)/,
  /gramup-logo-cube-transparent\.png/,
  /vip_mining_empty/
]) assert.match(consoleMarkup, pattern);
assert.match(app, /vipMiningDailyRate|plan\.miningDailyRate/);
assert.match(app, /vipCatalogMarkup/);
assert.match(app, /if \(tab === "mine"\) tab = "vip"/);
assert.doesNotMatch(html, /data-tab="mine"/);
assert.match(css, /\.vipMiningConsole\s*\{/);
assert.match(css, /\.vipPlanMiningRate\s*\{/);
assert.match(miningRoute, /VIP_MINING_PURCHASE_REQUIRED/);
assert.match(miningRoute, /VIP_MINING_PACKAGES_ONLY/);
assert.doesNotMatch(`${app}\n${html}`, /Lucky Spin|luckySpinPage|spinWheel|data-tab=["']spin/i);
console.log('PASS — VIP owns the live console, package rates, wallet claim, and no standalone Mine tab/free start path');
