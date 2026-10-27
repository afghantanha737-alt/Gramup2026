'use strict';
const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
require('../utils/asyncHandler').wrapRouter(router);
const { requireUnifiedAuth } = require('../utils/unifiedAuth');
const { recordLedgerRequired } = require('../utils/ledger');
const Settings = require('../models/Settings');
const User = require('../models/User');
const Withdrawal = require('../models/Withdrawal');
const PointsLedger = require('../models/PointsLedger');
const Deposit = require('../models/Deposit');
const GramSwapIntent = require('../models/GramSwapIntent');
const VipPlan = require('../models/VipPlan');
const VipSubscription = require('../models/VipSubscription');
const Task = require('../models/Task');
const TaskCompletion = require('../models/TaskCompletion');
const { vipActivationTaskDefinition } = require('../utils/vipActivationTasks');
const { idempotencyTransactionId, executeIdempotently } = require('../utils/idempotency');
const { utcDayKey, wasUtcYesterday } = require('../utils/utcDay');
const {
  DAY_MS,
  calculateTotalRewardCents,
  dailyRewardCents,
  pointsFromCents,
  calculateDaysRemaining,
  calculateDaysCompleted
} = require('../utils/vipRewards');
const { settleMaturedVipSubscriptions } = require('../utils/vipSettlement');
const { LEGACY_VIP_POLICY_VERSION, NEW_VIP_POLICY_VERSION, newVipPolicyForPlan, dailyPointsCentsFromBps } = require('../utils/vipPolicy');
const {
  normalizeTonAddress,
  normalizeTonTxHash,
  amountToNanoGram,
  verifyNativeGramTransfer,
  findIncomingNativeGramTransferByReference,
  getNativeGramBalance,
  createDepositReference
} = require('../utils/tonNativeDepositVerify');
const { comment } = require('@ton/ton');

// احراز هویت تلگرام + بررسی عضویت فعلی در کانال‌های اجباری (روی هر درخواست محافظت‌شده)
const { withMembership } = require('../utils/membership');
const auth = withMembership(requireUnifiedAuth(process.env.BOT_TOKEN));

function vipError(code, message, statusCode = 400, extra = {}) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  Object.assign(error, extra);
  return error;
}

function publicVipPlan(plan) {
  const policy = String(plan.policyVersion || LEGACY_VIP_POLICY_VERSION) === NEW_VIP_POLICY_VERSION
    ? newVipPolicyForPlan(plan.planNumber)
    : null;
  const totalRewardCents = policy
    ? dailyPointsCentsFromBps(plan.pricePoints, policy.rewardDailyBps) * policy.durationDays
    : calculateTotalRewardCents(plan.pricePoints, plan.monthlyRewardPercent, plan.durationDays);
  const totalRewardPoints = totalRewardCents == null ? 0 : pointsFromCents(totalRewardCents);
  return {
    planNumber: plan.planNumber,
    pricePoints: plan.pricePoints,
    monthlyRewardPercent: plan.monthlyRewardPercent,
    durationDays: policy?.durationDays || plan.durationDays,
    totalRewardPoints,
    dailyRewardAveragePoints: (policy?.durationDays || plan.durationDays) > 0 ? Number((totalRewardPoints / (policy?.durationDays || plan.durationDays)).toFixed(2)) : 0,
    policyVersion: plan.policyVersion || LEGACY_VIP_POLICY_VERSION,
    productGroup: plan.productGroup || 'legacy',
    enabled: Boolean(plan.enabled),
    comingSoon: Boolean(plan.comingSoon),
    status: plan.comingSoon ? 'coming_soon' : plan.enabled ? 'active' : 'inactive'
  };
}

function publicVipSubscription(subscription, now = new Date()) {
  const startAt = new Date(subscription.startAt);
  const endAt = new Date(subscription.endAt);
  const lastClaimAt = subscription.lastClaimAt ? new Date(subscription.lastClaimAt) : null;
  const nextClaimAt = lastClaimAt
    ? new Date(lastClaimAt.getTime() + DAY_MS)
    : startAt;
  const active = subscription.status === 'active';
  const claimIndex = Number(subscription.claimsCompleted || 0);
  const canClaim = active
    && now < endAt
    && claimIndex < subscription.durationDays
    && now >= nextClaimAt;
  const todayRewardCents = active && claimIndex < subscription.durationDays
    ? dailyRewardCents(subscription.totalRewardCents, subscription.durationDays, claimIndex)
    : 0;
  return {
    id: String(subscription._id),
    planNumber: subscription.planNumber,
    pricePoints: subscription.pricePoints,
    monthlyRewardPercent: subscription.monthlyRewardPercent,
    durationDays: subscription.durationDays,
    totalRewardPoints: subscription.totalRewardPoints,
    dailyRewardAveragePoints: subscription.dailyRewardAveragePoints,
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    daysCompleted: active ? calculateDaysCompleted(startAt, subscription.durationDays, now) : subscription.durationDays,
    daysRemaining: active ? calculateDaysRemaining(endAt, now) : 0,
    claimsCompleted: claimIndex,
    totalClaims: subscription.durationDays,
    claimedRewardPoints: subscription.claimedRewardPoints,
    policyVersion: subscription.policyVersion || LEGACY_VIP_POLICY_VERSION,
    productGroup: subscription.productGroup || 'legacy',
    principalPaidDays: Number(subscription.principalPaidDays) || 0,
    principalPaidPoints: Number(subscription.principalPaidPoints) || 0,
    lastPrincipalPaidAt: subscription.lastPrincipalPaidAt ? new Date(subscription.lastPrincipalPaidAt).toISOString() : null,
    nextRewardPoints: todayRewardCents == null ? 0 : pointsFromCents(todayRewardCents),
    nextClaimAt: active && claimIndex < subscription.durationDays ? nextClaimAt.toISOString() : null,
    canClaim,
    status: subscription.status,
    principalReturnedAt: subscription.principalReturnedAt ? new Date(subscription.principalReturnedAt).toISOString() : null
  };
}

function sendVipError(res, error) {
  if (!error.statusCode) throw error;
  return res.status(error.statusCode).json({
    success: false,
    message: error.message,
    code: error.code,
    ...(error.retryAt ? { retryAt: new Date(error.retryAt).toISOString() } : {})
  });
}

/**
 * نکته مهم زمان‌بندی:
 * افغانستان UTC+4:30 است. یعنی ساعت 00:00 UTC دقیقاً برابر است با
 * ساعت 04:30 صبح به وقت کابل. پس به‌جای محاسبه‌ی پیچیده‌ی timezone،
 * کافی است "روز" را بر مبنای نیمه‌شب UTC حساب کنیم — این خودش دقیقاً
 * همان ریست ساعت 4:30 صبح افغانستان است.
 */
function nextResetTimestamp() {
  const currentDayKey = utcDayKey(new Date());
  return (currentDayKey + 1) * 86400000; // شروع روز UTC بعدی، به میلی‌ثانیه
}

function truncateAddress(address) {
  const s = String(address || '');
  if (s.length <= 14) return s;
  return `${s.slice(0, 6)}…${s.slice(-6)}`;
}

function publicConnectedWallet(user) {
  const wallet = user?.connectedWallet || {};
  return {
    connected: Boolean(wallet.address),
    address: wallet.address || '',
    canonicalAddress: wallet.canonicalAddress || '',
    network: wallet.network || '',
    walletApp: wallet.walletApp || '',
    connectedAt: wallet.connectedAt || null,
    lastSeenAt: wallet.lastSeenAt || null,
    proofVerifiedAt: wallet.proofVerifiedAt || null
  };
}

function hasRecentWalletProof(user) {
  const wallet = user?.connectedWallet || {};
  const proofAt = wallet.proofVerifiedAt ? new Date(wallet.proofVerifiedAt).getTime() : 0;
  return Boolean(wallet.address && wallet.network === '-239' && wallet.proofPublicKey && proofAt && proofAt <= Date.now());
}

// TON Connect performs the wallet handshake in the client. This endpoint only
// records the selected address for the authenticated GramUp account.
router.get('/wallet/connection', auth, async (req, res) => {
  res.json({ success: true, wallet: publicConnectedWallet(req.dbUser) });
});

