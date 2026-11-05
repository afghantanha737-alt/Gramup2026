'use strict';
const mongoose = require('mongoose');
const squadMemberSchema = new mongoose.Schema({
  squad: { type: mongoose.Schema.Types.ObjectId, ref: 'Squad', required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  joinedAt: { type: Date, default: Date.now }
}, { timestamps: true });
squadMemberSchema.index({ squad: 1, user: 1 }, { unique: true });
module.exports = mongoose.model('SquadMember', squadMemberSchema);
