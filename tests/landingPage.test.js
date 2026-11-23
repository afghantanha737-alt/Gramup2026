'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'landing.html'), 'utf8');
for (const id of ['features', 'how-it-works', 'tokenomics', 'roadmap', 'faq']) {
  assert.match(html, new RegExp(`id="${id}"`), `landing page must include #${id}`);
}
for (const text of ['Earn, Mine &amp; Spin', 'Mining Hub', 'Spin the Wheel', 'Verified Tasks', 'TON Wallet', 'Open Gramup Bot', 'Join Community']) {
  assert.ok(html.includes(text), `landing page must include ${text}`);
}
assert.match(html, /gramup-logo-cube-transparent\.png/);
assert.match(html, /data-bot-link/);
assert.match(html, /https:\/\/t\.me\/Gramup_bot/);
assert.match(html, /PLACEHOLDER/);
assert.match(html, /@media \(max-width: 650px\)/);
assert.match(html, /<details/);
assert.match(html, /loadOfficialBotLink/);
console.log('PASS — Gramup landing page sections, responsive layout, CTA placeholders and FAQ contracts');
