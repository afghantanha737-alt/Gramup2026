'use strict';

const express = require('express');
const { StonApiClient } = require('@ston-fi/api');
const { Client, dexFactory } = require('@ston-fi/sdk');
const { requireUnifiedAuth } = require('../utils/unifiedAuth');
const { withMembership } = require('../utils/membership');
const { normalizeTonAddress } = require('../utils/tonNativeDepositVerify');

const router = express.Router();
require('../utils/asyncHandler').wrapRouter(router);
const auth = withMembership(requireUnifiedAuth(process.env.BOT_TOKEN));

const GRAM_ADDRESS = 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c';
const USDT_ADDRESS = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';
const MAINNET = '-239';
const DEFAULT_SLIPPAGE = '0.01';
const QUOTE_TTL_MS = 15_000;
const TON_RPC_ENDPOINT = process.env.TON_RPC_ENDPOINT || 'https://toncenter.com/api/v2/jsonRPC';

const api = new StonApiClient({ endpoint: process.env.STON_API_URL || 'https://api.ston.fi' });
const tonClient = new Client({ endpoint: TON_RPC_ENDPOINT, apiKey: process.env.TONCENTER_API_KEY || undefined });

function assetAddress(value) {
  const token = String(value || '').trim().toUpperCase();
  return token === 'GRAM' ? GRAM_ADDRESS : token === 'USDT' ? USDT_ADDRESS : null;
}

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

function directionFor(from, to) {
  const offerAddress = assetAddress(from);
  const askAddress = assetAddress(to);
  if (!offerAddress || !askAddress || from === to) return null;
  return { offerAddress, askAddress, nativeOffer: from === 'GRAM' };
}

function hasRecentWalletProof(user) {
  const wallet = user?.connectedWallet || {};
  const proofAt = wallet.proofVerifiedAt ? new Date(wallet.proofVerifiedAt).getTime() : 0;
  return Boolean(wallet.address && wallet.network === MAINNET && wallet.proofPublicKey && proofAt && proofAt <= Date.now());
}

function walletAddressFromUser(user) {
  const wallet = user?.connectedWallet || {};
  return normalizeTonAddress(wallet.canonicalAddress || wallet.address || '');
}

function toTonConnectTransaction(txParams) {
  if (!txParams?.to || !txParams?.value) throw new Error('STON.fi transaction parameters are incomplete.');
  return {
    validUntil: Math.floor(Date.now() / 1000) + 600,
    network: MAINNET,
    messages: [{ address: txParams.to.toString(), amount: txParams.value.toString(), payload: txParams.body?.toBoc().toString('base64') || '' }]
  };
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
  return {
    success: true,
    source: 'STON.fi',
    network: 'TON_MAINNET',
    updatedAt: new Date().toISOString(),
    assets: { GRAM: gramPublic, USDT: usdtPublic },
    gramUsdt: usdtPublic.priceUsd > 0 ? gramPublic.priceUsd / usdtPublic.priceUsd : 0,
    usdtGram: gramPublic.priceUsd > 0 ? usdtPublic.priceUsd / gramPublic.priceUsd : 0
  };
}

async function simulateQuote({ from, to, amount, slippageTolerance = DEFAULT_SLIPPAGE }) {
  const pair = directionFor(from, to);
  if (!pair) throw Object.assign(new Error('Only GRAM ↔ USDT swaps are supported by STON.fi.'), { code: 'STON_UNSUPPORTED_PAIR', statusCode: 400 });
  const offerAsset = await api.getAsset(pair.offerAddress);
  const offerUnits = parseDecimalUnits(amount, Number(offerAsset.decimals));
  if (!offerUnits) throw Object.assign(new Error(`مقدار ${from} نامعتبر است.`), { code: 'INVALID_AMOUNT', statusCode: 400 });
  const slippage = String(slippageTolerance);
  if (!/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(slippage) || Number(slippage) > 1) {
    throw Object.assign(new Error('Slippage نامعتبر است.'), { code: 'INVALID_SLIPPAGE', statusCode: 400 });
  }
  const simulation = await api.simulateSwap({ offerAddress: pair.offerAddress, askAddress: pair.askAddress, offerUnits, slippageTolerance: slippage });
  const askAsset = await api.getAsset(pair.askAddress);
  const now = Date.now();
  return {
    success: true,
    source: 'STON.fi',
    network: 'TON_MAINNET',
    from,
    to,
    amount: String(amount),
    offerUnits,
    askUnits: simulation.askUnits,
    minAskUnits: simulation.minAskUnits,
    receivedAmount: unitsToDecimal(simulation.askUnits, Number(askAsset.decimals)),
    minimumReceivedAmount: unitsToDecimal(simulation.minAskUnits, Number(askAsset.decimals)),
    swapRate: simulation.swapRate,
    priceImpact: simulation.priceImpact,
    feePercent: simulation.feePercent,
    router: simulation.router,
    gasParams: simulation.gasParams,
    quotedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + QUOTE_TTL_MS).toISOString()
  };
}

