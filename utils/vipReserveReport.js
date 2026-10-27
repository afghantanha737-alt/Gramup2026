'use strict';
const { makeXlsx } = require('./simpleXlsx');
const VipReserve = require('../models/VipReserve');
const VipSubscription = require('../models/VipSubscription');
const PointsLedger = require('../models/PointsLedger');
const AdminLog = require('../models/AdminLog');
const Settings = require('../models/Settings');

const DAY_MS = 86400000;
const REPORT_MAX_DAYS = 366;
const LEDGER_TYPES = ['vip_daily_principal', 'vip_daily_reward', 'vip_principal_return'];

function parseDate(value, endOfDay = false) {
  if (!value) return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) return null;
  return date;
}

function reportRange(query = {}) {
  const now = new Date();
  const to = parseDate(query.dateTo, true) || now;
  const from = parseDate(query.dateFrom) || new Date(to.getTime() - 29 * DAY_MS);
  if (from > to) {
    const error = new Error('بازه زمانی نامعتبر است.');
    error.code = 'VIP_REPORT_DATE_RANGE_INVALID';
    throw error;
  }
  if ((to.getTime() - from.getTime()) / DAY_MS > REPORT_MAX_DAYS) {
    const error = new Error(`حداکثر بازه گزارش ${REPORT_MAX_DAYS} روز است.`);
    error.code = 'VIP_REPORT_DATE_RANGE_TOO_LARGE';
    throw error;
  }
  return { from, to, fromKey: from.toISOString().slice(0, 10), toKey: to.toISOString().slice(0, 10) };
}

function fillDays(from, to) {
  const rows = [];
  for (let cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())); cursor <= to; cursor = new Date(cursor.getTime() + DAY_MS)) {
    rows.push({ date: cursor.toISOString().slice(0, 10), principal: 0, reward: 0, principalReturn: 0, total: 0, events: 0 });
  }
  return rows;
}

function points(value) { return Number(Number(value || 0).toFixed(2)); }

async function buildVipReserveReport(query = {}) {
  const range = reportRange(query);
  const activeNow = new Date();
  const ledgerMatch = { type: { $in: LEDGER_TYPES }, currency: 'points', createdAt: { $gte: range.from, $lte: range.to } };
  const subscriptionMatch = { policyVersion: 'v2_100d', createdAt: { $gte: range.from, $lte: range.to } };
  const [reserve, settings, ledgerByDay, ledgerTotals, planTotals, subscriptionsInPeriod, activeTotals, fundingLogs] = await Promise.all([
    VipReserve.findOne({ key: 'global' }).lean(),
    Settings.getGlobal(),
    PointsLedger.aggregate([
      { $match: ledgerMatch },
      { $group: { _id: { date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } }, type: '$type' }, points: { $sum: '$amount' }, events: { $sum: 1 } } },
      { $sort: { '_id.date': 1 } }
    ]),
    PointsLedger.aggregate([{ $match: ledgerMatch }, { $group: { _id: '$type', points: { $sum: '$amount' }, events: { $sum: 1 } } }]),
    VipSubscription.aggregate([
      { $match: subscriptionMatch },
      { $group: { _id: '$planNumber', subscriptions: { $sum: 1 }, liabilityCents: { $sum: { $ifNull: ['$reserveLiabilityCents', 0] } }, paidCents: { $sum: { $ifNull: ['$reservePaidCents', 0] } }, rewardPoints: { $sum: { $ifNull: ['$totalRewardPoints', 0] } } } },
      { $sort: { _id: 1 } }
    ]),
    VipSubscription.countDocuments(subscriptionMatch),
    VipSubscription.aggregate([{ $match: { policyVersion: 'v2_100d' } }, { $group: {
      _id: null,
      total: { $sum: 1 },
      active: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'active'] }, { $gt: ['$endAt', activeNow] }] }, 1, 0] } },
      remainingLiabilityCents: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'active'] }, { $gt: ['$endAt', activeNow] }] }, { $max: [{ $subtract: [{ $ifNull: ['$reserveLiabilityCents', 0] }, { $ifNull: ['$reservePaidCents', 0] }] }, 0] }, 0] } }
    } }]),
    AdminLog.find({ action: 'vip_reserve_fund_declaration', createdAt: { $gte: range.from, $lte: range.to } }).select('createdAt details actor').sort({ createdAt: 1 }).lean()
  ]);
  const dailyMap = new Map(fillDays(range.from, range.to).map(row => [row.date, row]));
  for (const row of ledgerByDay) {
    const day = dailyMap.get(row._id.date);
    if (!day) continue;
    const amount = points(row.points);
    if (row._id.type === 'vip_daily_principal') day.principal += amount;
    if (row._id.type === 'vip_daily_reward') day.reward += amount;
    if (row._id.type === 'vip_principal_return') day.principalReturn += amount;
    day.events += Number(row.events) || 0;
  }
  const daily = [...dailyMap.values()].map(row => ({ ...row, total: points(row.principal + row.reward + row.principalReturn) }));
  const totals = Object.fromEntries(ledgerTotals.map(row => [row._id, { points: points(row.points), events: Number(row.events) || 0 }]));
  const funding = fundingLogs.map(row => {
    const match = String(row.details || '').match(/declared=([0-9]+(?:\.[0-9]+)?)\s+points/i);
    return { date: row.createdAt, points: match ? points(match[1]) : null, actor: row.actor || '—', details: row.details || '' };
  });
  const active = activeTotals[0] || {};
  return {
    generatedAt: new Date().toISOString(),
    range: { from: range.fromKey, to: range.toKey, days: daily.length },
    reserve: reserve ? {
      availablePoints: points(Number(reserve.availablePointsCents) / 100),
      reservedPoints: points(Number(reserve.reservedPointsCents) / 100),
      paidPoints: points(Number(reserve.paidPointsCents) / 100),
      fundedPoints: points(Number(reserve.fundedPointsCents) / 100),
      updatedAt: reserve.updatedAt || null
    } : { availablePoints: 0, reservedPoints: 0, paidPoints: 0, fundedPoints: 0, updatedAt: null },
    current: { totalSubscriptions: Number(active.total) || 0, activeSubscriptions: Number(active.active) || 0, remainingLiabilityPoints: points(Number(active.remainingLiabilityCents) / 100) },
    period: { subscriptions: subscriptionsInPeriod, fundingEntries: funding.length, ledgerTotals: totals },
    plans: planTotals.map(row => ({ planNumber: Number(row._id), subscriptions: Number(row.subscriptions) || 0, liabilityPoints: points(Number(row.liabilityCents) / 100), paidPoints: points(Number(row.paidCents) / 100), rewardPoints: points(row.rewardPoints) })),
    daily,
    funding,
    policy: { version: settings?.vipPolicyVersion || 'legacy_v1', newPurchasesEnabled: settings?.vipNewPurchasesEnabled === true, payoutsEnabled: settings?.vipPayoutsEnabled === true }
  };
}

