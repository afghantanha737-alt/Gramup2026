'use strict';

const cache = new Map();
const CACHE_MS = 30_000;
const TIMEOUT_MS = 4_000;
const DEFAULT_GRAM_USD_PRICE = 0.20;

function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function configuredPrice(settings, code) {
  if (code === 'GRAM') return positiveNumber(settings?.gramUsdPrice) || DEFAULT_GRAM_USD_PRICE;
  if (code === 'USDT') return 1;
  return null;
}

function providerId(code) {
  if (code === 'GRAM') return String(process.env.PRICE_FEED_GRAM_ID || '').trim();
  if (code === 'USDT') return String(process.env.PRICE_FEED_USDT_ID || 'tether').trim();
  return '';
}

async function fetchProviderPrices(codes, settings = {}) {
  if (String(process.env.PRICE_FEED_ENABLED || '').toLowerCase() !== 'true' && settings.priceFeedEnabled !== true) return {};
  const ids = codes.map(providerId).filter(Boolean);
  if (!ids.length || typeof fetch !== 'function') return {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids.join(','))}&vs_currencies=usd`, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!response.ok) return {};
    const payload = await response.json();
    const result = {};
    for (const code of codes) {
      const usd = positiveNumber(payload?.[providerId(code)]?.usd);
      if (usd) result[code] = usd;
    }
    return result;
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
}

async function getAssetPrices({ settings, assets = ['GRAM', 'USDT'] } = {}) {
  const requested = [...new Set(assets.map(value => String(value || '').toUpperCase()))];
  const now = Date.now();
  const prices = {};
  const source = {};
  const stale = {};
  const missing = [];
  for (const code of requested) {
    const cached = cache.get(code);
    if (cached && cached.expiresAt > now) {
      prices[code] = cached.price; source[code] = cached.source; stale[code] = false;
    } else missing.push(code);
  }
  const live = await fetchProviderPrices(missing.filter(code => code !== 'USDT'), settings);
  for (const code of missing) {
    const livePrice = positiveNumber(live[code]);
    const fallback = configuredPrice(settings, code);
    const price = livePrice || fallback;
    if (price) {
      const priceSource = livePrice ? 'coingecko' : 'settings';
      const isStale = !livePrice && Boolean(fallback);
      cache.set(code, { price, source: priceSource, expiresAt: now + CACHE_MS });
      prices[code] = price; source[code] = priceSource; stale[code] = isStale;
    }
  }
  return { prices, source, stale, fetchedAt: new Date(now).toISOString(), cacheTtlMs: CACHE_MS, missing: requested.filter(code => !prices[code]) };
}

module.exports = { getAssetPrices };
