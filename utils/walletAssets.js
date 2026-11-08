'use strict';

const ASSETS = Object.freeze({
  UP: { code: 'UP', ledgerCurrency: 'points', balanceField: 'points', precision: 6, kind: 'internal' },
  GRAM: { code: 'GRAM', ledgerCurrency: 'gram', balanceField: 'gramBalance', precision: 9, kind: 'internal' },
  USDT: { code: 'USDT', ledgerCurrency: 'usdt', balanceField: 'usdtBalance', precision: 6, kind: 'internal' }
});

const NETWORKS = Object.freeze({
  TON_MAINNET: { code: 'TON_MAINNET', family: 'TON', label: 'TON Mainnet' },
  TON_TESTNET: { code: 'TON_TESTNET', family: 'TON', label: 'TON Testnet' },
  BSC_MAINNET: { code: 'BSC_MAINNET', family: 'EVM', label: 'BNB Smart Chain (BEP-20)' },
  BSC_TESTNET: { code: 'BSC_TESTNET', family: 'EVM', label: 'BNB Smart Chain Testnet' }
});

const ASSET_NETWORKS = Object.freeze({
  GRAM: ['TON_MAINNET'],
  USDT: ['TON_MAINNET', 'BSC_MAINNET'],
  UP: []
});

function normalizeAsset(value) {
  const asset = String(value || '').trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(ASSETS, asset) ? asset : null;
}

function normalizeNetwork(value) {
  const network = String(value || '').trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(NETWORKS, network) ? network : null;
}

function roundAsset(value, asset) {
  const meta = ASSETS[normalizeAsset(asset)];
  const amount = Number(value);
  if (!meta || !Number.isFinite(amount)) return NaN;
  const factor = 10 ** meta.precision;
  return Math.floor((amount + Number.EPSILON) * factor) / factor;
}

function validAmount(value, asset) {
  const amount = roundAsset(value, asset);
  return Number.isFinite(amount) && amount > 0 && amount <= Number.MAX_SAFE_INTEGER;
}

function isAssetNetworkSupported(asset, network) {
  const a = normalizeAsset(asset);
  const n = normalizeNetwork(network);
  return Boolean(a && n && ASSET_NETWORKS[a]?.includes(n));
}

function validateAddress(asset, network, address) {
  const a = normalizeAsset(asset);
  const n = normalizeNetwork(network);
  const raw = String(address || '').trim();
  if (!a || !n || !raw || !isAssetNetworkSupported(a, n)) return false;
  if (n.startsWith('TON_')) return /^[A-Za-z0-9_\-:+/=]{6,120}$/.test(raw);
  if (n.startsWith('BSC_')) return /^0x[a-fA-F0-9]{40}$/.test(raw);
  return false;
}

function publicAssetCatalog({ enabledNetworks = [] } = {}) {
  const enabled = new Set(enabledNetworks.map(normalizeNetwork).filter(Boolean));
  return Object.values(ASSETS).map(meta => ({
    code: meta.code,
    precision: meta.precision,
    kind: meta.kind,
    networks: (ASSET_NETWORKS[meta.code] || []).map(code => ({ ...NETWORKS[code], enabled: enabled.has(code) }))
  }));
}

function balanceField(asset) {
  const a = normalizeAsset(asset);
  return a ? ASSETS[a].balanceField : null;
}

function ledgerCurrency(asset) {
  const a = normalizeAsset(asset);
  return a ? ASSETS[a].ledgerCurrency : null;
}

module.exports = {
  ASSETS, NETWORKS, ASSET_NETWORKS,
  normalizeAsset, normalizeNetwork, roundAsset, validAmount,
  isAssetNetworkSupported, validateAddress, publicAssetCatalog, balanceField, ledgerCurrency
};