function reportSheet(title, subtitle, unit, headers, body) {
  return { name: title, rows: [[], [], [title], [], [subtitle], [unit], [], headers, ...body] };
}
function buildVipReserveWorkbook(report) {
  const summaryRows = [
    ['Available Reserve', report.reserve.availablePoints, 'Recorded internal balance', report.generatedAt],
    ['Reserved Reserve', report.reserve.reservedPoints, 'Recorded internal balance', report.generatedAt],
    ['Paid Reserve', report.reserve.paidPoints, 'Recorded internal balance', report.generatedAt],
    ['Funded Reserve', report.reserve.fundedPoints, 'Accounting declarations', report.generatedAt],
    ['Active VIP v2 subscriptions', report.current.activeSubscriptions, 'Current snapshot', report.generatedAt],
    ['Remaining active liability', report.current.remainingLiabilityPoints, 'Current snapshot', report.generatedAt],
    ['Period VIP subscriptions', report.period.subscriptions, `From ${report.range.from} to ${report.range.to}`, report.generatedAt],
    ['Policy version', report.policy.version, report.policy.payoutsEnabled ? 'Payouts enabled' : 'Payouts disabled', report.generatedAt]
  ];
  const dailyRows = report.daily.map(row => [row.date, row.principal, row.reward, row.principalReturn, row.total, row.events]);
  const planRows = report.plans.map(row => [row.planNumber, row.subscriptions, row.liabilityPoints, row.paidPoints, row.rewardPoints]);
  const fundingRows = report.funding.map(row => [row.date, row.points, row.actor, row.details]);
  const sheets = [
    reportSheet('Summary', `Reporting period: ${report.range.from} to ${report.range.to}`, 'Points; internal Reserve, VIP subscription and Ledger aggregates', ['Metric', 'Value', 'Status', 'As of'], summaryRows),
    reportSheet('Daily Ledger', `UTC daily aggregation: ${report.range.from} to ${report.range.to}`, 'Points', ['Date (UTC)', 'Principal', 'Reward', 'Principal Return', 'Total', 'Ledger Events'], dailyRows),
    reportSheet('Plan Cohorts', `Subscriptions created during ${report.range.from} to ${report.range.to}`, 'Points', ['Plan', 'Subscriptions', 'Reserved Liability', 'Paid', 'Expected Reward'], planRows),
    reportSheet('Reserve Funding', `Admin funding declarations during ${report.range.from} to ${report.range.to}`, 'Points; accounting declarations only', ['Date', 'Declared Points', 'Actor', 'Details'], fundingRows)
  ];
  return { xlsx: { writeBuffer: async () => makeXlsx(sheets) }, worksheets: sheets.map(sheet => ({ name: sheet.name })) };
}

module.exports = { buildVipReserveReport, buildVipReserveWorkbook, reportRange, LEDGER_TYPES, REPORT_MAX_DAYS };
