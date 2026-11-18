'use strict';

const Deposit = require('../models/Deposit');

const UNSIGNED_DEPOSIT_TTL_MS = 2 * 60 * 1000;

async function expireUnsignedNativeDeposits(now = new Date()) {
  const cutoff = new Date(now.getTime() - UNSIGNED_DEPOSIT_TTL_MS);
  const result = await Deposit.updateMany(
    {
      assetType: 'native_gram',
      status: 'pending',
      createdAt: { $lt: cutoff },
      $and: [{ submittedBoc: { $in: ['', null] } }, { submittedTxHash: { $in: ['', null] } }]
    },
    { $set: { status: 'cancelled', verificationNote: 'unsigned_deposit_intent_expired', verifiedAt: now } }
  );
  return result.modifiedCount ?? result.nModified ?? 0;
}

module.exports = { UNSIGNED_DEPOSIT_TTL_MS, expireUnsignedNativeDeposits };
