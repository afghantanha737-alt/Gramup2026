'use strict';

const Withdrawal = require('../models/Withdrawal');
const User = require('../models/User');
const { recordLedgerRequired } = require('./ledger');
const { withMongoTransaction } = require('./mongoTransaction');
const { recordAdminLogRequired } = require('./adminLog');

async function transitionWithdrawalWithRefund({ withdrawalId, targetStatus, reason = '', expectedStatus, allowedStatuses, audit }) {
  return withMongoTransaction(async session => {
    const current = await Withdrawal.findById(withdrawalId).session(session);
    if (!current) {
      const error = new Error('درخواست برداشت پیدا نشد.');
      error.code = 'WITHDRAWAL_NOT_FOUND';
      throw error;
    }
    if (expectedStatus && current.status !== expectedStatus) {
      const error = new Error('وضعیت این درخواست هم‌زمان تغییر کرده است.');
      error.code = 'WITHDRAWAL_CONFLICT';
      throw error;
    }
    if (!allowedStatuses.includes(current.status)) {
      const error = new Error('این درخواست قابل بازگشت وجه نیست.');
      error.code = 'WITHDRAWAL_NOT_REFUNDABLE';
      throw error;
    }

    const withdrawal = await Withdrawal.findOneAndUpdate(
      { _id: current._id, status: current.status },
      {
        $set: { status: targetStatus, adminNote: reason },
        $push: { statusHistory: { status: targetStatus, at: new Date(), note: reason } }
      },
      { new: true, session }
    );
    if (!withdrawal) {
      const error = new Error('وضعیت این درخواست هم‌زمان تغییر کرده است.');
      error.code = 'WITHDRAWAL_CONFLICT';
      throw error;
    }

    const token = String(withdrawal.asset || withdrawal.token || 'USDT').toUpperCase();
    const balanceField = token === 'GRAM' ? 'gramBalance' : 'usdtBalance';
    const currency = token === 'GRAM' ? 'gram' : 'usdt';
    const refunded = await User.findByIdAndUpdate(
      withdrawal.user,
      { $inc: { [balanceField]: withdrawal.cryptoAmount } },
      { new: true, session }
    );
    if (!refunded) {
      const error = new Error('کاربر برداشت پیدا نشد؛ عملیات لغو شد.');
      error.code = 'WITHDRAWAL_USER_NOT_FOUND';
      throw error;
    }

    const refundLedger = await recordLedgerRequired({
      user: refunded._id,
      type: 'admin_adjust',
      currency,
      asset: token,
      amount: withdrawal.cryptoAmount,
      description: targetStatus === 'cancelled'
        ? 'بازگشت USDT بابت لغو درخواست برداشت'
        : 'بازگشت USDT بابت رد درخواست برداشت',
      balanceAfter: refunded[balanceField],
      sourceId: `withdrawal-refund:${withdrawal._id}`,
      session
    });
    if (!refundLedger.created) {
      const error = new Error('بازگشت وجه قبلاً در Ledger ثبت شده است؛ تراکنش لغو شد.');
      error.code = 'WITHDRAWAL_REFUND_DUPLICATE';
      throw error;
    }

    if (audit) await recordAdminLogRequired({ ...audit, targetId: withdrawal._id }, session);

    return { withdrawal, refunded };
  });
}

module.exports = { transitionWithdrawalWithRefund };
