'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const adminRoutes = fs.readFileSync(path.join(root, 'routes/admin.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(root, 'public/admin.html'), 'utf8');

assert.match(adminRoutes, /function connectedWalletAddress\(user\)/);
assert.match(adminRoutes, /connectedWalletAddress: connectedWalletAddress\(row\)/);
assert.match(adminRoutes, /'connectedWallet\.address': regex/);
assert.match(adminRoutes, /'connectedWallet\.canonicalAddress': regex/);
assert.match(adminRoutes, /router\.get\('\/deposits'/);
assert.match(adminRoutes, /walletAddressSnapshot: regex/);
assert.match(adminRoutes, /sourceAddress: regex/);
assert.match(adminRoutes, /populate\('user', 'telegramId username firstName walletAddress connectedWallet'\)/);
assert.match(adminRoutes, /populate\('user', 'firstName username telegramId walletAddress connectedWallet'\)/);
assert.match(adminRoutes, /connectedWalletAddress: userWallet/);
assert.match(adminRoutes, /user: publicAdminUser\(user\)/);

assert.match(adminHtml, /function walletAddressValue\(item\)/);
assert.match(adminHtml, /function walletMarkup\(address/);
assert.match(adminHtml, /https:\/\/tonviewer\.com\/\$\{encodeURIComponent\(value\)\}/);
assert.match(adminHtml, /target="_blank" rel="noopener noreferrer"/);
assert.match(adminHtml, /copyAddress\('\$\{jsValue\}', this\)/);
assert.match(adminHtml, /Not Connected/);
assert.match(adminHtml, /withdrawSearch/);
assert.match(adminHtml, /depositSearch/);
assert.match(adminHtml, /debouncedLoadWithdrawals/);
assert.match(adminHtml, /debouncedLoadDeposits/);
assert.match(adminHtml, /walletMarkup\(u\.connectedWalletAddress \|\| u\.walletAddress\)/);
assert.match(adminHtml, /walletMarkup\(walletAddressValue\(w\)\)/);
assert.match(adminHtml, /walletMarkup\(walletAddressValue\(d\)\)/);

console.log('PASS — admin wallet addresses, Tonviewer links, copy actions, disconnected badges, and wallet search contracts');