// Restore a previously server-verified proof binding when TonConnect restores
// the same local wallet session without replaying the original ton_proof item.
router.post('/wallet/connection/restore', auth, async (req, res) => {
  const wallet = req.dbUser.connectedWallet || {};
  const requestedAddress = normalizeTonAddress(req.body?.address || '');
  const storedAddress = normalizeTonAddress(wallet.canonicalAddress || wallet.address || '');
  const proofAt = wallet.proofVerifiedAt ? new Date(wallet.proofVerifiedAt).getTime() : 0;
  if (!requestedAddress || req.body?.network !== '-239' || wallet.network !== '-239' ||
      requestedAddress !== storedAddress || !wallet.proofPublicKey || !proofAt || proofAt > Date.now()) {
    return res.status(409).json({ success: false, verified: false, code: 'WALLET_PROOF_REQUIRED', message: 'این Wallet قبلاً برای حساب شما تأیید نشده است.' });
  }
  const now = new Date();
  const updated = await User.findOneAndUpdate(
    { _id: req.dbUser._id },
    { $set: {
      'connectedWallet.lastSeenAt': now,
      'connectedWallet.walletApp': String(req.body?.walletApp || wallet.walletApp || '').trim().slice(0, 80)
    } },
    { new: true }
  );
  return res.json({ success: true, verified: true, wallet: publicConnectedWallet(updated) });
});

router.get('/wallet/chain-balance', auth, async (req, res) => {
  const address = req.dbUser.connectedWallet?.canonicalAddress || req.dbUser.connectedWallet?.address || '';
  if (!address) return res.status(409).json({ success: false, code: 'WALLET_NOT_CONNECTED', message: 'ابتدا Wallet خود را وصل کنید.' });
  try {
    const balance = await getNativeGramBalance(address);
    if (balance.status !== 'ok') {
      return res.status(502).json({ success: false, code: balance.code, message: 'موجودی Wallet فعلاً از شبکه دریافت نشد.' });
    }
    return res.json({ success: true, network: 'TON_MAINNET', token: 'GRAM', ...balance });
  } catch (error) {
    const code = error?.message === 'TON_PROVIDER_TIMEOUT' ? 'TON_PROVIDER_TIMEOUT' : 'TON_PROVIDER_UNAVAILABLE';
    return res.status(503).json({ success: false, code, message: 'ارتباط با شبکه TON فعلاً در دسترس نیست.' });
  }
});

router.post('/wallet/connection', auth, async (req, res) => {
  const address = String(req.body?.address || '').trim();
  const canonicalAddress = normalizeTonAddress(address);
  const network = String(req.body?.network || '').trim();
  if (!canonicalAddress || network !== '-239') {
    return res.status(400).json({ success: false, code: 'INVALID_CONNECTED_WALLET', message: 'Wallet باید یک آدرس معتبر TON Mainnet باشد.' });
  }

  const current = req.dbUser.connectedWallet || {};
  const now = new Date();
  const sameWallet = normalizeTonAddress(current.canonicalAddress || current.address) === canonicalAddress;
  const connectedAt = sameWallet ? (current.connectedAt || now) : now;
  const updated = await User.findOneAndUpdate(
    { _id: req.dbUser._id },
    { $set: {
      walletAddress: address,
      'connectedWallet.address': address,
      'connectedWallet.canonicalAddress': canonicalAddress,
      'connectedWallet.network': network,
      'connectedWallet.publicKey': String(req.body?.publicKey || '').trim().slice(0, 128),
      'connectedWallet.walletApp': String(req.body?.walletApp || '').trim().slice(0, 80),
      'connectedWallet.connectedAt': connectedAt,
      'connectedWallet.lastSeenAt': now,
      ...(!sameWallet ? { 'connectedWallet.proofVerifiedAt': null, 'connectedWallet.proofPublicKey': '' } : {})
    } },
    { new: true }
  );
  res.json({ success: true, wallet: publicConnectedWallet(updated) });
});

router.delete('/wallet/connection', auth, async (req, res) => {
  const updated = await User.findOneAndUpdate(
    { _id: req.dbUser._id },
    { $set: {
      walletAddress: '',
      connectedWallet: { address: '', canonicalAddress: '', network: '', publicKey: '', walletApp: '', connectedAt: null, lastSeenAt: null, proofVerifiedAt: null, proofPublicKey: '' }
    } },
    { new: true }
  );
  res.json({ success: true, wallet: publicConnectedWallet(updated) });
});

function getDepositSettingsStatus(settings) {
  const depositWalletAddress = String(settings?.depositWalletAddress || '').trim();
  const minimumDepositGram = Number(settings?.minimumDepositGram);
  const ready = settings?.depositEnabled === true
    && settings?.depositNetwork === 'TON_MAINNET'
    && normalizeTonAddress(depositWalletAddress)
    && amountToNanoGram(minimumDepositGram) != null;
  return { ready: Boolean(ready), depositWalletAddress, minimumDepositGram };
}

const { notifyUser } = require('../utils/bot');
const { botText } = require('../utils/botMessages');
const { postWithdrawalRequested } = require('../utils/payoutChannel');
const { synthesizeHistory } = require('../utils/withdrawalStatus');
const { getLevel } = require('../utils/levels');
const { withMongoTransaction } = require('../utils/mongoTransaction');
const { cycleDayForStreak, dailyCheckinReward } = require('../utils/dailyCheckin');

// GET /api/points/me
router.get('/me', auth, async (req, res) => {
  const u = req.dbUser;
  const settings = await Settings.getGlobal();

  const todayKey = utcDayKey(new Date());
  const canCheckIn = !u.lastCheckIn || utcDayKey(u.lastCheckIn) < todayKey;
  const minWithdrawGram = Number((settings.minWithdrawPoints * settings.rate).toFixed(6));

  // مجموع پوینتی که کاربر تا امروز «کسب» کرده (بدون احتساب تبدیل GRAM→پوینت و اصلاح دستی ادمین)
  const earnedAgg = await PointsLedger.aggregate([
    { $match: { user: u._id, currency: 'points', amount: { $gt: 0 }, type: { $nin: ['exchange_in', 'admin_adjust', 'vip_principal_return'] } } },
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]);
  const totalEarnedPoints = earnedAgg.length ? earnedAgg[0].total : 0;
  const level = getLevel(totalEarnedPoints);
  const withdrawalProgress = minWithdrawGram > 0
    ? Math.min(100, Math.round((u.gramBalance / minWithdrawGram) * 100))
    : 0;
  const withdrawalRemainingGram = Math.max(0, round6(minWithdrawGram - u.gramBalance));

  res.json({
    success: true,
    totalEarnedPoints,
    level,
    withdrawalProgress,
    withdrawalRemainingGram,
    gramUsdPrice: settings.gramUsdPrice || 0,
    points: u.points,
    gramBalance: u.gramBalance,
    rate: settings.rate,
    streak: u.streak,
    canCheckIn,
    totalCheckins: u.totalCheckins,
    firstName: u.firstName,
    minWithdrawGram,
    nextResetAt: nextResetTimestamp(),
    language: u.language
  });
});

// Daily Bonus Chest is retired. Historical ledger rows remain readable.
router.post('/daily-chest', auth, async (req, res) => {
  res.status(410).json({ success: false, code: 'DAILY_CHEST_DISABLED', message: 'Daily Bonus Chest is currently disabled.' });
});
// POST /api/points/checkin
router.post('/checkin', auth, async (req, res) => {
  const todayKey = utcDayKey(new Date());
  let result;
  try {
    result = await withMongoTransaction(async session => {
      const current = await User.findById(req.dbUser._id).session(session);
      if (!current) throw new Error('کاربر پیدا نشد.');
      if (current.lastCheckIn && utcDayKey(current.lastCheckIn) === todayKey) {
        const error = new Error('امروز قبلاً ورود روزانه ثبت شده است.');
        error.code = 'ALREADY_CHECKED_IN';
        throw error;
      }

      const wasYesterday = current.lastCheckIn && wasUtcYesterday(current.lastCheckIn, todayKey * DAY_MS);
      // The streak remains historical, while payment follows the seven-day cycle.
      const newStreak = wasYesterday ? current.streak + 1 : 1;
      const earned = dailyCheckinReward(newStreak);
      const cycleDay = cycleDayForStreak(newStreak);
      const inc = { points: earned, totalCheckins: 1 };

      const updated = await User.findOneAndUpdate(
        { _id: current._id, lastCheckIn: current.lastCheckIn || null },
        { $set: { streak: newStreak, lastCheckIn: new Date() }, $inc: inc },
        { new: true, session }
      );
      if (!updated) {
        const error = new Error('امروز قبلاً ورود روزانه ثبت شده است.');
        error.code = 'ALREADY_CHECKED_IN';
        throw error;
      }
      await recordLedgerRequired({
        user: updated._id,
        type: 'checkin',
        amount: earned,
        description: `ورود روزانه (روز ${cycleDay} از چرخه ۷روزه)`,
        balanceAfter: updated.points,
        sourceId: `checkin:${updated._id}:${todayKey}`,
        session
      });
      return { updated, earned, cycleDay };
    });
  } catch (error) {
    if (error.code === 'ALREADY_CHECKED_IN') return res.status(400).json({ success: false, message: error.message, code: error.code });
    throw error;
  }

  res.json({
    success: true,
    earned: result.earned,
    points: result.updated.points,
    streak: result.updated.streak,
    cycleDay: result.cycleDay,
    nextResetAt: nextResetTimestamp()
  });
});

