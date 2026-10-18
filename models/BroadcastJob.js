'use strict';
const mongoose = require('mongoose');

const broadcastJobSchema = new mongoose.Schema({
  actor: { type: String, default: 'ادمین' },
  status: { type: String, enum: ['running', 'completed', 'failed'], default: 'running', index: true },
  hasImage: { type: Boolean, default: false },
  textPreview: { type: String, default: '', maxlength: 120 },
  totalRecipients: { type: Number, default: 0, min: 0 },
  sent: { type: Number, default: 0, min: 0 },
  failed: { type: Number, default: 0, min: 0 },
  lastError: { type: String, default: '', maxlength: 500 },
  startedAt: { type: Date, default: Date.now },
  finishedAt: { type: Date, default: null }
}, { timestamps: true });

broadcastJobSchema.index({ createdAt: -1 });
module.exports = mongoose.model('BroadcastJob', broadcastJobSchema);
