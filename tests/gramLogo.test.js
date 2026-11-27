'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('public/js/app.js', 'utf8');
const css = fs.readFileSync('public/css/style.css', 'utf8');
const index = fs.readFileSync('public/index.html', 'utf8');
const proof = fs.readFileSync('public/proof.html', 'utf8');
const logo = fs.statSync('public/img/gramup-logo-cube-transparent.png');
const tetherLogo = fs.statSync('public/img/tether-logo-circle.svg');
const tetherSvg = fs.readFileSync('public/img/tether-logo-circle.svg', 'utf8');
const usdtSource = fs.statSync('assets/ton-usdt-logo-source.png');

assert.match(app, /function tokenIconMarkup\(\)/);
assert.match(app, /src="img\/gramup-logo-cube-transparent\.png"/);
assert.match(app, /function usdtTokenIconMarkup\(\)/);
assert.match(app, /src="img\/tether-logo-circle\.svg"/);
assert.match(app, /class="tbWalletIcon tbTokenLogoSurface"><img class="upTokenMark upTokenMarkWallet"/);
assert.match(app, /class="tbWalletIcon tbTokenLogoSurface">\$\{usdtTokenIconMarkup\(\)\}<\/div>/);
assert.match(app, /tbGramWalletIcon">\$\{gramTokenIconMarkup\(\)\}<\/div>/);
assert.match(app, /<div class="tbWalletValue">\$\{formatNumber\(state\.gramBalance, 9\)\} GRAM<\/div>/);
assert.match(app, /class="usdtBalanceUnit"/);
assert.ok(!app.includes('ton-usdt-logo.png'), 'legacy USDT art must not be used by the app');
assert.ok(!app.includes('gramup-official-logo.jpg'), 'legacy token artwork must not be used by the app');

assert.ok(tetherLogo.size > 0, 'official Tether logo asset must exist');
assert.match(tetherSvg, /<circle class="cls-1" cx="400" cy="400" r="400"\/>/);
assert.doesNotMatch(tetherSvg, /<rect\b/, 'official circular logo should not add a rectangular background');
assert.ok(usdtSource.size > 0, 'exact user-supplied USDT source image must be preserved');
assert.ok(logo.size > 0, 'Gramup cube logo asset must exist');

assert.match(css, /\.usdtTokenIcon[^}]*object-fit:\s*contain[^}]*background:\s*transparent/);
assert.match(css, /\.usdtTokenIcon[^}]*border-radius:\s*50%/);
assert.match(css, /\.upTokenMark\s*\{[^}]*background:\s*transparent[^}]*border:\s*0[^}]*border-radius:\s*50%[^}]*box-shadow:\s*none/);
assert.match(css, /\.upTokenIcon\s*\{[^}]*background:\s*transparent[^}]*box-shadow:\s*none/);
assert.match(css, /\.tbWalletIcon\.tbTokenLogoSurface\s*\{[^}]*background:\s*transparent[^}]*box-shadow:\s*none/);
assert.match(css, /\.tbGramWalletIcon \.gramTokenIcon\s*\{[^}]*width:\s*100%[^}]*height:\s*100%/);

assert.match(index, /class="depositAssetLogo" src="img\/tether-logo-circle\.svg"/);
assert.match(index, /style\.css\?v=token_logos_20261127_1/);
assert.match(index, /app\.js\?v=token_logos_20261127_1/);
assert.ok(!index.includes('ton-usdt-logo.png'), 'deposit selector must not load legacy USDT art');
assert.match(proof, /class="usdtTokenIcon" src="img\/tether-logo-circle\.svg"/);
assert.ok(!proof.includes('ton-usdt-logo.png'), 'payment proofs must not load legacy USDT art');
assert.ok(!fs.existsSync('public/img/gramup-official-logo.jpg'), 'replaced legacy Gramup artwork must not remain');

console.log('PASS — official Tether logo and transparent circular USDT/UP/GRAM treatments are wired consistently');
