'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('public/js/app.js', 'utf8');
const css = fs.readFileSync('public/css/style.css', 'utf8');
const index = fs.readFileSync('public/index.html', 'utf8');
const proof = fs.readFileSync('public/proof.html', 'utf8');
const logo = fs.statSync('public/img/gramup-logo-cube-transparent.png');
const gramLogo = fs.statSync('public/img/gram-token-logo.png');
const usdtLogo = fs.statSync('public/img/ton-usdt-logo.png');
const usdtSource = fs.statSync('assets/ton-usdt-logo-source.png');

assert.match(app, /function tokenIconMarkup\(\)/);
assert.match(app, /src="img\/gramup-logo-cube-transparent\.png"/);
assert.match(app, /function usdtTokenIconMarkup\(\)/);
assert.match(app, /src="img\/ton-usdt-logo\.png"/);
assert.match(app, /function gramTokenIconMarkup\(\)[\s\S]*src="img\/gram-token-logo\.png"/);
assert.match(app, /class="tbWalletIcon tbTokenLogoSurface"><img class="upTokenMark upTokenMarkWallet"/);
assert.match(app, /class="tbWalletIcon tbTokenLogoSurface">\$\{usdtTokenIconMarkup\(\)\}<\/div>/);
assert.match(app, /tbGramWalletIcon">\$\{gramTokenIconMarkup\(\)\}<\/div>/);
assert.match(app, /class="usdtBalanceUnit"/);
assert.doesNotMatch(app, /gramup-official-logo\.jpg/);
assert.ok(usdtLogo.size > 0, 'exact TON USDT logo asset must exist');
assert.strictEqual(usdtLogo.size, usdtSource.size, 'served logo must preserve the supplied asset bytes');
assert.ok(logo.size > 0, 'Gramup cube logo asset must exist');
assert.ok(gramLogo.size > 0, 'official GRAM token logo asset must exist');

assert.match(css, /\.usdtTokenIcon[^}]*object-fit:\s*contain/);
assert.match(css, /\.usdtTokenIcon[^}]*background:\s*#fff/);
assert.match(css, /\.usdtTokenIcon[^}]*border-radius:\s*50%/);
assert.match(css, /\.upTokenMark\s*\{[^}]*background:\s*transparent[^}]*border:\s*0[^}]*border-radius:\s*50%[^}]*box-shadow:\s*none/);
assert.match(css, /\.upTokenIcon\s*\{[^}]*background:\s*transparent[^}]*box-shadow:\s*none/);
assert.match(css, /\.tbWalletIcon\.tbTokenLogoSurface\s*\{[^}]*background:\s*transparent[^}]*box-shadow:\s*none/);
assert.match(css, /\.tbGramWalletIcon \.gramTokenIcon\s*\{[^}]*width:\s*100%[^}]*height:\s*100%/);

assert.match(index, /data-deposit-asset="GRAM"[\s\S]*class="depositAssetLogo" src="img\/gram-token-logo\.png"/);
assert.match(index, /data-deposit-asset="USDT"[\s\S]*class="depositAssetLogo" src="img\/ton-usdt-logo\.png"/);
assert.match(proof, /function tokenIconMarkup\(token\)/);
assert.match(proof, /asset === "GRAM" \? "img\/gram-token-logo\.png" : "img\/ton-usdt-logo\.png"/);
assert.match(proof, /asset === "GRAM" \? "img\/gram-token-logo\.png"/);
assert.match(index, /style\.css\?v=token_logos_20261127_2/);
assert.match(index, /app\.js\?v=token_logos_20261127_2/);
assert.match(proof, /style\.css\?v=token_logos_20261127_2/);
assert.ok(!fs.existsSync('public/img/gramup-official-logo.jpg'), 'replaced legacy Gramup artwork must not remain');

console.log('PASS — exact TON USDT logo is used for currency artwork while Gramup branding remains distinct');
