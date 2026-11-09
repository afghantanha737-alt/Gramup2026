'use strict';
const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
require('../utils/asyncHandler').wrapRouter(router);
const { requireUnifiedAuth } = require('../utils/unifiedAuth');
const { sensitiveRateLimit } = require('../utils/apiSecurity');
const { withMongoTransaction } = require('../utils/mongoTransaction');
const { recordLedgerRequired } = require('../utils/ledger');
const User = require('../models/User');
const AdOrder = require('../models/AdOrder');
const Task = require('../models/Task');
const Settings = require('../models/Settings');
const { normalizeAdCampaign, calculateAdPricing, publicOrder } = require('../utils/adCampaign');
const { comment } = require('@ton/ton');
const { normalizeTonAddress, amountToNanoGram, verifyNativeGramTransfer, findIncomingNativeGramTransferByReference } = require('../utils/tonNativeDepositVerify');
const { bot } = require('../utils/bot');
const auth = requireUnifiedAuth(process.env.BOT_TOKEN);

function publicAdConfig(settings) {
  return {
    enabled: settings.adMarketplaceEnabled !== false,
    gramUsdPrice: Number(settings.gramUsdPrice || 0),
    basePriceUsdPerUser: Number(settings.adBasePriceUsdPerUser || 0),
    channelSurchargeUsdPerUser: Number(settings.adChannelSurchargeUsdPerUser || 0),
    languageSurchargeUsdPerUser: Number(settings.adLanguageSurchargeUsdPerUser || 0),
    premiumSurchargeUsdPerUser: Number(settings.adPremiumSurchargeUsdPerUser || 0),
    playerRewardUp: Number(settings.adPlayerRewardUp || 0),
    minUsers: Number(settings.adMinUsers || 50),
    maxUsers: Number(settings.adMaxUsers || 50000)
  };
}

router.get('/config', auth, async (req, res) => {
  const settings = await Settings.getGlobal();
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, config: publicAdConfig(settings) });
});

async function paymentConfig() {
  const settings = await Settings.getGlobal();
  const address = String(settings.depositWalletAddress || process.env.TON_DEPOSIT_ADDRESS || '').trim();
  if (!normalizeTonAddress(address)) throw Object.assign(new Error('آدرس پرداخت TON تنظیم نشده است.'), { code: 'TON_PAYMENT_NOT_CONFIGURED' });
  return { settings, address };
}

router.get('/', auth, async (req, res) => {
  const orders = await AdOrder.find({ advertiserTelegramId: String(req.dbUser.telegramId) }).sort({ createdAt: -1 }).limit(50).lean();
  res.json({ success: true, orders: orders.map(publicOrder) });
});