const round6 = n => Number(Number(n).toFixed(6));

/**
 * POST /api/points/exchange — تبدیل دوطرفه پوینت <-> موجودی GRAM
 * (بر اساس نرخ فعلی؛ این مبلغ بعداً از طریق «برداشت» قابل خارج شدن است)
 * body: { direction: 'points_to_gram' | 'gram_to_points', amount }
 * برای سازگاری با نسخه‌ی قبلی، body.points هم به‌عنوان amount برای points_to_gram پذیرفته می‌شود.
 */
router.post('/exchange', auth, async (req, res) => {
  const u = req.dbUser;
  const settings = await Settings.getGlobal();
  const body = req.body || {};
  const direction = body.direction === 'gram_to_points' ? 'gram_to_points' : 'points_to_gram';

  if (!settings.rate || settings.rate <= 0) {
    return res.status(400).json({ success: false, message: 'نرخ تبدیل نامعتبر است.', code: 'INVALID_RATE' });
  }

  if (direction === 'points_to_gram') {
    const points = Math.floor(Number(body.amount != null ? body.amount : body.points) || 0);

    if (!Number.isFinite(points) || points <= 0) {
      return res.status(400).json({ success: false, message: 'مقدار پوینت نامعتبر است.', code: 'INVALID_AMOUNT' });
    }

    const gramGained = round6(points * settings.rate);
    let operation;
    const operationKey = String(req.get('Idempotency-Key') || '').trim();
    try {
      operation = await executeIdempotently({
        userId: u._id,
        scope: 'exchange_points_to_gram',
        key: operationKey,
        body: { direction, points },
        execute: async session => {
        const result = await User.findOneAndUpdate(
          { _id: u._id, points: { $gte: points } },
          { $inc: { points: -points, gramBalance: gramGained } },
          { new: true, session }
        );
        if (!result) {
          const error = new Error('موجودی پوینت کافی نیست.');
          error.code = 'INSUFFICIENT_BALANCE';
          throw error;
        }
        await recordLedgerRequired({ user: u._id, type: 'exchange_out', currency: 'points', amount: -points, description: 'تبدیل پوینت به GRAM', balanceAfter: result.points, sourceId: `exchange:${u._id}:${direction}:${operationKey}:out`, transactionId: idempotencyTransactionId({ userId: u._id, scope: 'exchange_points_to_gram', key: operationKey, leg: 'out' }), session });
        await recordLedgerRequired({ user: u._id, type: 'exchange_in', currency: 'gram', amount: gramGained, description: 'تبدیل پوینت به GRAM', balanceAfter: result.gramBalance, sourceId: `exchange:${u._id}:${direction}:${operationKey}:in`, transactionId: idempotencyTransactionId({ userId: u._id, scope: 'exchange_points_to_gram', key: operationKey, leg: 'in' }), session });
        return { body: {
          success: true,
          direction,
          message: `${points} پوینت به ${gramGained} GRAM تبدیل شد.`,
          points: result.points,
          gramBalance: result.gramBalance,
          gramGained
        } };
        }
      });
    } catch (error) {
      if (error.code === 'INSUFFICIENT_BALANCE') return res.status(400).json({ success: false, message: error.message, code: error.code });
      if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message, code: error.code });
      throw error;
    }
    return res.status(operation.status).json(operation.body);
  }

  // direction === 'gram_to_points'
  const gram = round6(body.amount || 0);

  if (!Number.isFinite(gram) || gram <= 0) {
    return res.status(400).json({ success: false, message: 'مقدار GRAM نامعتبر است.', code: 'INVALID_AMOUNT' });
  }

  const pointsGained = Math.floor(gram / settings.rate);

  if (pointsGained <= 0) {
    return res.status(400).json({ success: false, message: 'مقدار GRAM برای تبدیل بسیار کم است.', code: 'INVALID_AMOUNT' });
  }

  const gramSpent = round6(pointsGained * settings.rate);

  let operation;
  const operationKey = String(req.get('Idempotency-Key') || '').trim();
  try {
    operation = await executeIdempotently({
      userId: u._id,
      scope: 'exchange_gram_to_points',
      key: operationKey,
      body: { direction, gram },
      execute: async session => {
      const result = await User.findOneAndUpdate(
        { _id: u._id, gramBalance: { $gte: gramSpent } },
        { $inc: { gramBalance: -gramSpent, points: pointsGained } },
        { new: true, session }
      );
      if (!result) {
        const error = new Error('موجودی GRAM کافی نیست.');
        error.code = 'INSUFFICIENT_BALANCE';
        throw error;
      }
      await recordLedgerRequired({ user: u._id, type: 'exchange_out', currency: 'gram', amount: -gramSpent, description: 'تبدیل GRAM به پوینت', balanceAfter: result.gramBalance, sourceId: `exchange:${u._id}:${direction}:${operationKey}:out`, transactionId: idempotencyTransactionId({ userId: u._id, scope: 'exchange_gram_to_points', key: operationKey, leg: 'out' }), session });
      await recordLedgerRequired({ user: u._id, type: 'exchange_in', currency: 'points', amount: pointsGained, description: 'تبدیل GRAM به پوینت', balanceAfter: result.points, sourceId: `exchange:${u._id}:${direction}:${operationKey}:in`, transactionId: idempotencyTransactionId({ userId: u._id, scope: 'exchange_gram_to_points', key: operationKey, leg: 'in' }), session });
      return { body: {
        success: true,
        direction,
        message: `${gramSpent} GRAM به ${pointsGained} پوینت تبدیل شد.`,
        points: result.points,
        gramBalance: result.gramBalance,
        pointsGained
      } };
      }
    });
  } catch (error) {
    if (error.code === 'INSUFFICIENT_BALANCE') return res.status(400).json({ success: false, message: error.message, code: error.code });
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message, code: error.code });
    throw error;
  }

  res.status(operation.status).json(operation.body);
});

// POST /api/points/withdraw — برداشت از موجودی GRAM (نه مستقیم از پوینت)
router.post('/withdraw', auth, async (req, res) => {
  const u = req.dbUser;
  const settings = await Settings.getGlobal();
  const { gram, address } = req.body || {};
  const amount = round6(gram);
  const walletAddress = String(address || '').trim();
  const minWithdrawGram = round6(settings.minWithdrawPoints * settings.rate);

  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ success: false, message: 'مقدار GRAM نامعتبر است.', code: 'INVALID_AMOUNT' });
  }
  if (!/^[A-Za-z0-9_\-:+/=.]{6,120}$/.test(walletAddress)) {
    return res.status(400).json({ success: false, message: 'آدرس کیف پول نامعتبر است.', code: 'INVALID_ADDRESS' });
  }
  const connectedAddress = String(u.connectedWallet?.address || '').trim();
  if (!hasRecentWalletProof(u) || u.connectedWallet?.network !== '-239') {
    return res.status(403).json({ success: false, message: 'برای برداشت، یک Wallet تأییدشده در TON Mainnet وصل کنید.', code: 'WALLET_PROOF_REQUIRED' });
  }
  if (!connectedAddress || walletAddress !== connectedAddress) {
    return res.status(409).json({ success: false, message: 'آدرس برداشت باید با Wallet متصل‌شده یکسان باشد.', code: 'WALLET_ADDRESS_MISMATCH' });
  }
  if (amount < minWithdrawGram) {
    return res.status(400).json({
      success: false,
      message: `حداقل مقدار برداشت ${minWithdrawGram} GRAM است.`,
      code: 'BELOW_MIN_WITHDRAW'
    });
  }

  let operation;
  const operationKey = String(req.get('Idempotency-Key') || '').trim();
  try {
    operation = await executeIdempotently({
      userId: u._id,
      scope: 'withdraw',
      key: operationKey,
      body: { amount, address: walletAddress },
      execute: async session => {
        const nextUser = await User.findOneAndUpdate(
          { _id: u._id, gramBalance: { $gte: amount } },
          { $inc: { gramBalance: -amount }, $set: { walletAddress } },
          { new: true, session }
        );
        if (!nextUser) {
          const error = new Error('موجودی GRAM کافی نیست.');
          error.code = 'INSUFFICIENT_BALANCE';
          throw error;
        }

        const nextWithdrawal = await new Withdrawal({
          user: u._id,
          pointsSpent: settings.rate > 0 ? Math.round(amount / settings.rate) : 0,
          cryptoAmount: amount,
          address: walletAddress,
          statusHistory: [{ status: 'pending', at: new Date() }]
        }).save({ session });

        const ledger = await recordLedgerRequired({
          user: u._id,
          type: 'withdraw',
          currency: 'gram',
          amount: -amount,
          description: `درخواست برداشت به ${truncateAddress(walletAddress)}`,
          balanceAfter: nextUser.gramBalance,
          sourceId: `withdrawal:${nextWithdrawal._id}`,
          transactionId: idempotencyTransactionId({ userId: u._id, scope: 'withdraw', key: operationKey, leg: 'debit' }),
          session
        });
        if (!ledger.created) throw new Error('Withdrawal ledger entry already exists; transaction aborted.');

        return { status: 201, resourceId: nextWithdrawal._id, body: {
          success: true,
          message: 'درخواست برداشت ثبت شد و به‌زودی بررسی می‌شود.',
          gramBalance: nextUser.gramBalance,
          withdrawalId: String(nextWithdrawal._id)
        } };
      }
    });
  } catch (error) {
    if (error.code === 'INSUFFICIENT_BALANCE') return res.status(400).json({ success: false, message: error.message, code: error.code });
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message, code: error.code });
    throw error;
  }

  res.status(operation.status).json(operation.body);
  if (!operation.replayed) {
    notifyUser(u.telegramId, botText('withdrawalSubmitted', u.language, amount, 'GRAM')).catch(() => {});
    Withdrawal.findById(operation.body.withdrawalId).lean()
      .then(createdWithdrawal => {
        if (createdWithdrawal) return postWithdrawalRequested(u, createdWithdrawal);
        throw new Error('Created withdrawal record was not found for payout notification.');
      })
      .catch(error => console.error('[withdrawal] payout request notification failed:', error.message || error));
  }
});

