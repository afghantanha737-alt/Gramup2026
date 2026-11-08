'use strict';

const crypto = require('crypto');
const express = require('express');
const router = express.Router();
require('../utils/asyncHandler').wrapRouter(router);
const { requireUnifiedAuth } = require('../utils/unifiedAuth');
const { withMembership } = require('../utils/membership');
const { sensitiveRateLimit } = require('../utils/apiSecurity');
const Settings = require('../models/Settings');
const User = require('../models/User');
const WalletQuote = require('../models/WalletQuote');
const { withMongoTransaction } = require('../utils/mongoTransaction');
const { recordLedgerRequired } = require('../utils/ledger');
const { executeIdempotently, idempotencyTransactionId } = require('../utils/idempotency');
const { getAssetPrices } = require('../utils/walletPriceFeed');
const {
  ASSETS, NETWORKS, normalizeAsset, normalizeNetwork, roundAsset, validAmount,
  publicAssetCatalog, balanceField, ledgerCurrency
} = require('../utils/walletAssets');

const auth = withMembership(requireUnifiedAuth(process.env.BOT_TOKEN));
const QUOTE_TTL_MS = 30_000;

function error(code, message, statusCode = 400) {
  const e = new Error(message);
  e.code = code;
  e.statusCode = statusCode;
  return e;
}

function publicBalances(user) {
  return {
    UP: Number(user?.points) || 0,
    GRAM: Number(user?.gramBalance) || 0,
    USDT: Number(user?.usdtBalance) || 0
  };
}

function conversionRate(fromAsset, toAsset, settings, prices) {
  if (fromAsset === 'UP' && toAsset === 'GRAM') return Number(settings.rate) || 0;
  if (fromAsset === 'GRAM' && toAsset === 'UP') return Number(settings.rate) > 0 ? 1 / Number(settings.rate) : 0;
  const gramUsd = Number(prices.GRAM) || 0;
  const upUsd = gramUsd * (Number(settings.rate) || 0);
  const usdPrices = { ...prices, UP: upUsd, USDT: Number(prices.USDT) || 1 };
  const fromUsd = Number(usdPrices[fromAsset]) || 0;
  const toUsd = Number(usdPrices[toAsset]) || 0;
  return fromUsd > 0 && toUsd > 0 ? fromUsd / toUsd : 0;
}

function publicQuote(quote) {
  const asObject = value => value instanceof Map ? Object.fromEntries(value.entries()) : (value && typeof value === 'object' ? { ...value } : {});
  return {
    quoteId: quote.quoteId,
    fromAsset: quote.fromAsset,
    toAsset: quote.toAsset,
    amount: quote.amount,
    receiveAmount: quote.receiveAmount,
    rate: quote.rate,
    pricesUsd: asObject(quote.pricesUsd),
    priceSource: asObject(quote.priceSource),
    stale: asObject(quote.stale),
    expiresAt: quote.expiresAt
  };
}

router.get('/balances', auth, async (req, res) => {
  res.json({ success: true, balances: publicBalances(req.dbUser) });
});

router.get('/networks', auth, async (req, res) => {
  const settings = await Settings.getGlobal();
  const enabledNetworks = Array.isArray(settings.enabledWithdrawalNetworks) && settings.enabledWithdrawalNetworks.length
    ? settings.enabledWithdrawalNetworks
    : ['TON_MAINNET', 'BSC_MAINNET'];
  res.json({
    success: true,
    assets: publicAssetCatalog({ enabledNetworks }),
    networks: Object.values(NETWORKS),
    automaticPayouts: false,
    manualReviewRequired: true
  });
});

