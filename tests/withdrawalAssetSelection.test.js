'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const index = fs.readFileSync('public/index.html', 'utf8');
const app = fs.readFileSync('public/js/app.js', 'utf8');
const proof = fs.readFileSync('public/proof.html', 'utf8');
const i18n = fs.readFileSync('public/js/i18n.js', 'utf8');
assert.match(index, /id="withdrawAssetStep"/);
assert.match(index, /data-withdraw-asset="usdt"/);
assert.match(index, /id="continueWithdraw"[^>]*disabled/);
assert.match(index, /id="withdrawFormStep"[^>]*style="display:none"/);
assert.match(index, /id="withdrawAddress"[^>]*readonly/);
assert.match(app, /let selectedWithdrawalAsset = ""/);
assert.match(app, /function selectWithdrawalAsset\(asset\)[\s\S]*selectedWithdrawalAsset = asset/);
assert.match(app, /function continueWithdrawalToForm\(\)[\s\S]*window\.gramupWallet\.getAddress\(\)/);
assert.match(app, /function backToWithdrawalAssetSelection\(\)/);
assert.match(app, /async function submitWithdraw\(\)[\s\S]*selectedWithdrawalAsset !== "usdt"/);
assert.match(app, /ton-usdt-logo\.png/);
assert.match(index, /ton-usdt-logo\.png/);
assert.match(proof, /ton-usdt-logo\.png/);
assert.match(app, /function gramTokenIconMarkup\(\)[\s\S]*?src="img\/gram-token-logo\.png"/);
assert.match(app, /historyAmountWithIcon\">\$\{assetTokenIconMarkup\(item\.token\)\}/);
assert.match(app, /assetTokenIconMarkup\(w\.token\)/);
assert.match(index, /data-i18n="withdraw_amount_label"/);
assert.match(i18n, /withdraw_asset_balance: "[^"]*\{n\} \{asset\}"/);
for (const key of ['withdraw_asset_title', 'withdraw_asset_subtitle', 'withdraw_asset_balance', 'withdraw_selected_asset', 'withdraw_continue', 'withdraw_back', 'withdraw_amount_ph', 'withdraw_amount_label', 'withdraw_address_ph', 'withdraw_address_label', 'withdraw_submit']) {
  assert.match(i18n, new RegExp(`${key}:`), `withdrawal translation key ${key} must exist`);
}
console.log('PASS — withdrawal opens with asset selection, then autofills the connected wallet address');
