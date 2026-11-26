'use strict';

function round(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

function buildDiscrepancy(user, sums) {
  const pointsLedger = round(sums.points);
  const usdtLedger = round(sums.usdt);
  const pointsBalance = round(user.points);
  const usdtBalance = round(user.usdtBalance);
  return {
    userId: user._id,
    telegramId: user.telegramId,
    name: user.firstName || user.username || '',
    pointsBalance,
    pointsLedger,
    pointsDifference: round(pointsBalance - pointsLedger),
    usdtBalance,
    usdtLedger,
    usdtDifference: round(usdtBalance - usdtLedger)
  };
}

function isDiscrepant(row, tolerance = 0.000001) {
  return Math.abs(row.pointsDifference) > tolerance || Math.abs(row.usdtDifference) > tolerance;
}

module.exports = { round, buildDiscrepancy, isDiscrepant };