// GET /api/points/withdrawals/:id — جزئیات و Timeline یک برداشت مشخص (فقط برای صاحب همان برداشت)
router.get('/withdrawals/:id', auth, async (req, res) => {
  const withdrawal = await Withdrawal.findOne({ _id: req.params.id, user: req.dbUser._id });
  if (!withdrawal) return res.status(404).json({ success: false, message: 'رکورد پیدا نشد.' });

  res.json({
    success: true,
    withdrawal: {
      _id: withdrawal._id,
      cryptoAmount: withdrawal.cryptoAmount,
      token: withdrawal.token,
      network: withdrawal.network,
      status: withdrawal.status,
      address: truncateAddress(withdrawal.address),
      txHash: withdrawal.txHash,
      adminNote: withdrawal.status === 'rejected' || withdrawal.status === 'cancelled' ? withdrawal.adminNote : '',
      createdAt: withdrawal.createdAt,
      paidAt: withdrawal.paidAt,
      timeline: synthesizeHistory(withdrawal)
    }
  });
});

// GET /api/points/withdrawals
router.get('/withdrawals', auth, async (req, res) => {
  const list = await Withdrawal.find({ user: req.dbUser._id }).sort({ createdAt: -1 }).limit(30);
  res.json({ success: true, withdrawals: list.map(withdrawal => ({ ...withdrawal.toObject(), timeline: synthesizeHistory(withdrawal) })) });
});

// Native GRAM deposits use one project-controlled TON Mainnet wallet and a unique invoice comment.
router.get('/deposit/config', auth, async (req, res) => {
  const settings = await Settings.getGlobal();
  const config = getDepositSettingsStatus(settings);
  res.json({
    success: true,
    enabled: config.ready,
    network: 'TON_MAINNET',
    token: 'GRAM',
    depositWalletAddress: config.ready ? config.depositWalletAddress : '',
    minimumDepositGram: config.minimumDepositGram > 0 ? config.minimumDepositGram : null
  });
});

function publicDepositRecord(deposit) {
  return {
    _id: String(deposit._id),
    reference: deposit.reference,
    network: deposit.network,
    token: deposit.token,
    depositWalletAddress: deposit.depositAddressSnapshot,
    requestedAmount: deposit.requestedAmount,
    minimumDepositGram: deposit.minimumDepositSnapshot,
    amount: deposit.amount,
    txHash: deposit.txHash || deposit.submittedTxHash || '',
    status: deposit.status,
    createdAt: deposit.createdAt,
    verifiedAt: deposit.verifiedAt,
    creditedAt: deposit.creditedAt
  };
}

router.get('/deposits', auth, async (req, res) => {
  const deposits = await Deposit.find({ user: req.dbUser._id, assetType: 'native_gram' })
    .sort({ createdAt: -1 })
    .limit(30)
    .select('reference network token assetType depositAddressSnapshot minimumDepositSnapshot requestedAmount amount submittedTxHash txHash status createdAt verifiedAt creditedAt');
  res.json({ success: true, deposits: deposits.map(publicDepositRecord) });
});

