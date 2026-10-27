'use strict';
const VipReserve = require('../models/VipReserve');

function toCents(points) {
  const value = Number(points);
  const cents = Math.round(value * 100);
  if (!Number.isFinite(value) || value <= 0 || !Number.isSafeInteger(cents) || cents <= 0) return null;
  return cents;
}

function pointsFromCents(cents) {
  return Number((Number(cents) / 100).toFixed(2));
}

async function reserveForSubscription(pointsCents, session) {
  if (!Number.isSafeInteger(pointsCents) || pointsCents <= 0) return null;
  return VipReserve.findOneAndUpdate(
    { key: 'global', availablePointsCents: { $gte: pointsCents } },
    {
      $inc: { availablePointsCents: -pointsCents, reservedPointsCents: pointsCents },
      $set: { version: 1 }
    },
    { new: true, session }
  );
}

async function releaseForPayout(pointsCents, session) {
  if (!Number.isSafeInteger(pointsCents) || pointsCents <= 0) return null;
  return VipReserve.findOneAndUpdate(
    { key: 'global', reservedPointsCents: { $gte: pointsCents } },
    {
      $inc: { reservedPointsCents: -pointsCents, paidPointsCents: pointsCents },
      $set: { lastPaidAt: new Date(), version: 1 }
    },
    { new: true, session }
  );
}

async function fundReserve(pointsCents, session) {
  if (!Number.isSafeInteger(pointsCents) || pointsCents <= 0) return null;
  return VipReserve.findOneAndUpdate(
    { key: 'global' },
    {
      $inc: { availablePointsCents: pointsCents, fundedPointsCents: pointsCents },
      $set: { lastFundedAt: new Date(), version: 1 },
      $setOnInsert: { key: 'global' }
    },
    { new: true, upsert: true, session }
  );
}

function reserveSnapshot(reserve) {
  if (!reserve) return null;
  return {
    availablePoints: pointsFromCents(reserve.availablePointsCents),
    reservedPoints: pointsFromCents(reserve.reservedPointsCents),
    paidPoints: pointsFromCents(reserve.paidPointsCents),
    fundedPoints: pointsFromCents(reserve.fundedPointsCents),
    updatedAt: reserve.updatedAt || null
  };
}

module.exports = {
  toCents,
  pointsFromCents,
  reserveForSubscription,
  releaseForPayout,
  fundReserve,
  reserveSnapshot
};
