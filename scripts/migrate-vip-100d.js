'use strict';
require('dotenv').config();
const mongoose = require('mongoose');
const Settings = require('../models/Settings');
const VipPlan = require('../models/VipPlan');
const VipReserve = require('../models/VipReserve');
const { NEW_VIP_POLICY_VERSION, NEW_VIP_DURATION_DAYS, newVipPolicyForPlan } = require('../utils/vipPolicy');
const { verifyMongoTransactionCapability } = require('../utils/mongoTransaction');

function parseArgs(argv) {
  const options = { apply: false, help: false };
  for (const arg of argv) {
    if (arg === '--apply') options.apply = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function printHelp() {
  console.log([
    'VIP 100-day transition (legacy subscriptions remain unchanged)',
    '',
    'Dry run (default): npm run migrate:vip-100d',
    'Apply after database backup and Reserve funding review: npm run migrate:vip-100d -- --apply',
    '',
    'The migration only changes the purchase catalog and global VIP purchase policy.',
    'It never updates, cancels, settles, or re-prices existing VipSubscription documents.',
    'New purchases remain protected by the atomic Reserve check in /api/points/vip/purchase.'
  ].join('\n'));
}

function buildPlanUpdate(plan) {
  const policy = newVipPolicyForPlan(plan.planNumber);
  if (!policy) throw new Error(`No 100-day policy exists for plan ${plan.planNumber}.`);
  return {
    durationDays: NEW_VIP_DURATION_DAYS,
    policyVersion: NEW_VIP_POLICY_VERSION,
    productGroup: policy.productGroup,
    principalDailyBps: policy.principalDailyBps,
    rewardDailyBps: policy.rewardDailyBps
  };
}

async function inspectCatalog() {
  const [plans, settings, reserve] = await Promise.all([
    VipPlan.find({}).sort({ planNumber: 1 }).lean(),
    Settings.findOne({ key: 'global' }).lean(),
    VipReserve.findOne({ key: 'global' }).lean()
  ]);
  if (plans.length !== 10) throw new Error(`Expected exactly 10 VIP plans; found ${plans.length}.`);
  const currentSettings = settings || {};
  const updates = plans.map(plan => ({ planNumber: plan.planNumber, ...buildPlanUpdate(plan) }));
  return {
    plans,
    updates,
    settings: {
      policyVersion: currentSettings.vipPolicyVersion || 'legacy_v1',
      newPurchasesEnabled: currentSettings.vipNewPurchasesEnabled === true,
      payoutsEnabled: currentSettings.vipPayoutsEnabled === true,
      effectiveAt: currentSettings.vipPolicyEffectiveAt || null
    },
    reserve: {
      availablePoints: Number(((reserve?.availablePointsCents || 0) / 100).toFixed(2)),
      reservedPoints: Number(((reserve?.reservedPointsCents || 0) / 100).toFixed(2)),
      fundedPoints: Number(((reserve?.fundedPointsCents || 0) / 100).toFixed(2))
    }
  };
}

async function applyTransition(report) {
  const effectiveAt = report.settings.effectiveAt || new Date();
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      for (const update of report.updates) {
        await VipPlan.updateOne(
          { planNumber: update.planNumber },
          { $set: {
            durationDays: update.durationDays,
            policyVersion: update.policyVersion,
            productGroup: update.productGroup,
            principalDailyBps: update.principalDailyBps,
            rewardDailyBps: update.rewardDailyBps
          } },
          { session }
        );
      }
      await Settings.updateOne(
        { key: 'global' },
        { $set: {
          vipPolicyVersion: NEW_VIP_POLICY_VERSION,
          vipPolicyEffectiveAt: effectiveAt,
          vipNewPurchasesEnabled: true,
          vipPayoutsEnabled: true
        } },
        { session, upsert: true }
      );
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' });
  } finally {
    await session.endSession();
  }
  return { effectiveAt };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) { printHelp(); return { help: true }; }
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required.');
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  try {
    const report = await inspectCatalog();
    if (options.apply) {
      const capability = await verifyMongoTransactionCapability();
      if (!capability.supported) throw new Error(`MongoDB transactions are required for --apply: ${capability.reason}`);
      const result = await applyTransition(report);
      console.log(JSON.stringify({ mode: 'apply', ...report, applied: result }, null, 2));
      return { mode: 'apply', ...report, applied: result };
    }
    console.log(JSON.stringify({ mode: 'dry-run', ...report, warning: report.reserve.availablePoints <= 0 ? 'Reserve is currently empty; new purchases will fail closed until it is funded.' : null }, null, 2));
    return { mode: 'dry-run', ...report };
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`VIP 100-day migration failed: ${error.message || error}`);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, buildPlanUpdate, inspectCatalog, applyTransition, main };
