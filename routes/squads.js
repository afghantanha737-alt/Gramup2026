'use strict';
const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
require('../utils/asyncHandler').wrapRouter(router);
const { requireUnifiedAuth } = require('../utils/unifiedAuth');
const { withMembership } = require('../utils/membership');
const { sensitiveRateLimit } = require('../utils/apiSecurity');
const User = require('../models/User');
const Squad = require('../models/Squad');
const SquadMember = require('../models/SquadMember');
const PointsLedger = require('../models/PointsLedger');
const { withMongoTransaction } = require('../utils/mongoTransaction');
const auth = withMembership(requireUnifiedAuth(process.env.BOT_TOKEN));

function parsePublicTelegramChannel(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 200) return null;
  let username = raw.replace(/^@/, '');
  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      if (!['t.me', 'www.t.me', 'telegram.me', 'www.telegram.me'].includes(url.hostname.toLowerCase())) return null;
      const path = url.pathname.split('/').filter(Boolean);
      if (path.length !== 1) return null;
      username = path[0];
    } catch { return null; }
  }
  if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(username)) return null;
  return { username: username.toLowerCase(), url: `https://t.me/${username}` };
}

async function getMySquad(userId) {
  const member = await SquadMember.findOne({ user: userId }).lean();
  if (!member) return null;
  const squad = await Squad.findOne({ _id: member.squad, isActive: true }).lean();
  return squad ? { id: String(squad._id), title: squad.title, username: squad.telegramUsername, url: squad.telegramUrl, membersCount: squad.membersCount, joinedAt: member.joinedAt } : null;
}

async function getLeaderboard() {
  const memberCollection = SquadMember.collection.name;
  const squadCollection = Squad.collection.name;
  const ledgerCollection = PointsLedger.collection.name;
  const rows = await SquadMember.aggregate([
    { $group: { _id: '$squad', members: { $addToSet: '$user' }, membersCount: { $sum: 1 } } },
    { $lookup: { from: squadCollection, localField: '_id', foreignField: '_id', as: 'squad' } },
    { $unwind: '$squad' },
    { $match: { 'squad.isActive': true } },
    { $lookup: {
      from: ledgerCollection,
      let: { memberIds: '$members' },
      pipeline: [
        { $match: { $expr: { $and: [
          { $in: ['$user', '$$memberIds'] },
          { $eq: ['$currency', 'points'] },
          { $gt: ['$amount', 0] },
          { $in: ['$type', ['vip_daily_reward', 'mining_claim']] }
        ] } } },
        { $group: { _id: null, minedUp: { $sum: '$amount' } } }
      ],
      as: 'score'
    } },
    { $project: { _id: 0, id: { $toString: '$squad._id' }, title: '$squad.title', username: '$squad.telegramUsername', url: '$squad.telegramUrl', membersCount: 1, score: { $ifNull: [{ $arrayElemAt: ['$score.minedUp', 0] }, 0] } } },
    { $sort: { score: -1, membersCount: -1, title: 1 } },
    { $limit: 20 }
  ]);
  return rows.map((row, index) => ({ rank: index + 1, ...row, score: Number(row.score) || 0, membersCount: Number(row.membersCount) || 0 }));
}

router.get('/', auth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const [me, leaderboard] = await Promise.all([getMySquad(req.dbUser._id), getLeaderboard()]);
  res.json({ success: true, squad: me, leaderboard });
});

router.post('/', auth, sensitiveRateLimit('general'), async (req, res) => {
  const parsed = parsePublicTelegramChannel(req.body?.telegramLink || req.body?.username);
  const title = String(req.body?.title || '').trim().slice(0, 64);
  if (!parsed) return res.status(400).json({ success: false, code: 'INVALID_SQUAD_LINK', message: 'Use a public Telegram @username or t.me/username link.' });
  if (!title) return res.status(400).json({ success: false, code: 'SQUAD_TITLE_REQUIRED', message: 'Enter a squad name.' });
  try {
    const squad = await withMongoTransaction(async session => {
      const existingMember = await SquadMember.findOne({ user: req.dbUser._id }).session(session);
      if (existingMember) throw Object.assign(new Error('Leave your current squad before creating another.'), { code: 'ALREADY_IN_SQUAD' });
      const created = await new Squad({ telegramUsername: parsed.username, title, telegramUrl: parsed.url, createdBy: req.dbUser._id, membersCount: 0 }).save({ session });
      await new SquadMember({ squad: created._id, user: req.dbUser._id }).save({ session });
      created.membersCount = 1;
      await created.save({ session });
      return created;
    });
    return res.status(201).json({ success: true, squad: { id: String(squad._id), title: squad.title, username: squad.telegramUsername, url: squad.telegramUrl, membersCount: 1 } });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ success: false, code: 'SQUAD_EXISTS', message: 'A squad for this Telegram channel already exists, or you already belong to a squad.' });
    if (error.code === 'ALREADY_IN_SQUAD') return res.status(409).json({ success: false, code: error.code, message: error.message });
    throw error;
  }
});

router.post('/join', auth, sensitiveRateLimit('general'), async (req, res) => {
  const parsed = parsePublicTelegramChannel(req.body?.telegramLink || req.body?.username);
  if (!parsed) return res.status(400).json({ success: false, code: 'INVALID_SQUAD_LINK', message: 'Use a public Telegram @username or t.me/username link.' });
  try {
    const joined = await withMongoTransaction(async session => {
      const squad = await Squad.findOne({ telegramUsername: parsed.username, isActive: true }).session(session);
      if (!squad) return null;
      const existing = await SquadMember.findOne({ user: req.dbUser._id }).session(session);
      if (existing) {
        if (String(existing.squad) === String(squad._id)) return { squad, duplicate: true };
        throw Object.assign(new Error('Leave your current squad before joining another.'), { code: 'ALREADY_IN_SQUAD' });
      }
      await new SquadMember({ squad: squad._id, user: req.dbUser._id }).save({ session });
      const updated = await Squad.findOneAndUpdate({ _id: squad._id, isActive: true }, { $inc: { membersCount: 1 } }, { new: true, session });
      return { squad: updated, duplicate: false };
    });
    if (!joined) return res.status(404).json({ success: false, code: 'SQUAD_NOT_FOUND', message: 'No Gramup squad is registered for that Telegram channel yet.' });
    return res.json({ success: true, duplicate: joined.duplicate, squad: { id: String(joined.squad._id), title: joined.squad.title, username: joined.squad.telegramUsername, url: joined.squad.telegramUrl, membersCount: joined.squad.membersCount } });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ success: false, code: 'SQUAD_MEMBERSHIP_CONFLICT', message: 'Could not join because your squad membership changed. Refresh and try again.' });
    if (error.code === 'ALREADY_IN_SQUAD') return res.status(409).json({ success: false, code: error.code, message: error.message });
    throw error;
  }
});

router.delete('/me', auth, sensitiveRateLimit('general'), async (req, res) => {
  const result = await withMongoTransaction(async session => {
    const membership = await SquadMember.findOneAndDelete({ user: req.dbUser._id }).session(session);
    if (!membership) return null;
    await Squad.findOneAndUpdate({ _id: membership.squad, membersCount: { $gt: 0 } }, { $inc: { membersCount: -1 } }, { session });
    return true;
  });
  return res.json({ success: true, left: Boolean(result) });
});

router.parsePublicTelegramChannel = parsePublicTelegramChannel;
router.getLeaderboard = getLeaderboard;
module.exports = router;
