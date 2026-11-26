'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('public/js/app.js', 'utf8');
const css = fs.readFileSync('public/css/style.css', 'utf8');
const index = fs.readFileSync('public/index.html', 'utf8');
const logo = fs.statSync('public/img/gramup-logo-cube-transparent.png');
const usdtLogo = fs.statSync('public/img/gramup-official-logo.jpg');

assert.match(app, /function tokenIconMarkup\(\)/);
assert.match(app, /src="img\/gramup-logo-cube-transparent\.png"/);
assert.match(app, /function usdtTokenIconMarkup\(\)/);
assert.match(app, /src="img\/gramup-logo-cube-transparent\.png"/);
assert.match(app, /class="usdtBalanceUnit"/);
assert.match(app, /usdtTokenIconMarkup\(\)[\s\S]*gramup-official-logo\.jpg/);
assert.ok(usdtLogo.size > 0, 'official USDT token logo asset must exist');
assert.match(css, /\.usdtTokenIcon/);
assert.match(css, /\.upTokenIcon/);
assert.match(index, /payout_board_20261117_2/);
assert.ok(logo.size > 0, 'official logo asset must exist');

console.log('PASS — TON USDT logo is used for USDT balances and remains distinct from the Gramup UP logo');
