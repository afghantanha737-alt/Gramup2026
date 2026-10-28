'use strict';
require('dotenv').config();
const mongoose = require('mongoose');
const VipPlan = require('../models/VipPlan');
const { pricingForVipPlan } = require('../utils/vipPricing');
const { NEW_VIP_POLICY_VERSION, groupForPlan, newVipPolicyForPlan, periodRewardPercentForPlan } = require('../utils/vipPolicy');
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
    'VIP pricing migration — catalog only; existing subscriptions remain unchanged',
    '',
    'Dry run (default): npm run migrate:vip-pricing',
    'Apply after backup/review: npm run migrate:vip-pricing -- --apply',
    '',
    'The migration syncs the 10 fixed Points prices, 100-day policy and catalog reward settings. It never modifies VipSubscription documents.'
  ].join('\n'));
}

async function inspectCatalog() {
  const plans = await VipPlan.find({}).sort({ planNumber: 1 }).lean();
  if (plans.length !== 10) throw new Error(`Expected exactly 10 VIP plans; found ${plans.length}.`);
  const byNumber = new Map(plans.map(plan => [Number(plan.planNumber), plan]));
  const updates = Array.from({ length: 10 }, (_, index) => {
    const planNumber = index + 1;
    const prior = byNumber.get(planNumber);
    const pricing = pricingForVipPlan(planNumber);
    const policy = newVipPolicyForPlan(planNumber);
    if (!prior || !pricing || !policy) throw new Error(`No catalog entry/policy exists for VIP ${planNumber}.`);
    return {
      planNumber,
      oldPricePoints: prior.pricePoints,
      oldPeriodYieldPercent: prior.monthlyRewardPercent,
      ...pricing,
      monthlyRewardPercent: periodRewardPercentForPlan(planNumber),
      durationDays: 100,
      policyVersion: NEW_VIP_POLICY_VERSION,
      productGroup: groupForPlan(planNumber),
      principalDailyBps: policy.principalDailyBps,
      rewardDailyBps: policy.rewardDailyBps
    };
  });
  return { updates };
}

async function applyPricing(report) {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      for (const update of report.updates) {
        await VipPlan.updateOne(
          { planNumber: update.planNumber },
          { $set: {
            pricePoints: update.pricePoints,
            monthlyRewardPercent: update.monthlyRewardPercent,
            durationDays: update.durationDays,
            policyVersion: update.policyVersion,
            productGroup: update.productGroup,
            principalDailyBps: update.principalDailyBps,
            rewardDailyBps: update.rewardDailyBps
          } },
          { session }
        );
      }
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' });
  } finally {
    await session.endSession();
  }
  return { updatedPlans: report.updates.length };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) { printHelp(); return { help: true }; }
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required.');
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  try {
    const report = await inspectCatalog();
    if (!options.apply) {
      console.log(JSON.stringify({ mode: 'dry-run', ...report }, null, 2));
      return { mode: 'dry-run', ...report };
    }
    const capability = await verifyMongoTransactionCapability();
    if (!capability.supported) throw new Error(`MongoDB transactions are required for --apply: ${capability.reason}`);
    const applied = await applyPricing(report);
    console.log(JSON.stringify({ mode: 'apply', ...report, applied }, null, 2));
    return { mode: 'apply', ...report, applied };
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`VIP pricing migration failed: ${error.message || error}`);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, inspectCatalog, applyPricing, main };