router.post('/deposits', auth, async (req, res) => {
  const settings = await Settings.getGlobal();
  const config = getDepositSettingsStatus(settings);
  if (!config.ready) {
    return res.status(503).json({ success: false, code: 'DEPOSIT_DISABLED', message: 'واریز GRAM روی TON Mainnet در حال حاضر فعال نیست.' });
  }
  if (!hasRecentWalletProof(req.dbUser)) {
    return res.status(401).json({ success: false, code: 'WALLET_PROOF_REQUIRED', message: 'برای واریز ابتدا Wallet را وصل و مالکیت آن را تأیید کنید.' });
  }
  const requestedAmount = round6(req.body?.amount);
  const requestedAmountRaw = amountToNanoGram(requestedAmount);
  if (requestedAmountRaw == null) {
    return res.status(400).json({ success: false, code: 'INVALID_AMOUNT', message: 'مقدار GRAM برای واریز معتبر نیست.' });
  }
  const minimumRaw = amountToNanoGram(config.minimumDepositGram);
  if (minimumRaw == null || requestedAmountRaw < minimumRaw) {
    return res.status(400).json({ success: false, code: 'DEPOSIT_BELOW_MINIMUM', message: `حداقل مبلغ واریز ${config.minimumDepositGram} GRAM است.` });
  }

  // Close any unverified invoice from the former Jetton-only implementation. It is
  // never eligible for Native GRAM credit; changing status releases the legacy
  // one-pending-invoice-per-user unique index without altering balances.
  await Deposit.updateMany(
    { user: req.dbUser._id, status: 'pending', assetType: { $ne: 'native_gram' } },
    { $set: { status: 'rejected', verificationNote: 'legacy_jetton_deposit_disabled', verifiedAt: new Date() } }
  );
  let existing = await Deposit.findOne({ user: req.dbUser._id, assetType: 'native_gram', status: 'pending' }).sort({ createdAt: -1 });
  if (existing && !existing.requestedAmountRaw) {
    existing = await Deposit.findOneAndUpdate(
      { _id: existing._id, user: req.dbUser._id, status: 'pending' },
      { $set: { status: 'rejected', verificationNote: 'replaced_by_wallet_deposit_intent', verifiedAt: new Date() } },
      { new: false }
    );
    existing = null;
  }
  if (existing) {
    if (existing.requestedAmountRaw && existing.requestedAmountRaw !== requestedAmountRaw.toString()) {
      return res.status(409).json({ success: false, code: 'DEPOSIT_ALREADY_PENDING', message: 'یک واریز قبلی هنوز در حال تأیید است.' });
    }
    return res.json({ success: true, deposit: publicDepositRecord(existing), transaction: {
      validUntil: Math.floor(Date.now() / 1000) + 600,
      network: '-239',
      messages: [{ address: existing.depositAddressSnapshot, amount: existing.requestedAmountRaw, payload: comment(existing.reference).toBoc().toString('base64') }]
    } });
  }

  let deposit;
  try {
    deposit = await Deposit.create({
      user: req.dbUser._id,
      reference: createDepositReference(),
      network: 'TON_MAINNET',
      token: 'GRAM',
      assetType: 'native_gram',
      depositAddressSnapshot: config.depositWalletAddress,
      walletAddressSnapshot: req.dbUser.connectedWallet.address,
      minimumDepositSnapshot: config.minimumDepositGram,
      requestedAmount,
      requestedAmountRaw: requestedAmountRaw.toString(),
      status: 'pending'
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    deposit = await Deposit.findOne({ user: req.dbUser._id, assetType: 'native_gram', status: 'pending' }).sort({ createdAt: -1 });
    if (!deposit) throw error;
    return res.json({ success: true, deposit: publicDepositRecord(deposit), transaction: {
      validUntil: Math.floor(Date.now() / 1000) + 600,
      network: '-239',
      messages: [{ address: deposit.depositAddressSnapshot, amount: deposit.requestedAmountRaw, payload: comment(deposit.reference).toBoc().toString('base64') }]
    } });
  }
  return res.status(201).json({ success: true, deposit: publicDepositRecord(deposit), transaction: {
    validUntil: Math.floor(Date.now() / 1000) + 600,
    network: '-239',
    messages: [{ address: deposit.depositAddressSnapshot, amount: deposit.requestedAmountRaw, payload: comment(deposit.reference).toBoc().toString('base64') }]
  } });
});

router.post('/deposits/:id/verify', auth, async (req, res) => {
  if (!/^[a-f\d]{24}$/i.test(String(req.params.id || ''))) {
    return res.status(404).json({ success: false, message: 'درخواست Deposit پیدا نشد.' });
  }
  const deposit = await Deposit.findOne({ _id: req.params.id, user: req.dbUser._id, assetType: 'native_gram' });
  if (!deposit) return res.status(404).json({ success: false, message: 'درخواست Deposit پیدا نشد.' });
  if (deposit.status === 'confirmed') {
    const user = await User.findById(req.dbUser._id).select('gramBalance');
    return res.json({ success: true, alreadyConfirmed: true, status: 'confirmed', amount: deposit.amount, gramBalance: user?.gramBalance ?? 0, deposit: publicDepositRecord(deposit) });
  }
  if (deposit.status === 'rejected') {
    return res.status(409).json({ success: false, code: 'DEPOSIT_REJECTED', status: 'rejected', deposit: publicDepositRecord(deposit), message: 'این واریز با حداقل مبلغ لازم مطابقت ندارد و اعتباری اضافه نشده است.' });
  }

  const submittedHash = normalizeTonTxHash(req.body?.txHash);

  let verification;
  try {
    verification = submittedHash
      ? await verifyNativeGramTransfer({ txHash: submittedHash, depositAddress: deposit.depositAddressSnapshot, reference: deposit.reference })
      : await findIncomingNativeGramTransferByReference({ depositAddress: deposit.depositAddressSnapshot, reference: deposit.reference });
  } catch {
    return res.status(503).json({ success: false, code: 'TON_PROVIDER_UNAVAILABLE', message: 'TON Center در دسترس نیست؛ موجودی تغییر نکرده است. دوباره تلاش کنید.' });
  }

  if (verification.status === 'pending') {
    await Deposit.updateOne(
      { _id: deposit._id, user: req.dbUser._id, status: 'pending' },
          { $set: { ...(submittedHash ? { submittedTxHash: submittedHash } : {}), verificationNote: verification.code || 'pending' } }
    );
    return res.status(202).json({
      success: true,
      status: 'pending',
      code: verification.code,
      message: 'تراکنش هنوز در TON Mainnet قابل تأیید نیست. چند لحظه بعد دوباره Check کنید؛ تا تأیید واقعی موجودی اضافه نمی‌شود.'
    });
  }
  if (verification.status !== 'verified') {
    return res.status(400).json({
      success: false,
      code: verification.code || 'DEPOSIT_VERIFICATION_FAILED',
      message: 'تراکنش Native GRAM، آدرس دریافت، Reference یا وضعیت نهایی Mainnet مطابقت ندارد؛ موجودی تغییر نکرد.'
    });
  }

  const minimumRaw = amountToNanoGram(deposit.minimumDepositSnapshot);
  const actualRaw = BigInt(verification.amountRaw);
  if (minimumRaw == null) {
    return res.status(503).json({ success: false, code: 'INVALID_DEPOSIT_SETTINGS', message: 'تنظیم حداقل Deposit با دقت ۹ رقم اعشار Native GRAM سازگار نیست؛ موجودی تغییر نکرد.' });
  }

  if (deposit.walletAddressSnapshot) {
    const expectedSource = normalizeTonAddress(deposit.walletAddressSnapshot);
    if (!expectedSource || verification.sourceAddress !== expectedSource) {
      return res.status(400).json({ success: false, code: 'DEPOSIT_SOURCE_WALLET_MISMATCH', message: 'این تراکنش از Wallet متصل‌شده ارسال نشده است؛ موجودی تغییر نکرد.' });
    }
  }

  if (deposit.requestedAmountRaw && actualRaw !== BigInt(deposit.requestedAmountRaw)) {
    return res.status(400).json({ success: false, code: 'DEPOSIT_AMOUNT_MISMATCH', message: 'مبلغ تراکنش با مبلغ انتخاب‌شده مطابقت ندارد؛ موجودی تغییر نکرد.' });
  }

  if (actualRaw < minimumRaw) {
    try {
      const rejected = await Deposit.findOneAndUpdate(
        { _id: deposit._id, user: req.dbUser._id, status: 'pending', txHashNormalized: { $exists: false } },
        { $set: {
          status: 'rejected', amount: verification.amount, amountRaw: verification.amountRaw,
          submittedTxHash: submittedHash, txHash: verification.txHash, txHashNormalized: verification.txHash,
          sourceAddress: verification.sourceAddress, verificationNote: 'below_minimum', verifiedAt: verification.confirmedAt
        } },
        { new: true }
      );
      if (!rejected) return res.status(409).json({ success: false, code: 'DEPOSIT_ALREADY_PROCESSED', message: 'این تراکنش قبلاً پردازش شده است.' });
      return res.status(400).json({ success: false, code: 'DEPOSIT_BELOW_MINIMUM', status: 'rejected', deposit: publicDepositRecord(rejected), message: 'مبلغ تأییدشده از حداقل Deposit کمتر است؛ هیچ GRAM به موجودی اضافه نشد.' });
    } catch (error) {
      if (error?.code === 11000) return res.status(409).json({ success: false, code: 'DEPOSIT_TX_ALREADY_USED', message: 'این Transaction Hash قبلاً استفاده شده است.' });
      throw error;
    }
  }

  let outcome;
  try {
    await withMongoTransaction(async session => {
      const now = new Date();
      const claimed = await Deposit.findOneAndUpdate(
        { _id: deposit._id, user: req.dbUser._id, status: 'pending', txHashNormalized: { $exists: false } },
        { $set: {
          status: 'confirmed', amount: verification.amount, amountRaw: verification.amountRaw,
          submittedTxHash: submittedHash, txHash: verification.txHash, txHashNormalized: verification.txHash,
          sourceAddress: verification.sourceAddress, verificationNote: 'confirmed_native_gram_by_toncenter_v3_mainnet',
          verifiedAt: verification.confirmedAt, creditedAt: now
        } },
        { new: true, session }
      );

      if (!claimed) {
        const current = await Deposit.findById(deposit._id).session(session);
        if (current?.status === 'confirmed') {
          outcome = { alreadyConfirmed: true, deposit: current, gramBalance: null };
          return;
        }
        const conflict = new Error('DEPOSIT_ALREADY_PROCESSED');
        conflict.code = 'DEPOSIT_ALREADY_PROCESSED';
        throw conflict;
      }

      const updatedUser = await User.findByIdAndUpdate(
        req.dbUser._id,
        { $inc: { gramBalance: verification.amount } },
        { new: true, session }
      );
      if (!updatedUser) throw new Error('DEPOSIT_USER_NOT_FOUND');

      const ledgerResult = await recordLedgerRequired({
        user: updatedUser._id,
        type: 'deposit',
        currency: 'gram',
        amount: verification.amount,
        description: 'Deposit — Native GRAM on TON Mainnet',
        balanceAfter: updatedUser.gramBalance,
        sourceId: `deposit:${verification.txHash}`,
        transactionId: verification.txHash,
        session
      });
      if (!ledgerResult.created) throw new Error('DEPOSIT_LEDGER_ALREADY_EXISTS');
      outcome = { alreadyConfirmed: false, deposit: claimed, gramBalance: updatedUser.gramBalance };
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, code: 'DEPOSIT_TX_ALREADY_USED', message: 'این Transaction Hash قبلاً برای یک Deposit استفاده شده است.' });
    }
    if (error?.code === 'DEPOSIT_ALREADY_PROCESSED') {
      const current = await Deposit.findById(deposit._id);
      if (current?.status === 'confirmed') {
        const user = await User.findById(req.dbUser._id).select('gramBalance');
        return res.json({ success: true, alreadyConfirmed: true, status: 'confirmed', amount: current.amount, gramBalance: user?.gramBalance ?? 0, deposit: publicDepositRecord(current) });
      }
      return res.status(409).json({ success: false, code: error.code, message: 'این درخواست قبلاً پردازش شده است.' });
    }
    throw error;
  }

  if (outcome?.alreadyConfirmed) {
    const user = await User.findById(req.dbUser._id).select('gramBalance');
    return res.json({
      success: true,
      alreadyConfirmed: true,
      status: 'confirmed',
      amount: outcome.deposit.amount,
      gramBalance: user?.gramBalance ?? 0,
      deposit: publicDepositRecord(outcome.deposit)
    });
  }

  return res.json({
    success: true,
    alreadyConfirmed: Boolean(outcome?.alreadyConfirmed),
    status: 'confirmed',
    amount: verification.amount,
    gramBalance: outcome?.gramBalance,
    deposit: publicDepositRecord(outcome.deposit),
    message: 'واریز Native GRAM در TON Mainnet تأیید شد و موجودی افزایش یافت.'
  });
});

function publicSwapIntent(intent) {
  return {
    _id: String(intent._id),
    direction: intent.direction,
    status: intent.status,
    reference: intent.reference,
    amount: intent.amount,
    expectedPoints: intent.expectedPoints,
    rate: intent.rateSnapshot,
    depositAddress: intent.depositAddressSnapshot,
    walletAddress: intent.walletAddressSnapshot,
    txHash: intent.txHash || intent.submittedTxHash || '',
    createdAt: intent.createdAt,
    verifiedAt: intent.verifiedAt,
    creditedAt: intent.creditedAt
  };
}

// Creates a server-priced, single-pending Swap intent. The wallet signs the
// transaction; no points are credited until the receiving transaction is
// found, finalized and matched to this exact reference and source wallet.
router.post('/swap/gram-to-points/intents', auth, async (req, res) => {
  const settings = await Settings.getGlobal();
  const config = getDepositSettingsStatus(settings);
  const wallet = req.dbUser.connectedWallet || {};
  if (!hasRecentWalletProof(req.dbUser) || wallet.network !== '-239') {
    return res.status(401).json({ success: false, code: 'WALLET_PROOF_REQUIRED', message: 'برای Swap ابتدا Wallet تأییدشدهٔ TON Mainnet را وصل کنید.' });
  }
  if (!config.ready || !settings.rate || settings.rate <= 0) {
    return res.status(503).json({ success: false, code: 'SWAP_UNAVAILABLE', message: 'Swap خودکار فعلاً فعال نیست؛ تنظیمات شبکه یا نرخ کامل نیست.' });
  }
  const amount = round6(req.body?.amount);
  const amountRaw = amountToNanoGram(amount);
  const expectedPoints = Math.floor(amount / settings.rate);
  if (amountRaw == null || expectedPoints <= 0) {
    return res.status(400).json({ success: false, code: 'INVALID_AMOUNT', message: 'مقدار GRAM برای تبدیل معتبر نیست.' });
  }
  const reference = createDepositReference().replace('GRAMUP:', 'GRAMUP:SWAP:');
  let intent;
  try {
    intent = await GramSwapIntent.create({
      user: req.dbUser._id,
      direction: 'gram_to_points',
      reference,
      amount,
      amountRaw: amountRaw.toString(),
      expectedPoints,
      rateSnapshot: settings.rate,
      depositAddressSnapshot: config.depositWalletAddress,
      walletAddressSnapshot: wallet.address
    });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ success: false, code: 'SWAP_ALREADY_PENDING', message: 'یک Swap قبلی هنوز در حال بررسی است.' });
    throw error;
  }
  const payload = comment(reference).toBoc().toString('base64');
  return res.status(201).json({
    success: true,
    intent: publicSwapIntent(intent),
    transaction: {
      validUntil: Math.floor(Date.now() / 1000) + 600,
      network: '-239',
      messages: [{ address: config.depositWalletAddress, amount: amountRaw.toString(), payload }]
    }
  });
});

