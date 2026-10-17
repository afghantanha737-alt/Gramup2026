'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const ReferralRelationship = require('../models/ReferralRelationship');
const { verifyMongoTransactionCapability } = require('../utils/mongoTransaction');
const { reviewStatusOf } = require('../utils/referralCore');

function parseArgs(argv) {
  const options = { apply: false, limit: 5000, help: false };
  for (const arg of argv) {
    if (arg === '--apply') options.apply = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--limit=')) {
      const value = Number(arg.slice('--limit='.length));
      if (!Number.isInteger(value) || value < 1 || value > 50000) throw new Error('--limit must be an integer between 1 and 50000.');
      options.limit = value;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function printHelp() {
  console.log([
    'Referral v2 migration (safe, idempotent, no balance changes)',
    '',
    'Dry run (default): npm run migrate:referral-v2',
    'Apply after backup and review: npm run migrate:referral-v2 -- --apply',
    'Optional limit: npm run migrate:referral-v2 -- --limit=5000',
    '',
    'The migration only creates missing level-1 ReferralRelationship rows from User.referredBy.',
    'It never changes User balances, PointsLedger, or referral reward eligibility.'
  ].join('\n'));
}

function relationshipStatus(invitee, referrer) {
  const statuses = [reviewStatusOf(invitee), reviewStatusOf(referrer)];
  if (statuses.includes('blocked')) return 'blocked';
  for (const status of ['fraud_review', 'restricted', 'under_review']) {
    if (statuses.includes(status)) return status;
  }
  return 'active';
}

function inspectReferralGraph(users, existingKeys) {
  const byId = new Map(users.map(user => [String(user._id), user]));
  const report = { scanned: 0, candidates: 0, creatable: 0, existing: 0, missingReferrers: 0, cycles: 0, rows: [] };

  for (const invitee of users) {
    if (!invitee.referredBy) continue;
    report.scanned += 1;
    const inviteeId = String(invitee._id);
    const referrerId = String(invitee.referredBy);
    const referrer = byId.get(referrerId);
    if (!referrer) {
      report.missingReferrers += 1;
      report.rows.push({ inviteeId, referrerId, action: 'skip', reason: 'missing_referrer' });
      continue;
    }

    const seen = new Set([inviteeId]);
    let cursor = referrer;
    let cycle = false;
    while (cursor?.referredBy) {
      const cursorId = String(cursor._id);
      if (seen.has(cursorId)) { cycle = true; break; }
      seen.add(cursorId);
      cursor = byId.get(String(cursor.referredBy));
      if (!cursor) break;
    }
    if (cycle || String(referrer._id) === inviteeId) {
      report.cycles += 1;
      report.rows.push({ inviteeId, referrerId, action: 'skip', reason: 'referral_cycle' });
      continue;
    }

    report.candidates += 1;
    const key = `${referrerId}:${inviteeId}:1`;
    const status = relationshipStatus(invitee, referrer);
    if (existingKeys.has(key)) {
      report.existing += 1;
      report.rows.push({ inviteeId, referrerId, level: 1, action: 'keep', status });
    } else {
      report.creatable += 1;
      report.rows.push({ inviteeId, referrerId, level: 1, action: 'create', status });
    }
  }
  return report;
}

async function applyMissingRows(report) {
  const session = await mongoose.startSession();
  let created = 0;
  try {
    await session.withTransaction(async () => {
      for (const row of report.rows.filter(item => item.action === 'create')) {
        const result = await ReferralRelationship.findOneAndUpdate(
          { referrerId: row.referrerId, referredUserId: row.inviteeId, level: 1 },
          {
            $set: { status: row.status, statusReason: row.status === 'active' ? '' : row.status },
            $setOnInsert: { initialRewardStatus: 'legacy_exempt', source: 'migration' }
          },
          { upsert: true, new: true, setDefaultsOnInsert: true, session, rawResult: true }
        );
        if (result?.lastErrorObject?.updatedExisting === false || result?.upserted) created += 1;
      }
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' });
  } finally {
    await session.endSession();
  }
  return created;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) { printHelp(); return { help: true }; }
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required.');

  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  try {
    if (options.apply) {
      const capability = await verifyMongoTransactionCapability();
      if (!capability.supported) throw new Error(`MongoDB transactions are required for --apply: ${capability.reason}`);
    }

    const users = await User.find({ referredBy: { $ne: null } })
      .select('_id referredBy accountReviewStatus isBanned referralRiskBlocked referralRiskScore')
      .limit(options.limit)
      .lean();
    const relationships = await ReferralRelationship.find({ level: 1 })
      .select('referrerId referredUserId level')
      .lean();
    const existingKeys = new Set(relationships.map(row => `${row.referrerId}:${row.referredUserId}:${row.level}`));
    const report = inspectReferralGraph(users, existingKeys);
    const created = options.apply ? await applyMissingRows(report) : 0;
    const output = { mode: options.apply ? 'apply' : 'dry-run', ...report, created, rows: undefined };
    console.log(JSON.stringify(output, null, 2));
    return output;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Referral v2 migration failed: ${error.message || error}`);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, relationshipStatus, inspectReferralGraph, main };
