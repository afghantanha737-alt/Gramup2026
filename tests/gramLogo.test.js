'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('public/js/app.js', 'utf8');
const css = fs.readFileSync('public/css/style.css', 'utf8');
const index = fs.readFileSync('public/index.html', 'utf8');
const logo = fs.statSync('public/img/gramup-logo-cube-transparent.png');
const usdtLogo = fs.statSync('public/img/ton-usdt-logo.png');
const usdtSource = fs.statSync('assets/ton-usdt-logo-source.png');

assert.match(app, /function tokenIconMarkup\(\)/);
assert.match(app, /src="img\/gramup-logo-cube-transparent\.png"/);
assert.match(app, /function usdtTokenIconMarkup\(\)/);
assert.match(app, /src="img\/gramup-logo-cube-transparent\.png"/);
assert.match(app, /class="usdtBalanceUnit"/);
assert.match(app, /usdtTokenIconMarkup\(\)[\s\S]*ton-usdt-logo\.png/);
assert.ok(!app.includes('gramup-official-logo.jpg'), 'legacy token artwork must not be used by the app');
assert.ok(usdtLogo.size > 0, 'official TON USDT token logo asset must exist');
assert.ok(usdtSource.size > 0, 'exact user-supplied TON USDT source image must be preserved');
assert.match(css, /\.usdtTokenIcon[^}]*object-fit:\s*contain[^}]*background:\s*transparent/);
assert.match(css, /\.upTokenIcon/);
assert.match(fs.readFileSync('public/proof.html', 'utf8'), /class="usdtTokenIcon" src="img\/ton-usdt-logo\.png"/);
assert.ok(!fs.existsSync('public/img/gramup-official-logo.jpg'), 'replaced legacy token asset must not remain');
assert.match(index, /payout_board_20261117_2/);
assert.ok(logo.size > 0, 'official logo asset must exist');

console.log('PASS — supplied TON USDT logo is used for USDT displays and remains distinct from Gramup branding');