router.get('/swap/gram-to-points/intents/:id', auth, async (req, res) => {
  if (!/^[a-f\d]{24}$/i.test(String(req.params.id || ''))) return res.status(404).json({ success: false, code: 'SWAP_INTENT_NOT_FOUND', message: 'درخواست Swap پیدا نشد.' });
  const intent = await GramSwapIntent.findOne({ _id: req.params.id, user: req.dbUser._id });
  if (!intent) return res.status(404).json({ success: false, code: 'SWAP_INTENT_NOT_FOUND', message: 'درخواست Swap پیدا نشد.' });
  return res.json({ success: true, intent: publicSwapIntent(intent) });
});

router.post('/swap/gram-to-points/intents/:id/verify', auth, async (req, res) => {
  if (!/^[a-f\d]{24}$/i.test(String(req.params.id || ''))) return res.status(404).json({ success: false, code: 'SWAP_INTENT_NOT_FOUND', message: 'درخواست Swap پیدا نشد.' });
  const intent = await GramSwapIntent.findOne({ _id: req.params.id, user: req.dbUser._id });
  if (!intent) return res.status(404).json({ success: false, code: 'SWAP_INTENT_NOT_FOUND', message: 'درخواست Swap پیدا نشد.' });
  if (intent.status === 'confirmed') {
    const user = await User.findById(req.dbUser._id).select('points');
    return res.json({ success: true, status: 'confirmed', points: user?.points ?? 0, intent: publicSwapIntent(intent) });
  }
  const sourceAddress = normalizeTonAddress(intent.walletAddressSnapshot);
  let verification;
  try {
    verification = req.body?.txHash
      ? await verifyNativeGramTransfer({ txHash: req.body.txHash, depositAddress: intent.depositAddressSnapshot, reference: intent.reference })
      : await findIncomingNativeGramTransferByReference({ depositAddress: intent.depositAddressSnapshot, reference: intent.reference });
  } catch {
    return res.status(503).json({ success: false, code: 'TON_PROVIDER_UNAVAILABLE', message: 'بررسی TON فعلاً در دسترس نیست؛ موجودی تغییر نکرد.' });
  }
  if (verification.status === 'pending') {
    await GramSwapIntent.updateOne({ _id: intent._id, user: req.dbUser._id, status: 'pending' }, { $set: { verificationNote: verification.code || 'pending' } });
    return res.status(202).json({ success: true, status: 'pending', code: verification.code, intent: publicSwapIntent(intent), message: 'تراکنش هنوز در TON نهایی نشده است؛ چند لحظه بعد دوباره بررسی کنید.' });
  }
  if (verification.status !== 'verified') return res.status(400).json({ success: false, code: verification.code || 'SWAP_VERIFICATION_FAILED', message: 'تراکنش Swap با Reference معتبر مطابقت ندارد؛ هیچ Point اضافه نشد.' });
  if (sourceAddress && verification.sourceAddress !== sourceAddress) {
    return res.status(400).json({ success: false, code: 'SWAP_SOURCE_WALLET_MISMATCH', message: 'تراکنش از Wallet متصل‌شده ارسال نشده است؛ هیچ Point اضافه نشد.' });
  }
  const actualPoints = Math.floor(verification.amount / intent.rateSnapshot);
  if (actualPoints <= 0) return res.status(400).json({ success: false, code: 'SWAP_AMOUNT_TOO_SMALL', message: 'مبلغ تراکنش برای دریافت Point کافی نیست.' });
  let outcome;
  try {
    await withMongoTransaction(async session => {
      const claimed = await GramSwapIntent.findOneAndUpdate(
        { _id: intent._id, user: req.dbUser._id, status: 'pending', txHashNormalized: { $exists: false } },
        { $set: { status: 'confirmed', amount: verification.amount, amountRaw: verification.amountRaw, txHash: verification.txHash, txHashNormalized: verification.txHash, submittedTxHash: verification.submittedTxHash || '', sourceAddress: verification.sourceAddress, verificationNote: 'confirmed_native_gram_swap_by_toncenter_v3_mainnet', verifiedAt: verification.confirmedAt, creditedAt: new Date() } },
        { new: true, session }
      );
      if (!claimed) throw Object.assign(new Error('SWAP_ALREADY_PROCESSED'), { code: 'SWAP_ALREADY_PROCESSED' });
      const updated = await User.findByIdAndUpdate(req.dbUser._id, { $inc: { points: actualPoints } }, { new: true, session });
      if (!updated) throw new Error('SWAP_USER_NOT_FOUND');
      const ledgerResult = await recordLedgerRequired({ user: updated._id, type: 'exchange_in', currency: 'points', amount: actualPoints, description: 'Swap خودکار Native GRAM به Point', balanceAfter: updated.points, sourceId: `swap:${verification.txHash}`, transactionId: verification.txHash, session });
      if (!ledgerResult.created) throw new Error('SWAP_LEDGER_ALREADY_EXISTS');
      outcome = { intent: claimed, points: updated.points };
    });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ success: false, code: 'SWAP_TX_ALREADY_USED', message: 'این تراکنش قبلاً پردازش شده است.' });
    if (error?.code === 'SWAP_ALREADY_PROCESSED') return res.status(409).json({ success: false, code: error.code, message: 'این Swap قبلاً پردازش شده است.' });
    throw error;
  }
  return res.json({ success: true, status: 'confirmed', points: outcome.points, pointsGained: actualPoints, intent: publicSwapIntent(outcome.intent), message: `${actualPoints} Point با تأیید تراکنش TON اضافه شد.` });
});

