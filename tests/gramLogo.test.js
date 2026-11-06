'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('public/js/app.js', 'utf8');
const css = fs.readFileSync('public/css/style.css', 'utf8');
const index = fs.readFileSync('public/index.html', 'utf8');
const logo = fs.readFileSync('public/img/gram-logo.svg', 'utf8');

assert.match(app, /function gramTokenIconMarkup\(\)/);
assert.match(app, /src="img\/gram-logo\.svg"/);
assert.match(app, /class="gramAmountUnit"/);
assert.match(app, /class="gramBalanceUnit"/);
assert.doesNotMatch(app, /gramTokenIconMarkup\(\).*gramup-logo-new\.png/);
assert.match(css, /\.gramTokenIcon/);
assert.match(index, /style\.css\?v=up_v28_20261106_4/);
assert.match(logo, /<title[^>]*>GRAM<\/title>/);

console.log('PASS — native GRAM logo is used for GRAM balances and remains distinct from the Gramup UP logo');