router.get('/quote', auth, sensitiveRateLimit('general'), async (req, res) => {
  const fromAsset = normalizeAsset(req.query.from);
  const toAsset = normalizeAsset(req.query.to);
  const amount = roundAsset(req.query.amount, fromAsset);
  if (!fromAsset || !toAsset || fromAsset === toAsset) return res.status(400).json({ success: false, code: 'INVALID_ASSET_PAIR', message: 'جفت‌ارز انتخاب‌شده معتبر نیست.' });
  if (!validAmount(amount, fromAsset)) return res.status(400).json({ success: false, code: 'INVALID_AMOUNT', message: 'مقدار تبدیل معتبر نیست.' });
  if (amount > Number(req.dbUser?.[balanceField(fromAsset)] || 0)) return res.status(400).json({ success: false, code: 'INSUFFICIENT_BALANCE', message: 'موجودی دارایی مبدأ کافی نیست.' });

  const settings = await Settings.getGlobal();
  const needed = [fromAsset, toAsset].filter(asset => asset !== 'UP');
  const feed = await getAssetPrices({ settings, assets: needed });
  const rate = conversionRate(fromAsset, toAsset, settings, feed.prices);
  const receiveAmount = roundAsset(amount * rate, toAsset);
  if (!Number.isFinite(rate) || rate <= 0 || !validAmount(receiveAmount, toAsset)) {
    return res.status(503).json({ success: false, code: 'PRICE_UNAVAILABLE', message: 'قیمت زنده این جفت‌ارز فعلاً در دسترس نیست.' });
  }

  const quote = await WalletQuote.create({
    user: req.dbUser._id,
    quoteId: `Q-${crypto.randomBytes(18).toString('hex')}`,
    fromAsset,
    toAsset,
    amount,
    receiveAmount,
    rate,
    pricesUsd: feed.prices,
    priceSource: feed.source,
    stale: feed.stale,
    expiresAt: new Date(Date.now() + QUOTE_TTL_MS)
  });
  return res.json({ success: true, quote: publicQuote(quote), balances: publicBalances(req.dbUser), serverTime: new Date().toISOString() });
});

router.post('/convert', auth, sensitiveRateLimit('withdraw'), async (req, res) => {
  const quoteId = String(req.body?.quoteId || '').trim();
  if (!quoteId) return res.status(400).json({ success: false, code: 'QUOTE_REQUIRED', message: 'Quote معتبر الزامی است.' });
  const operationKey = String(req.get('Idempotency-Key') || '').trim();
  try {
    const operation = await executeIdempotently({
      userId: req.dbUser._id,
      scope: 'wallet_convert',
      key: operationKey,
      body: { quoteId },
      execute: async session => {
        const quote = await WalletQuote.findOne({ quoteId, user: req.dbUser._id }).session(session);
        if (!quote) throw error('QUOTE_NOT_FOUND', 'Quote پیدا نشد.', 404);
        if (quote.consumedAt) throw error('QUOTE_ALREADY_USED', 'این Quote قبلاً استفاده شده است.', 409);
        if (quote.expiresAt.getTime() <= Date.now()) throw error('QUOTE_EXPIRED', 'زمان Quote تمام شده است.', 409);
        const fromField = balanceField(quote.fromAsset);
        const toField = balanceField(quote.toAsset);
        const debit = -Number(quote.amount);
        const credit = Number(quote.receiveAmount);
        const updated = await User.findOneAndUpdate(
          { _id: req.dbUser._id, [fromField]: { $gte: Number(quote.amount) } },
          { $inc: { [fromField]: debit, [toField]: credit } },
          { new: true, session }
        );
        if (!updated) throw error('INSUFFICIENT_BALANCE', 'موجودی دارایی مبدأ کافی نیست.', 400);
        const conversionId = `CV-${crypto.randomBytes(16).toString('hex')}`;
        const sourceBase = `conversion:${conversionId}`;
        await recordLedgerRequired({
          user: updated._id, type: 'exchange_out', currency: ledgerCurrency(quote.fromAsset), amount: debit,
          description: `تبدیل ${quote.fromAsset} به ${quote.toAsset}`, balanceAfter: updated[fromField],
          sourceId: `${sourceBase}:out`, transactionId: idempotencyTransactionId({ userId: updated._id, scope: 'wallet_convert', key: operationKey, leg: 'out' }), session
        });
        await recordLedgerRequired({
          user: updated._id, type: 'exchange_in', currency: ledgerCurrency(quote.toAsset), amount: credit,
          description: `تبدیل ${quote.fromAsset} به ${quote.toAsset}`, balanceAfter: updated[toField],
          sourceId: `${sourceBase}:in`, transactionId: idempotencyTransactionId({ userId: updated._id, scope: 'wallet_convert', key: operationKey, leg: 'in' }), session
        });
        quote.consumedAt = new Date();
        quote.conversionId = conversionId;
        await quote.save({ session });
        return { status: 200, body: { success: true, conversionId, fromAsset: quote.fromAsset, toAsset: quote.toAsset, spent: quote.amount, received: quote.receiveAmount, balances: publicBalances(updated) } };
      }
    });
    return res.status(operation.status).json(operation.body);
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ success: false, code: e.code, message: e.message });
    throw e;
  }
});

module.exports = router;