// VIP catalog and user subscription state. Plan values are always read from
// the server-side catalog; no price, duration, or reward amount is accepted
// from the client.
router.get('/vip/plans', auth, async (req, res) => {
  const now = new Date();
  await settleMaturedVipSubscriptions({ userId: req.dbUser._id, now });
  const [plans, subscriptions, user] = await Promise.all([
    VipPlan.find({}).sort({ planNumber: 1 }).lean(),
    VipSubscription.find({ user: req.dbUser._id }).sort({ createdAt: -1 }).limit(30).lean(),
    User.findById(req.dbUser._id).select('points').lean()
  ]);
  res.json({
    success: true,
    serverNow: now.toISOString(),
    points: user?.points ?? req.dbUser.points,
    plans: plans.map(publicVipPlan),
    subscriptions: subscriptions.map(subscription => publicVipSubscription(subscription, now))
  });
});

router.post('/vip/purchase', auth, async (req, res) => {
  const planNumber = Number(req.body?.planNumber);
  if (!Number.isInteger(planNumber) || planNumber < 1 || planNumber > 10) {
    return res.status(400).json({ success: false, code: 'VIP_PLAN_INVALID', message: 'پلن VIP نامعتبر است.' });
  }

  let operation;
  try {
    operation = await executeIdempotently({
      userId: req.dbUser._id,
      scope: 'vip_purchase',
      key: req.get('Idempotency-Key'),
      body: { planNumber },
      execute: async session => {
        const plan = await VipPlan.findOne({ planNumber }).session(session);
        if (!plan || plan.enabled !== true || plan.comingSoon === true) {
          throw vipError('VIP_PLAN_UNAVAILABLE', 'این پلن VIP در حال حاضر برای خرید فعال نیست.', 409);
        }
        const pricePoints = Number(plan.pricePoints);
        const settings = await Settings.findOne({ key: 'global' }).session(session).lean();
        const policyVersion = String(plan.policyVersion || LEGACY_VIP_POLICY_VERSION);
        if (policyVersion === NEW_VIP_POLICY_VERSION && (!settings?.vipNewPurchasesEnabled || !settings?.vipPolicyEffectiveAt || new Date() < new Date(settings.vipPolicyEffectiveAt))) {
          throw vipError('VIP_NEW_POLICY_NOT_ACTIVE', 'نسخه جدید VIP هنوز برای خرید فعال نشده است.', 409);
        }
        const newPolicy = policyVersion === NEW_VIP_POLICY_VERSION
          ? newVipPolicyForPlan(planNumber, settings.vipPolicyEffectiveAt)
          : null;
        if (policyVersion === NEW_VIP_POLICY_VERSION && !newPolicy) {
          throw vipError('VIP_POLICY_INVALID', 'گروه سیاست VIP معتبر نیست.', 409);
        }
        const durationDays = newPolicy?.durationDays || Number(plan.durationDays);
        const legacyRewardCents = calculateTotalRewardCents(pricePoints, plan.monthlyRewardPercent, plan.durationDays);
        const totalRewardCents = newPolicy
          ? dailyPointsCentsFromBps(pricePoints, newPolicy.rewardDailyBps) * durationDays
          : legacyRewardCents;
        if (!Number.isInteger(pricePoints) || pricePoints < 1 || totalRewardCents == null || totalRewardCents < durationDays) {
          throw vipError('VIP_PLAN_INVALID', 'تنظیمات پاداش این پلن معتبر نیست؛ با مدیریت تماس بگیرید.', 409);
        }

        const user = await User.findOneAndUpdate(
          { _id: req.dbUser._id, points: { $gte: pricePoints } },
          { $inc: { points: -pricePoints } },
          { new: true, session }
        );
        if (!user) throw vipError('VIP_INSUFFICIENT_POINTS', 'موجودی Points برای خرید این پلن کافی نیست.', 400);

        const startAt = new Date();
        const endAt = new Date(startAt.getTime() + durationDays * DAY_MS);
        const totalRewardPoints = pointsFromCents(totalRewardCents);
        const subscription = new VipSubscription({
          user: user._id,
          planNumber: plan.planNumber,
          pricePoints,
          monthlyRewardPercent: plan.monthlyRewardPercent,
          durationDays,
          policyVersion,
          policyEffectiveAt: newPolicy?.policyEffectiveAt || null,
          productGroup: newPolicy?.productGroup || 'legacy',
          principalDailyBps: newPolicy?.principalDailyBps || 0,
          rewardDailyBps: newPolicy?.rewardDailyBps || 0,
          totalRewardCents,
          totalRewardPoints,
          dailyRewardAveragePoints: Number((totalRewardPoints / durationDays).toFixed(2)),
          startAt,
          endAt,
          status: 'active'
        });
        await subscription.save({ session });

        // A successful, paid VIP subscription completes its matching one-time task.
        // This is deliberately inside the same transaction as the debit and purchase ledger.
        let finalPoints = user.points;
        let activationTaskReward = null;
        const taskDefinition = vipActivationTaskDefinition(planNumber);
        const vipTask = await Task.findOneAndUpdate(
          { taskKind: 'vip_activation', vipPlanNumber: planNumber },
          { $setOnInsert: taskDefinition },
          { upsert: true, new: true, session, setDefaultsOnInsert: true }
        );
        const existingVipCompletion = await TaskCompletion.findOne({ user: user._id, task: vipTask._id }).session(session);
        if (!existingVipCompletion) {
          const taskCompletion = await new TaskCompletion({
            user: user._id,
            task: vipTask._id,
            reward: vipTask.reward,
            status: 'approved',
            reviewedAt: startAt,
            reviewedBy: 'vip-purchase-system'
          }).save({ session });
          const rewarded = await User.findByIdAndUpdate(
            user._id,
            { $inc: { points: vipTask.reward } },
            { new: true, session }
          );
          if (!rewarded) throw vipError('VIP_TASK_USER_NOT_FOUND', 'کاربر برای ثبت پاداش Task پیدا نشد.', 500);
          finalPoints = rewarded.points;
          activationTaskReward = { task: vipTask, amount: vipTask.reward, balanceAfter: rewarded.points };
        }

        const ledger = await recordLedgerRequired({
          user: user._id,
          type: 'vip_purchase',
          currency: 'points',
          amount: -pricePoints,
          description: '',
          balanceAfter: user.points,
          sourceId: `vip:${subscription._id}:purchase`,
          transactionId: idempotencyTransactionId({ userId: user._id, scope: 'vip_purchase', key: req.get('Idempotency-Key'), leg: `plan-${planNumber}` }),
          session
        });
        if (!ledger.created) throw vipError('VIP_LEDGER_DUPLICATE', 'این خرید قبلاً ثبت شده است.', 409);

        // Persist ledger entries in the same order as the balance mutations:
        // debit first, then (if newly earned) the activation-task credit.
        if (activationTaskReward) {
          const taskLedger = await recordLedgerRequired({
            user: user._id,
            type: 'task',
            currency: 'points',
            amount: activationTaskReward.amount,
            description: activationTaskReward.task.title,
            balanceAfter: activationTaskReward.balanceAfter,
            sourceId: `vip-task:${activationTaskReward.task._id}:user:${user._id}`,
            transactionId: idempotencyTransactionId({ userId: user._id, scope: 'vip_purchase', key: req.get('Idempotency-Key'), leg: `activation-task-${planNumber}` }),
            session
          });
          if (!taskLedger.created) throw vipError('VIP_TASK_LEDGER_DUPLICATE', 'پاداش Task این خرید قبلاً ثبت شده است.', 409);
        }

        return { body: {
          success: true,
          points: finalPoints,
          subscription: publicVipSubscription(subscription, startAt)
        } };
      }
    });
  } catch (error) {
    return sendVipError(res, error);
  }
  return res.status(operation.status).json(operation.body);
});

