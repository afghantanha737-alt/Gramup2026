'use strict';

// Read-only entitlement audit. This script never writes to MongoDB.
// Run with MONGO_URI set to a read-only production credential.
const mongoose = require('mongoose');
const User = require('../models/User');
const VipSubscription = require('../models/VipSubscription');
const Transaction = require('../models/Transaction');
const PointsLedger = require('../models/PointsLedger');

function groupRows(rows) {
  return Object.fromEntries(rows.map(row => [String(row._id ?? '(missing)'), row.count]));
}

async function main() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required; no database was contacted. Use a read-only MongoDB credential.');
  }
  await mongoose.connect(process.env.MONGO_URI, {
    readPreference: 'secondaryPreferred',
    readConcern: { level: 'majority' },
    serverSelectionTimeoutMS: 10000
  });

  const now = new Date();
  const [subscriptionCount, subscriptionStatuses, currentlyEligible, activeByUser,
    staleActive, activeClaimCounterExhausted, activeReserveExhausted,
    completedEarlyWithUnpaidLiability, dateFieldTypes, legacyVipGoldUntil,
    txnVipPurchases, pointsLedgerVipPurchases, collections] = await Promise.all([
    VipSubscription.countDocuments({}),
    VipSubscription.collection.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }, { $sort: { _id: 1 } }
    ]).toArray(),
    VipSubscription.countDocuments({
      status: 'active', startAt: { $lte: now }, endAt: { $gt: now }
    }),
    VipSubscription.collection.aggregate([
      { $match: { status: 'active', startAt: { $lte: now }, endAt: { $gt: now } } },
      { $group: { _id: '$user', count: { $sum: 1 } } },
      { $group: { _id: '$count', users: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]).toArray(),
    VipSubscription.countDocuments({ status: 'active', endAt: { $lte: now } }),
    VipSubscription.collection.countDocuments({
      status: 'active', $expr: { $and: [
        { $gt: [{ $ifNull: ['$durationDays', 0] }, 0] },
        { $gte: [{ $ifNull: ['$claimsCompleted', 0] }, '$durationDays'] }
      ] }
    }),
    VipSubscription.collection.countDocuments({
      status: 'active', reserveLiabilityCents: { $gt: 0 },
      $expr: { $gte: [{ $ifNull: ['$reservePaidCents', 0] }, '$reserveLiabilityCents'] }
    }),
    VipSubscription.collection.countDocuments({
      status: 'completed', endAt: { $gt: now },
      $or: [
        { policyVersion: { $in: [null, 'legacy_v1'] } },
        { reserveLiabilityCents: { $gt: 0 }, $expr: { $lt: [{ $ifNull: ['$reservePaidCents', 0] }, '$reserveLiabilityCents'] } }
      ]
    }),
    VipSubscription.collection.aggregate([
      { $project: { startAtType: { $type: '$startAt' }, endAtType: { $type: '$endAt' } } },
      { $group: { _id: { startAt: '$startAtType', endAt: '$endAtType' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]).toArray(),
    User.countDocuments({ vipGoldUntil: { $gt: now } }),
    Transaction.collection.aggregate([
      { $match: { type: 'vip_purchase' } },
      { $group: { _id: '$status', count: { $sum: 1 } } }, { $sort: { _id: 1 } }
    ]).toArray(),
    PointsLedger.collection.aggregate([
      { $match: { type: 'vip_purchase' } },
      { $group: { _id: '$status', count: { $sum: 1 } } }, { $sort: { _id: 1 } }
    ]).toArray(),
    mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()
  ]);

  console.log(JSON.stringify({
    generatedAt: now.toISOString(),
    readOnly: true,
    collections: collections.map(({ name }) => name).sort(),
    vipSubscriptions: {
      total: subscriptionCount,
      byStatus: groupRows(subscriptionStatuses),
      currentlyEligibleActiveMiners: currentlyEligible,
      eligibleMinerCountDistributionByUser: Object.fromEntries(
        activeByUser.map(row => [String(row._id), row.users])
      ),
      activeButPastEndDate: staleActive,
      activeButClaimsCounterAtDuration: activeClaimCounterExhausted,
      activeButReserveLiabilityFullyPaid: activeReserveExhausted,
      completedBeforeEndWithUnpaidLiability: completedEarlyWithUnpaidLiability,
      startEndBsonTypes: dateFieldTypes.map(row => ({ ...row._id, count: row.count }))
    },
    legacy: { usersWithFutureVipGoldUntil: legacyVipGoldUntil },
    purchaseLedger: {
      transactionRecordsByStatus: groupRows(txnVipPurchases),
      pointsLedgerRecordsByStatus: groupRows(pointsLedgerVipPurchases)
    },
    note: 'Counts only; no user identifiers or financial values are emitted. Purchase-to-subscription matching requires a sourceId audit before any migration.'
  }, null, 2));
}

main()
  .catch(error => {
    console.error(`VIP audit failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });
