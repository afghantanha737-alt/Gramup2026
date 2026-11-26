'use strict';

const { UP_PER_USDT, usdtToUp } = require('./tonUsdt');

const EXCHANGE_ASSETS = Object.freeze({
  UP: Object.freeze({ balanceField: 'points', currency: 'points', decimals: 0 }),
  GRAM: Object.freeze({ balanceField: 'gramBalance', currency: 'gram', decimals: 9 }),
  USDT: Object.freeze({ balanceField: 'usdtBalance', currency: 'usdt', decimals: 6 })
});

function normalizeExchangeAsset(value) {
  const asset = String(value || '').trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(EXCHANGE_ASSETS, asset) ? asset : null;
}

function normalizeLocalizedNumericString(value) {
  if (typeof value !== 'string') return null;
  let normalized = value.trim()
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x0660))
    .replace(/٫/g, '.')
    .replace(/[٬\s\u00a0\u202f]/g, '');
  const commaSeparators = normalized.match(/[,،]/g) || [];
  if (!normalized.includes('.') && commaSeparators.length === 1) normalized = normalized.replace(/[,،]/, '.');
  else normalized = normalized.replace(/[,،]/g, '');
  return /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized) ? normalized : null;
}

function parseExchangeAmount(value, asset) {
  if (!EXCHANGE_ASSETS[asset]) return NaN;
  let numeric;
  if (typeof value === 'number') {
    numeric = value;
  } else {
    const normalized = normalizeLocalizedNumericString(value);
    if (normalized == null) return NaN;
    numeric = Number(normalized);
  }
  if (!Number.isFinite(numeric)) return NaN;
  const decimals = EXCHANGE_ASSETS[asset].decimals;
  return asset === 'UP' ? Math.floor(numeric) : Number(numeric.toFixed(decimals));
}

function roundExchangeAmount(value, asset) {
  if (!EXCHANGE_ASSETS[asset] || !Number.isFinite(Number(value))) return NaN;
  const numeric = Number(value);
  return asset === 'UP'
    ? Math.floor(numeric)
    : Number(numeric.toFixed(EXCHANGE_ASSETS[asset].decimals));
}

function floorExchangeAmount(value, asset) {
  if (!EXCHANGE_ASSETS[asset] || !Number.isFinite(Number(value))) return NaN;
  const numeric = Number(value);
  if (asset === 'UP') return Math.floor(numeric);
  const factor = 10 ** EXCHANGE_ASSETS[asset].decimals;
  const scaled = numeric * factor;
  if (!Number.isFinite(scaled)) return NaN;
  return Math.floor(scaled) / factor;
}

function upToGramRate(gramPriceUsd) {
  const price = Number(gramPriceUsd);
  if (!Number.isFinite(price) || price <= 0) return null;
  const rate = (1 / UP_PER_USDT) / price;
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

function exchangeUpToGram(upAmount, gramPriceUsd) {
  const amount = Number(upAmount);
  const rate = upToGramRate(gramPriceUsd);
  if (!Number.isSafeInteger(amount) || amount <= 0 || rate == null) return 0;
  return Math.floor(amount * rate * 1e9) / 1e9;
}

function exchangeGramToUp(gramAmount, gramPriceUsd) {
  const amount = Number(gramAmount);
  const price = Number(gramPriceUsd);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(price) || price <= 0) return 0;
  const upAmount = amount * price * UP_PER_USDT;
  if (!Number.isFinite(upAmount) || upAmount <= 0) return 0;
  return Math.floor(upAmount);
}

function exchangeAmountFromUp(upAmount, asset, gramPerUp) {
  if (asset === 'UP') return Math.floor(upAmount);
  if (asset === 'GRAM') return roundExchangeAmount(upAmount * gramPerUp, 'GRAM');
  if (asset === 'USDT') return roundExchangeAmount(upAmount / UP_PER_USDT, 'USDT');
  return NaN;
}

function exchangeAmountToUp(amount, asset, gramPerUp) {
  if (asset === 'UP') return Math.floor(amount);
  if (asset === 'GRAM') return Math.floor(amount / gramPerUp);
  if (asset === 'USDT') return usdtToUp(String(amount));
  return NaN;
}

function exchangeRateSnapshot(gramPerUp) {
  return {
    upToGram: gramPerUp,
    gramToUp: 1 / gramPerUp,
    upToUsdt: 1 / UP_PER_USDT,
    usdtToUp: UP_PER_USDT,
    gramToUsdt: gramPerUp / (1 / UP_PER_USDT),
    usdtToGram: (1 / UP_PER_USDT) / gramPerUp
  };
}

module.exports = {
  EXCHANGE_ASSETS,
  normalizeExchangeAsset,
  normalizeLocalizedNumericString,
  parseExchangeAmount,
  roundExchangeAmount,
  floorExchangeAmount,
  upToGramRate,
  exchangeUpToGram,
  exchangeGramToUp,
  exchangeAmountFromUp,
  exchangeAmountToUp,
  exchangeRateSnapshot
};
