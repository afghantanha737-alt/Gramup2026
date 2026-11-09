'use strict';
const express = require('express');
const router = express.Router();
require('../utils/asyncHandler').wrapRouter(router);
const { getAdminSession } = require('../utils/adminSession');
const { isValidAdminKey } = require('../utils/adminKey');
const { withMongoTransaction } = require('../utils/mongoTransaction');
const { recordLedgerRequired } = require('../utils/ledger');
const AdOrder = require('../models/AdOrder');
const Task = require('../models/Task');
const User = require('../models/User');
const { publicOrder } = require('../utils/adCampaign');

async function requireAdmin(req, res, next) {
  const session = await getAdminSession(req.headers['x-admin-session']).catch(() => null);
  const legacyAllowed = process.env.ALLOW_LEGACY_ADMIN_KEY === 'true';
  if (!session && (!legacyAllowed || !isValidAdminKey(String(req.headers['x-admin-key'] || '')))) return res.status(403).json({ success: false, message: 'دسترسی غیرمجاز.' });
  req.adminActor = session?.actor || String(req.headers['x-admin-name'] || '').trim() || 'ادمین';
  next();
}
router.use(requireAdmin);

router.get('/', async (req, res) => {
  const filter = req.query.status && ['pending_review','approved','running','completed','rejected','cancelled'].includes(req.query.status) ? { status: req.query.status } : {};
  const orders = await AdOrder.find(filter).sort({ createdAt: -1 }).limit(200).lean();
  res.json({ success: true, orders: orders.map(publicOrder) });
});

router.post('/:id/approve', async (req, res) => {
  const order = await withMongoTransaction(async session => {
    const current = await AdOrder.findOne({ _id: req.params.id, status: 'pending_review', paymentStatus: 'paid' }).session(session);
    if (!current) throw Object.assign(new Error('سفارش در وضعیت قابل تأیید نیست.'), { code: 'ORDER_NOT_REVIEWABLE' });
    const task = await new Task({ title: current.title, description: current.description, type: 'channel', verifyType: current.verificationType, chatId: current.telegramChatId, url: current.destinationUrl, requiredReaction: current.requiredReaction, reward: current.rewardUp, maxCompletions: current.completionsRequested, completedCount: 0, isActive: true, isSponsored: true, sponsorName: current.advertiserName || 'Advertiser', sponsorPriceUsd: 0, sponsorBudgetUsd: 0 }).save({ session });
    current.status = 'running'; current.task = task._id; current.reviewedBy = req.adminActor; current.reviewedAt = new Date();
    await current.save({ session });
    return current;
  }).catch(error => { throw error; });
  res.json({ success: true, order: publicOrder(order) });
});

router.post('/:id/reject', async (req, res) => {
  try {
    const order = await withMongoTransaction(async session => {
      const current = await AdOrder.findOne({ _id: req.params.id, status: 'pending_review', paymentStatus: 'paid' }).session(session);
      if (!current) throw Object.assign(new Error('سفارش در وضعیت قابل رد نیست.'), { code: 'ORDER_NOT_REVIEWABLE' });
      const user = await User.findOne({ telegramId: current.advertiserTelegramId }).session(session);
      if (!user) throw Object.assign(new Error('تبلیغ‌دهنده پیدا نشد.'), { code: 'USER_NOT_FOUND' });
      const sourceId = `ad-order-refund:${current._id}`;
      const after = Number((Number(user.gramBalance || 0) + Number(current.totalCostGram)).toFixed(9));
      user.gramBalance = after; await user.save({ session });
      await recordLedgerRequired({ user: user._id, type: 'ad_order_refund', currency: 'gram', amount: current.totalCostGram, balanceAfter: after, sourceId, description: `Refund rejected ad campaign ${current._id}`, session });
      current.status = 'rejected'; current.paymentStatus = 'refunded'; current.refundSourceId = sourceId; current.reviewedBy = req.adminActor; current.reviewedAt = new Date(); current.reviewNote = String(req.body?.note || '').slice(0, 500);
      await current.save({ session }); return current;
    });
    res.json({ success: true, order: publicOrder(order) });
  } catch (error) {
    const status = ['ORDER_NOT_REVIEWABLE','USER_NOT_FOUND'].includes(error.code) ? 409 : 500;
    res.status(status).json({ success: false, code: error.code || 'AD_ORDER_REJECT_FAILED', message: error.message || 'رد کمپین انجام نشد.' });
  }
});
module.exports = router;
