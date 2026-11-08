'use strict';
const assert = require('assert');
const {
  ASSETS, NETWORKS, normalizeAsset, normalizeNetwork, roundAsset, validAmount,
  isAssetNetworkSupported, validateAddress, publicAssetCatalog
} = require('../utils/walletAssets');

assert.deepStrictEqual(Object.keys(ASSETS).sort(), ['GRAM', 'UP', 'USDT']);
assert.strictEqual(normalizeAsset('usdt'), 'USDT');
assert.strictEqual(normalizeNetwork('bsc_mainnet'), 'BSC_MAINNET');
assert.strictEqual(roundAsset('1.12345678', 'USDT'), 1.123456);
assert.strictEqual(validAmount('0.25', 'GRAM'), true);
assert.strictEqual(isAssetNetworkSupported('USDT', 'BSC_MAINNET'), true);
assert.strictEqual(isAssetNetworkSupported('UP', 'BSC_MAINNET'), false);
assert.strictEqual(validateAddress('USDT', 'BSC_MAINNET', '0x1111111111111111111111111111111111111111'), true);
assert.strictEqual(validateAddress('USDT', 'BSC_MAINNET', 'EQBadTonAddress'), false);
const catalog = publicAssetCatalog({ enabledNetworks: ['TON_MAINNET'] });
assert.strictEqual(catalog.length, 3);
assert.strictEqual(catalog.find(x => x.code === 'USDT').networks.find(x => x.code === 'BSC_MAINNET').enabled, false);
assert.strictEqual(NETWORKS.TON_MAINNET.family, 'TON');
assert.strictEqual(ASSETS.UP.balanceField, 'points');
assert.strictEqual(ASSETS.USDT.balanceField, 'usdtBalance');
console.log('walletMultiCurrencyContract.test.js: PASS');
