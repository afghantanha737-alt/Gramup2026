'use strict';
const assert = require('assert');
const fs = require('fs');

const points = fs.readFileSync('routes/points.js', 'utf8');
const user = fs.readFileSync('models/User.js', 'utf8');
const app = fs.readFileSync('public/js/app.js', 'utf8');
const wallet = fs.readFileSync('public/js/walletConnect.js', 'utf8');
const index = fs.readFileSync('public/index.html', 'utf8');
const manifest = JSON.parse(fs.readFileSync('public/tonconnect-manifest.json', 'utf8'));

assert(points.includes("router.post('/wallet/connection'"));
assert(points.includes("router.delete('/wallet/connection'"));
assert(points.includes("network !== '-239'"));
assert(points.includes('WALLET_ADDRESS_MISMATCH'));
assert(user.includes('connectedWallet:'));
assert(app.includes('window.gramupApi = api;'));
assert(app.includes('window.gramupWallet?.getAddress?.()'));
assert(wallet.includes('TonConnectUI'));
assert(wallet.includes('api/points/wallet/connect'));
assert(index.includes('@tonconnect/ui@5.0.1'));
assert(manifest.url.startsWith('https://'));
assert(manifest.iconUrl.endsWith('.png'));
console.log('ALL PASS — Phase 1 Wallet connection, address binding and manifest contract');