router.post('/', auth, sensitiveRateLimit('ad_order'), async (req, res) => {
  const normalized = normalizeAdCampaign(req.body);
  if (normalized.error) return res.status(400).json({ success: false, code: 'INVALID_AD_CAMPAIGN', message: normalized.error });
  let input = normalized.value;
  try {
    const settings = await Settings.getGlobal();
    if (settings.adMarketplaceEnabled === false) return res.status(503).json({ success: false, code: 'AD_MARKETPLACE_DISABLED', message: 'بازار تبلیغات موقتاً غیرفعال است.' });
    if (input.completionsRequested < Number(settings.adMinUsers || 50) || input.completionsRequested > Number(settings.adMaxUsers || 50000)) return res.status(400).json({ success: false, code: 'AD_USERS_OUT_OF_RANGE', message: 'تعداد کاربران خارج از محدوده تنظیم‌شده است.' });
    const pricing = calculateAdPricing({ settings, ...input });
    if (pricing.error) return res.status(503).json({ success: false, code: 'AD_PRICING_UNAVAILABLE', message: pricing.error });
    input = { ...input, ...pricing };
    if (input.totalCostGram < Number(settings.adCampaignMinBudgetGram || 0.1) || input.totalCostGram > Number(settings.adCampaignMaxBudgetGram || 100000)) {
      return res.status(400).json({ success: false, code: 'AD_BUDGET_OUT_OF_RANGE', message: 'بودجه کمپین خارج از محدوده مجاز است.' });
    }
    const order = await withMongoTransaction(async session => {
      const user = await User.findById(req.dbUser._id).session(session);
      if (!user) throw Object.assign(new Error('کاربر پیدا نشد.'), { code: 'USER_NOT_FOUND' });
      if (Number(user.gramBalance || 0) < input.totalCostGram) throw Object.assign(new Error('موجودی GRAM برای این کمپین کافی نیست.'), { code: 'INSUFFICIENT_GRAM' });
      const sourceId = `ad-order:${new mongoose.Types.ObjectId().toString()}`;
      const before = Number(user.gramBalance || 0);
      const after = Number((before - input.totalCostGram).toFixed(9));
      user.gramBalance = after;
      await user.save({ session });
      const created = await new AdOrder({
        advertiserTelegramId: String(user.telegramId), advertiserName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username || '',
        ...input, paymentMethod: 'gram_balance', paymentStatus: 'paid', status: 'pending_review', paymentSourceId: sourceId
      }).save({ session });
      await recordLedgerRequired({ user: user._id, type: 'ad_order_payment', currency: 'gram', amount: -input.totalCostGram, balanceAfter: after, sourceId, description: `Ad campaign reservation ${created._id}`, session });
      return created;
    });
    res.status(201).json({ success: true, order: publicOrder(order), message: 'کمپین ثبت و مبلغ آن در انتظار بررسی ادمین رزرو شد.' });
  } catch (error) {
    if (error.code === 'INSUFFICIENT_GRAM') return res.status(400).json({ success: false, code: error.code, message: error.message });
    console.error('Create ad order failed:', error);
    res.status(500).json({ success: false, code: 'AD_ORDER_FAILED', message: 'ثبت کمپین انجام نشد؛ دوباره تلاش کنید.' });
  }
});

router.post('/ton-intents', auth, sensitiveRateLimit('ad_order_ton'), async (req, res) => {
  const normalized = normalizeAdCampaign(req.body);
  if (normalized.error) return res.status(400).json({ success: false, code: 'INVALID_AD_CAMPAIGN', message: normalized.error });
  let input = normalized.value;
  try {
    const { settings, address } = await paymentConfig();
    if (settings.adMarketplaceEnabled === false) return res.status(503).json({ success: false, code: 'AD_MARKETPLACE_DISABLED', message: 'بازار تبلیغات موقتاً غیرفعال است.' });
    if (input.completionsRequested < Number(settings.adMinUsers || 50) || input.completionsRequested > Number(settings.adMaxUsers || 50000)) return res.status(400).json({ success: false, code: 'AD_USERS_OUT_OF_RANGE', message: 'تعداد کاربران خارج از محدوده تنظیم‌شده است.' });
    const pricing = calculateAdPricing({ settings, ...input });
    if (pricing.error) return res.status(503).json({ success: false, code: 'AD_PRICING_UNAVAILABLE', message: pricing.error });
    input = { ...input, ...pricing };
    if (input.totalCostGram < Number(settings.adCampaignMinBudgetGram || 0.1) || input.totalCostGram > Number(settings.adCampaignMaxBudgetGram || 100000)) return res.status(400).json({ success: false, code: 'AD_BUDGET_OUT_OF_RANGE', message: 'بودجه کمپین خارج از محدوده مجاز است.' });
    const amountRaw = amountToNanoGram(input.totalCostGram);
    if (!amountRaw) return res.status(400).json({ success: false, code: 'INVALID_TON_AMOUNT', message: 'مبلغ TON معتبر نیست.' });
    const created = await new AdOrder({ advertiserTelegramId: String(req.dbUser.telegramId), advertiserName: `${req.dbUser.firstName || ''} ${req.dbUser.lastName || ''}`.trim() || req.dbUser.username || '', ...input, paymentMethod: 'ton_mainnet', paymentStatus: 'pending', status: 'payment_pending', paymentReference: `ad_${new mongoose.Types.ObjectId().toString()}`, paymentAddressSnapshot: address, paymentAmountRaw: amountRaw.toString() }).save();
    res.status(201).json({ success: true, order: publicOrder(created), intent: { id: String(created._id), reference: created.paymentReference, amount: input.totalCostGram, address }, transaction: { validUntil: Math.floor(Date.now() / 1000) + 900, messages: [{ address, amount: amountRaw.toString(), payload: comment(created.paymentReference).toBoc().toString('base64') }] } });
  } catch (error) { res.status(error.code === 'TON_PAYMENT_NOT_CONFIGURED' ? 503 : 500).json({ success: false, code: error.code || 'AD_TON_INTENT_FAILED', message: error.message || 'ایجاد درخواست پرداخت TON انجام نشد.' }); }
});

