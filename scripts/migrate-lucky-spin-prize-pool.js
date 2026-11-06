'use strict';

const mongoose = require('mongoose');
const Settings = require('../models/Settings');
const { defaultSpinPrizes, isValidSpinPrizePool } = require('../utils/spinRewards');

const APPLY = process.argv.includes('--apply');
const CONFIRMATION = 'SET_LUCKY_SPIN_REWARDS_TO_APPROVED_7';

function summarize(prizes) {
  return (Array.isArray(prizes) ? prizes : []).map(prize => ({
    id: String(prize?.id || ''),
    kind: String(prize?.kind || ''),
    amount: Number(prize?.amount) || 0,
    probability: Number(prize?.probability) || 0
  }));
}

async function main() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required; no database value will be printed.');
  if (APPLY && !process.argv.includes(`--confirm=${CONFIRMATION}`)) {
    throw new Error(`Apply requires the exact flag --confirm=${CONFIRMATION}`);
  }

  await mongoose.connect(process.env.MONGO_URI);
  try {
    const settings = await Settings.findOne({ key: 'global' }).select('luckySpinPrizes __v').lean();
    if (!settings) throw new Error('Global Settings document not found; migration made no changes.');

    const before = summarize(settings.luckySpinPrizes);
    const target = defaultSpinPrizes();
    console.log(JSON.stringify({
      mode: APPLY ? 'apply' : 'dry-run',
      document: 'Settings(key=global)',
      before,
      after: summarize(target),
      targetProbabilityTotal: target.reduce((sum, prize) => sum + prize.probability, 0),
      alreadyCanonical: isValidSpinPrizePool(settings.luckySpinPrizes)
    }, null, 2));

    if (!APPLY || isValidSpinPrizePool(settings.luckySpinPrizes)) return;

    const updated = await Settings.findOneAndUpdate(
      { _id: settings._id, __v: settings.__v },
      { $set: { luckySpinPrizes: target }, $inc: { __v: 1 } },
      { new: true, runValidators: true }
    ).select('luckySpinPrizes __v').lean();
    if (!updated) throw new Error('Settings changed during migration; no overwrite was applied. Re-run the dry-run and review the current pool.');
    if (!isValidSpinPrizePool(updated.luckySpinPrizes)) throw new Error('Post-update verification failed.');
    console.log('Updated only Settings.luckySpinPrizes; user balances, ledgers, transactions, and other Settings fields were not touched.');
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(error => {
  console.error(`[lucky-spin-prize-pool] ${error.message}`);
  process.exitCode = 1;
});