async function buildTransaction({ user, quote }) {
  const ownerAddress = walletAddressFromUser(user);
  if (!ownerAddress || !hasRecentWalletProof(user)) {
    throw Object.assign(new Error('برای سواپ، Wallet Mainnet را با TON Proof تأیید کنید.'), { code: 'WALLET_PROOF_REQUIRED', statusCode: 403 });
  }
  if (Date.parse(quote.expiresAt) <= Date.now()) {
    throw Object.assign(new Error('Quote منقضی شده است؛ نرخ جدید دریافت کنید.'), { code: 'STON_QUOTE_EXPIRED', statusCode: 409 });
  }
  const factory = dexFactory(quote.router);
  const routerContract = tonClient.open(factory.Router.create(quote.router.address));
  const proxyTon = factory.pTON.create(quote.router.ptonMasterAddress);
  const common = {
    userWalletAddress: ownerAddress,
    offerAmount: quote.offerUnits,
    minAskAmount: quote.minAskUnits,
    proxyTon,
    forwardGasAmount: quote.gasParams?.forwardGas
  };
  let txParams;
  if (quote.from === 'GRAM') {
    txParams = await routerContract.getSwapTonToJettonTxParams({ ...common, askJettonAddress: USDT_ADDRESS });
  } else {
    const offerJettonWalletAddress = await api.getJettonWalletAddress({ ownerAddress, jettonAddress: USDT_ADDRESS });
    txParams = await routerContract.getSwapJettonToTonTxParams({ ...common, offerJettonAddress: USDT_ADDRESS, offerJettonWalletAddress });
  }
  return toTonConnectTransaction(txParams);
}

router.get('/rates', auth, async (req, res) => {
  try { return res.json(await getLiveRates()); }
  catch (error) { console.error('[ston.fi] rates failed:', error.message || error); return res.status(503).json({ success: false, code: 'STON_RATES_UNAVAILABLE', message: 'نرخ زنده STON.fi فعلاً در دسترس نیست.' }); }
});

router.post('/quote', auth, async (req, res) => {
  try {
    const from = String(req.body?.from || '').toUpperCase();
    const to = String(req.body?.to || '').toUpperCase();
    const quote = await simulateQuote({ from, to, amount: req.body?.amount, slippageTolerance: req.body?.slippageTolerance });
    return res.json(quote);
  } catch (error) {
    const status = error.statusCode || (error.code === 'STON_UNSUPPORTED_PAIR' ? 400 : 503);
    console.error('[ston.fi] quote failed:', error.message || error);
    return res.status(status).json({ success: false, code: error.code || 'STON_QUOTE_UNAVAILABLE', message: error.message || 'Quote فعلاً در دسترس نیست.' });
  }
});

router.post('/swap/transaction', auth, async (req, res) => {
  try {
    const from = String(req.body?.from || '').toUpperCase();
    const to = String(req.body?.to || '').toUpperCase();
    const quote = await simulateQuote({ from, to, amount: req.body?.amount, slippageTolerance: req.body?.slippageTolerance });
    const transaction = await buildTransaction({ user: req.dbUser, quote });
    return res.json({ success: true, quote, transaction });
  } catch (error) {
    const status = error.statusCode || (error.code === 'WALLET_PROOF_REQUIRED' ? 403 : 503);
    console.error('[ston.fi] transaction failed:', error.message || error);
    return res.status(status).json({ success: false, code: error.code || 'STON_TRANSACTION_UNAVAILABLE', message: error.message || 'تراکنش STON.fi فعلاً آماده نشد.' });
  }
});

module.exports = { router, constants: { GRAM_ADDRESS, USDT_ADDRESS }, parseDecimalUnits, unitsToDecimal, directionFor, toTonConnectTransaction, simulateQuote, buildTransaction };
