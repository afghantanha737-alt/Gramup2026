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
assert.ok(!html.includes('gramup-official-logo.jpg'), 'Toncoin diamond logo must not be used as the Gramup brand mark');
assert.match(html, /alt="Official Gramup cube logo"/);
assert.ok((html.match(/<span>Gramup<\/span>/g) || []).length >= 2, 'navbar and footer must show Gramup as one word');
assert.ok(html.includes('https://t.me/Gram_up_bot/app'));
assert.ok(html.includes('https://t.me/GramupOfficialChannel'));
assert.ok(html.includes('https://t.me/GramUpPayouts'));
assert.doesNotMatch(html, /Gramup_bot|https:\/\/t\.me\/Gramup(?:["']|\/)/);
assert.doesNotMatch(html, /12,480|Total UP balance|class="liveBadge"/);
assert.match(html, /App Preview/);
assert.match(html, /2,000\+ active users/);
assert.match(html, /TON &amp; UP rewards/);
assert.match(html, /@media \(max-width: 650px\)/);
assert.match(html, /<details/);
console.log('PASS — Gramup landing page sections, responsive layout, CTA placeholders and FAQ contracts');
