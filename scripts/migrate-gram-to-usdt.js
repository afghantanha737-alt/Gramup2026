'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Deposit = require('../models/Deposit');

async function run() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required.');
  await mongoose.connect(process.env.MONGO_URI);
  const users = await User.collection.updateMany(
    { usdtBalance: { $exists: false }, gramBalance: { $exists: true } },
    [{ $set: { usdtBalance: '$gramBalance' } }]
  );
  const deposits = await Deposit.collection.updateMany(
    { assetType: 'native_gram', status: { $in: ['pending', 'verifying'] } },
    { $set: { status: 'rejected', verificationNote: 'legacy_native_gram_rejected_during_usdt_migration', verifiedAt: new Date() } }
  );
  console.log(JSON.stringify({ copiedUserBalances: users.modifiedCount, rejectedLegacyDeposits: deposits.modifiedCount }));
}

run().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
}).finally(async () => {
  await mongoose.disconnect().catch(() => {});
});
