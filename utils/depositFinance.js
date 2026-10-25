'use strict';

const Deposit = require('../models/Deposit');
const User = require('../models/User');
const { recordLedgerRequired } = require('./ledger');
const { recordAdminLogRequired } = require('./adminLog');
const { withMongoTransaction } = require('./mongoTransaction');

/**
 * Credits one already provider-verified native GRAM deposit exactly once.
 * The caller must validate the chain transfer, source wallet and amount before
 * entering this helper. Deposit state, user balance, Ledger and admin audit
 * are committed together.
 */
async function creditVerifiedDeposit({ depositId, verification, submittedHash = '', actor = 'ادمین', note = '' }) {
  if (!depositId || verification?.status !== 'verified' || !verification.txHash || !Number.isFinite(Number(verification.amount))) {
    const error = new Error('اطلاعات تراکنش برای اعتباردهی Deposit کامل نیست.');
    error.code = 'INVALID_VERIFIED_DEPOSIT';
    throw error;
  }

  return withMongoTransaction(async session => {
    const claimed = await Deposit.findOneAndUpdate(
      { _id: depositId, status: 'pending', txHashNormalized: { $exists: false } },
      { $set: {
        status: 'confirmed',
        amount: verification.amount,
        amountRaw: verification.amountRaw,
        submittedTxHash: submittedHash || verification.submittedTxHash || '',
        txHash: verification.txHash,
        txHashNormalized: verification.txHash,
        sourceAddress: verification.sourceAddress || '',
        verificationNote: note || 'confirmed_native_gram_by_admin_after_toncenter_verification',
        verifiedAt: verification.confirmedAt || new Date(),
        creditedAt: new Date()
      } },
      { new: true, session }
    );

    if (!claimed) {
      const current = await Deposit.findById(depositId).session(session);
      if (current?.status === 'confirmed') return { alreadyConfirmed: true, deposit: current };
      const error = new Error('این Deposit قبلاً پردازش شده یا دیگر در انتظار نیست.');
      error.code = 'DEPOSIT_ALREADY_PROCESSED';
      throw error;
    }

    const updatedUser = await User.findByIdAndUpdate(
      claimed.user,
      { $inc: { gramBalance: verification.amount } },
      { new: true, session }
    );
    if (!updatedUser) {
      const error = new Error('کاربر Deposit پیدا نشد.');
      error.code = 'DEPOSIT_USER_NOT_FOUND';
      throw error;
    }

    const ledger = await recordLedgerRequired({
      user: updatedUser._id,
      type: 'deposit',
      currency: 'gram',
      amount: verification.amount,
      description: 'Deposit — Native GRAM on TON Mainnet (Admin verified)',
      balanceAfter: updatedUser.gramBalance,
      sourceId: `deposit:${verification.txHash}`,
      transactionId: verification.txHash,
      session
    });
    if (!ledger.created) {
      const error = new Error('Ledger این Deposit قبلاً ثبت شده است.');
      error.code = 'DEPOSIT_LEDGER_ALREADY_EXISTS';
      throw error;
    }

    await recordAdminLogRequired({
      actor,
      action: 'deposit_approve',
      targetType: 'deposit',
      targetId: claimed._id,
      details: `${verification.amount} GRAM — ${verification.txHash}`
    }, session);

    return { alreadyConfirmed: false, deposit: claimed, user: updatedUser };
  });
}

async function rejectPendingDeposit({ depositId, actor = 'ادمین', reason }) {
  const cleanReason = String(reason || '').trim().slice(0, 500);
  if (!cleanReason) {
    const error = new Error('برای لغو Deposit دلیل الزامی است.');
    error.code = 'DEPOSIT_REASON_REQUIRED';
    throw error;
  }
  return withMongoTransaction(async session => {
    const rejected = await Deposit.findOneAndUpdate(
      { _id: depositId, status: 'pending' },
      { $set: { status: 'rejected', verificationNote: `admin_rejected: ${cleanReason}`, verifiedAt: new Date() } },
      { new: true, session }
    );
    if (!rejected) {
      const error = new Error('این Deposit پیدا نشد یا دیگر در انتظار نیست.');
      error.code = 'DEPOSIT_NOT_PENDING';
      throw error;
    }
    await recordAdminLogRequired({
      actor,
      action: 'deposit_reject',
      targetType: 'deposit',
      targetId: rejected._id,
      details: cleanReason
    }, session);
    return rejected;
  });
}

module.exports = { creditVerifiedDeposit, rejectPendingDeposit };