router.post('/:id/ton-verify', auth, sensitiveRateLimit('ad_order_ton_verify'), async (req, res) => {
  try {
    const order = await AdOrder.findOne({ _id: req.params.id, advertiserTelegramId: String(req.dbUser.telegramId), paymentMethod: 'ton_mainnet' });
    if (!order) return res.status(404).json({ success: false, code: 'AD_ORDER_NOT_FOUND', message: 'سفارش پیدا نشد.' });
    if (order.paymentStatus === 'paid') return res.json({ success: true, status: 'confirmed', order: publicOrder(order) });
    const walletAddress = normalizeTonAddress(req.dbUser.connectedWallet?.canonicalAddress || req.dbUser.connectedWallet?.address);
    if (!walletAddress || req.dbUser.connectedWallet?.network !== '-239' || !req.dbUser.connectedWallet?.proofVerifiedAt) return res.status(400).json({ success: false, code: 'WALLET_PROOF_REQUIRED', message: 'ابتدا مالکیت Wallet را تأیید کنید.' });
    const details = req.body?.txHash ? await verifyNativeGramTransfer({ txHash: req.body.txHash, depositAddress: order.paymentAddressSnapshot, reference: order.paymentReference }) : await findIncomingNativeGramTransferByReference({ depositAddress: order.paymentAddressSnapshot, reference: order.paymentReference });
    if (details.status !== 'verified') return res.status(202).json({ success: true, status: details.status, code: details.code, message: 'تراکنش هنوز در شبکه TON تأیید نشده است.' });
    const expected = BigInt(order.paymentAmountRaw);
    if (BigInt(details.amountRaw) !== expected || normalizeTonAddress(details.sourceAddress) !== walletAddress) return res.status(400).json({ success: false, code: 'AD_TON_PAYMENT_MISMATCH', message: 'مبلغ یا فرستنده تراکنش با سفارش مطابقت ندارد.' });
    const updated = await AdOrder.findOneAndUpdate({ _id: order._id, paymentStatus: 'pending' }, { $set: { paymentStatus: 'paid', status: 'pending_review', paymentTxHash: details.txHash, paymentSenderAddress: walletAddress, paymentVerifiedAt: new Date(), paymentSourceId: `ad-ton:${details.txHash}` } }, { new: true });
    if (!updated) return res.json({ success: true, status: 'confirmed', order: publicOrder(await AdOrder.findById(order._id)) });
    res.json({ success: true, status: 'confirmed', order: publicOrder(updated) });
  } catch (error) { res.status(500).json({ success: false, code: 'AD_TON_VERIFY_FAILED', message: 'تأیید پرداخت TON انجام نشد.' }); }
});

router.get('/bot-check', auth, sensitiveRateLimit('ad_bot_check'), async (req, res) => {
  const chatId = String(req.query.chatId || '').trim();
  if (!chatId || !bot) return res.status(503).json({ success: false, code: 'BOT_UNAVAILABLE', isAdmin: false, message: 'ربات تلگرام تنظیم نشده است.' });
  try {
    const me = await bot.getMe();
    const member = await bot.getChatMember(chatId, me.id);
    const isAdmin = ['administrator', 'creator'].includes(member?.status);
    res.json({ success: true, isAdmin, status: member?.status || 'unknown', message: isAdmin ? 'ربات ادمین کانال است.' : 'ربات ادمین کانال نیست.' });
  } catch (error) { res.status(400).json({ success: false, code: 'BOT_ADMIN_CHECK_FAILED', isAdmin: false, message: 'بررسی دسترسی ربات به کانال انجام نشد.' }); }
});

module.exports = router;
