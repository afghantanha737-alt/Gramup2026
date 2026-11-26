'use strict';

const express = require('express');
const { StonApiClient } = require('@ston-fi/api');
const { requireUnifiedAuth } = require('../utils/unifiedAuth');
const { withMembership } = require('../utils/membership');

const router = express.Router();
require('../utils/asyncHandler').wrapRouter(router);
const auth = withMembership(requireUnifiedAuth(process.env.BOT_TOKEN));

const GRAM_ADDRESS = 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c';
const USDT_ADDRESS = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';
const QUOTE_TTL_MS = 15_000;
const api = new StonApiClient({ endpoint: process.env.STON_API_URL || 'https://api.ston.fi' });

function parseDecimalUnits(value, decimals) {
  const text = String(value ?? '').trim();
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > decimals && /[1-9]/.test(fraction.slice(decimals))) return null;
  try {
    const raw = BigInt(`${whole || '0'}${fraction.slice(0, decimals).padEnd(decimals, '0')}`);
    return raw > 0n ? raw.toString() : null;
  } catch { return null; }
}

function unitsToDecimal(units, decimals) {
  const raw = BigInt(String(units));
  const scale = 10n ** BigInt(decimals);
  const whole = raw / scale;
  const fraction = raw % scale;
  if (!fraction) return whole.toString();
  return `${whole}.${fraction.toString().padStart(decimals, '0').replace(/0+$/, '')}`;
}

function roundAssetAmount(value, decimals) {
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) return 0;
  const factor = 10 ** decimals;
  return Math.floor(Number(value) * factor) / factor;
}

function publicAsset(asset) {
  return {
    address: asset.contractAddress,
    symbol: asset.symbol === 'USD₮' ? 'USDT' : asset.symbol,
    displayName: asset.displayName,
    decimals: asset.decimals,
    kind: asset.kind,
    priceUsd: Number(asset.dexPriceUsd ?? asset.dexUsdPrice ?? asset.thirdPartyPriceUsd ?? asset.thirdPartyUsdPrice) || 0,
    imageUrl: asset.imageUrl || ''
  };
}

async function getLiveRates() {
  const [gram, usdt] = await Promise.all([api.getAsset(GRAM_ADDRESS), api.getAsset(USDT_ADDRESS)]);
  const gramPublic = publicAsset(gram);
  const usdtPublic = publicAsset(usdt);
  if (!(gramPublic.priceUsd > 0) || !(usdtPublic.priceUsd > 0)) {
    throw Object.assign(new Error('STON.fi returned invalid market prices.'), { code: 'STON_RATES_INVALID' });
  }
  return {
    success: true,
    source: 'STON.fi market API',
    execution: 'internal',
    network: 'TON_MAINNET',
    updatedAt: new Date().toISOString(),
    assets: { GRAM: gramPublic, USDT: usdtPublic },
    gramUsdt: gramPublic.priceUsd / usdtPublic.priceUsd,
    usdtGram: usdtPublic.priceUsd / gramPublic.priceUsd
  };
}

async function calculateInternalQuote({ from, to, amount }) {
  const source = String(from || '').toUpperCase();
  const target = String(to || '').toUpperCase();
  if (!['GRAM', 'USDT'].includes(source) || !['GRAM', 'USDT'].includes(target) || source === target) {
    throw Object.assign(new Error('Only internal GRAM ↔ USDT conversion is supported here.'), { code: 'STON_UNSUPPORTED_PAIR', statusCode: 400 });
  }
  const decimals = source === 'GRAM' ? 9 : 6;
  const offerUnits = parseDecimalUnits(amount, decimals);
  if (!offerUnits) throw Object.assign(new Error(`مقدار ${source} نامعتبر است.`), { code: 'INVALID_AMOUNT', statusCode: 400 });
  const rates = await getLiveRates();
  const receivedAmount = roundAssetAmount(Number(amount) * (source === 'GRAM' ? rates.gramUsdt : rates.usdtGram), target === 'GRAM' ? 9 : 6);
  if (!(receivedAmount > 0)) throw Object.assign(new Error('مقدار تبدیل بسیار کم است.'), { code: 'EXCHANGE_AMOUNT_TOO_SMALL', statusCode: 400 });
  const now = Date.now();
  return {
    success: true,
    source: 'STON.fi market API',
    execution: 'internal',
    from: source,
    to: target,
    amount: String(amount),
    offerUnits,
    receivedAmount: String(receivedAmount),
    minimumReceivedAmount: String(receivedAmount),
    exchangeRate: source === 'GRAM' ? rates.gramUsdt : rates.usdtGram,
    market: rates.assets,
    quotedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + QUOTE_TTL_MS).toISOString()
  };
}

router.get('/rates', auth, async (req, res) => {
  try { return res.json(await getLiveRates()); }
  catch (error) { console.error('[ston.fi] rates failed:', error.message || error); return res.status(503).json({ success: false, code: 'STON_RATES_UNAVAILABLE', message: 'نرخ زنده STON.fi فعلاً در دسترس نیست.' }); }
});

router.post('/quote', auth, async (req, res) => {
  try { return res.json(await calculateInternalQuote(req.body || {})); }
  catch (error) {
    const status = error.statusCode || (error.code === 'STON_UNSUPPORTED_PAIR' ? 400 : 503);
    console.error('[ston.fi] internal quote failed:', error.message || error);
    return res.status(status).json({ success: false, code: error.code || 'STON_QUOTE_UNAVAILABLE', message: error.message || 'نرخ داخلی فعلاً در دسترس نیست.' });
  }
});

module.exports = { router, constants: { GRAM_ADDRESS, USDT_ADDRESS }, parseDecimalUnits, unitsToDecimal, calculateInternalQuote, getLiveRates };
