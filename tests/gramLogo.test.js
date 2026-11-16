'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('public/js/app.js', 'utf8');
const css = fs.readFileSync('public/css/style.css', 'utf8');
const index = fs.readFileSync('public/index.html', 'utf8');
const logo = fs.statSync('public/img/gramup-official-logo.jpg');

assert.match(app, /function tokenIconMarkup\(\)/);
assert.match(app, /src="img\/gramup-official-logo\.jpg"/);
assert.match(app, /function gramTokenIconMarkup\(\)/);
assert.match(app, /src="img\/gramup-official-logo\.jpg"/);
assert.match(app, /gramAmountUnit/);
assert.match(app, /class="gramBalanceUnit"/);
assert.doesNotMatch(app, /gramTokenIconMarkup\(\).*gramup-logo-new\.png/);
assert.match(css, /\.gramTokenIcon/);
assert.match(css, /\.upTokenIcon/);
assert.match(index, /payout_board_20261116_10/);
assert.ok(logo.size > 0, 'official logo asset must exist');

console.log('PASS — native GRAM logo is used for GRAM balances and remains distinct from the Gramup UP logo');