router.post('/vip/:subscriptionId/claim', auth, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.subscriptionId)) {
    return res.status(400).json({ success: false, code: 'VIP_SUBSCRIPTION_INVALID', message: 'شناسه اشتراک VIP نامعتبر است.' });
  }

  let operation;
  try {
    operation = await executeIdempotently({
      userId: req.dbUser._id,
      scope: 'vip_daily_claim',
      key: req.get('Idempotency-Key'),
      body: { subscriptionId: String(req.params.subscriptionId) },
      execute: async session => {
        const now = new Date();
        const subscription = await VipSubscription.findOne({ _id: req.params.subscriptionId, user: req.dbUser._id }).session(session);
        if (!subscription) throw vipError('VIP_SUBSCRIPTION_NOT_FOUND', 'اشتراک VIP پیدا نشد.', 404);
        if (subscription.status !== 'active' || now >= subscription.endAt) {
          throw vipError('VIP_PLAN_COMPLETED', 'دوره این پلن به پایان رسیده است.', 409);
        }
        const claimIndex = Number(subscription.claimsCompleted || 0);
        if (claimIndex >= subscription.durationDays) throw vipError('VIP_REWARDS_COMPLETE', 'پاداش روزانه این پلن کامل شده است.', 409);
        const nextClaimAt = subscription.lastClaimAt
          ? new Date(subscription.lastClaimAt.getTime() + DAY_MS)
          : new Date(subscription.startAt);
        if (now < nextClaimAt) {
          throw vipError('VIP_CLAIM_NOT_READY', 'پاداش بعدی پس از گذشت ۲۴ ساعت قابل دریافت است.', 409, { retryAt: nextClaimAt });
        }

        const rewardCents = dailyRewardCents(subscription.totalRewardCents, subscription.durationDays, claimIndex);
        const rewardPoints = pointsFromCents(rewardCents);
        if (!rewardCents || rewardPoints == null) throw vipError('VIP_REWARD_INVALID', 'مقدار پاداش روزانه معتبر نیست.', 409);
        const claimedRewardPoints = pointsFromCents(
          Math.round((Number(subscription.claimedRewardPoints || 0) * 100) + 1e-8) + rewardCents
        );
        const updatedSubscription = await VipSubscription.findOneAndUpdate(
          {
            _id: subscription._id,
            user: req.dbUser._id,
            status: 'active',
            endAt: { $gt: now },
            claimsCompleted: claimIndex,
            lastClaimAt: subscription.lastClaimAt || null
          },
          { $set: { claimsCompleted: claimIndex + 1, claimedRewardPoints, lastClaimAt: now } },
          { new: true, session }
        );
        if (!updatedSubscription) throw vipError('VIP_CLAIM_CONFLICT', 'این پاداش هم‌زمان در درخواست دیگری ثبت شده است؛ وضعیت را تازه‌سازی کنید.', 409);

        const user = await User.findOneAndUpdate(
          { _id: req.dbUser._id },
          { $inc: { points: rewardPoints } },
          { new: true, session }
        );
        if (!user) throw new Error('VIP subscriber no longer exists.');

        const sourceId = `vip:${subscription._id}:claim:${claimIndex + 1}`;
        const ledger = await recordLedgerRequired({
          user: user._id,
          type: 'vip_daily_reward',
          currency: 'points',
          amount: rewardPoints,
          description: '',
          balanceAfter: user.points,
          sourceId,
          transactionId: idempotencyTransactionId({ userId: user._id, scope: 'vip_daily_claim', key: req.get('Idempotency-Key'), leg: `${subscription._id}-claim-${claimIndex + 1}` }),
          session
        });
        if (!ledger.created) throw vipError('VIP_LEDGER_DUPLICATE', 'این پاداش قبلاً ثبت شده است.', 409);

        return { body: {
          success: true,
          rewardPoints,
          points: user.points,
          subscription: publicVipSubscription(updatedSubscription, now)
        } };
      }
    });
  } catch (error) {
    return sendVipError(res, error);
  }
  return res.status(operation.status).json(operation.body);
});

/**
 * GET /api/points/history — stable descending cursor on (createdAt, _id).
 * `before` remains supported for already-open legacy clients.
 */
router.get('/history', auth, async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 50);
  let cursor = null;
  if (req.query.cursor) {
    try {
      const encoded = String(req.query.cursor);
      if (encoded.length > 512) throw new Error('cursor too long');
      const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
      const createdAt = new Date(parsed?.createdAt);
      if (!createdAt || Number.isNaN(createdAt.getTime()) || !mongoose.isValidObjectId(parsed?._id)) throw new Error('invalid cursor');
      cursor = { createdAt, _id: new mongoose.Types.ObjectId(parsed._id) };
    } catch {
      return res.status(400).json({ success: false, code: 'INVALID_HISTORY_CURSOR', message: 'Cursor تاریخچه نامعتبر است.' });
    }
  }
  const before = !cursor && req.query.before ? new Date(req.query.before) : null;
  const timeFilter = cursor
    ? { $or: [
      { createdAt: { $lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, _id: { $lt: cursor._id } }
    ] }
    : before && !Number.isNaN(before.getTime()) ? { createdAt: { $lt: before } } : {};
  const ledgerFilter = { user: req.dbUser._id, ...timeFilter };
  const depositFilter = {
    user: req.dbUser._id,
    assetType: 'native_gram',
    status: { $in: ['pending', 'rejected', 'confirmed'] },
    ...timeFilter
  };

  const [ledgerItems, depositItems] = await Promise.all([
    PointsLedger.find(ledgerFilter).sort({ createdAt: -1, _id: -1 }).limit(limit + 1).lean(),
    Deposit.find(depositFilter).sort({ createdAt: -1, _id: -1 }).limit(limit + 1)
      .select('assetType amount submittedTxHash txHash status createdAt verifiedAt creditedAt')
      .lean()
  ]);
  const depositByHash = new Map(depositItems.filter(item => item.status === 'confirmed' && item.txHash)
    .map(item => [String(item.txHash).toLowerCase(), item]));
  const history = ledgerItems.map(item => {
    if (item.type !== 'deposit') return item;
    const linkedDeposit = depositByHash.get(String(item.transactionId || '').toLowerCase());
    return { ...item, status: 'confirmed', transactionAt: linkedDeposit?.verifiedAt || item.createdAt };
  });
  for (const item of depositItems) {
    if (item.status === 'confirmed') continue;
    history.push({
      _id: item._id, type: 'deposit', currency: 'gram', amount: item.amount,
      transactionId: item.txHash || item.submittedTxHash || '', status: item.status,
      description: '', createdAt: item.createdAt, transactionAt: item.verifiedAt || item.createdAt,
      verifiedAt: item.verifiedAt, creditedAt: item.creditedAt
    });
  }
  history.sort((a, b) => {
    const timeDiff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    return timeDiff || String(b._id).localeCompare(String(a._id));
  });
  const page = history.slice(0, limit);
  const hasMore = history.length > limit || ledgerItems.length > limit || depositItems.length > limit;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last?._id && last?.createdAt
    ? Buffer.from(JSON.stringify({ createdAt: new Date(last.createdAt).toISOString(), _id: String(last._id) })).toString('base64url')
    : null;

  res.json({ success: true, history: page, hasMore, nextCursor });
});

/**
 * GET /api/points/public-history — فید عمومیِ پرداخت‌های واقعاً انجام‌شده (وضعیت paid)،
 * برای شفافیت و اعتمادسازی. عمداً بدون اطلاعات هویتی کاربر (نه نام، نه یوزرنیم)؛
 * فقط آدرس‌ها (کوتاه‌شده)، مبلغ، هش تراکنش و تاریخ. نیازی به لاگین ندارد.
 */
router.get('/public-history', async (req, res) => {
  const [list, totals] = await Promise.all([
    Withdrawal.find({ status: 'paid' })
      .sort({ paidAt: -1 })
      .select('cryptoAmount token network address fromAddress txHash verified paidAt'),
    Withdrawal.aggregate([
      { $match: { status: 'paid' } },
      {
        $group: {
          _id: { $ifNull: ['$token', 'GRAM'] },
          total: { $sum: { $ifNull: ['$cryptoAmount', 0] } }
        }
      }
    ])
  ]);

  const totalByToken = Object.fromEntries(totals.map(item => [item._id, item.total]));

  res.json({
    success: true,
    totalByToken,
    history: list.map(w => ({
      type: 'withdrawal',
      amount: w.cryptoAmount,
      token: w.token,
      network: w.network,
      // فقط آدرس کوتاه‌شده به بیرون داده می‌شود (مطابق سیاست حریم خصوصی)؛ آدرس کامل کیف‌پول کاربر عمومی نمی‌شود
      toAddress: truncateAddress(w.address),
      fromAddress: truncateAddress(w.fromAddress),
      txHash: w.txHash,
      verified: w.verified,
      date: w.paidAt
    }))
  });
});

module.exports = router;
