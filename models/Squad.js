'use strict';
const mongoose = require('mongoose');
const squadSchema = new mongoose.Schema({
  telegramUsername: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 64 },
  telegramUrl: { type: String, required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  membersCount: { type: Number, default: 0, min: 0 },
  isActive: { type: Boolean, default: true, index: true }
}, { timestamps: true });
module.exports = mongoose.model('Squad', squadSchema);
