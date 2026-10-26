'use strict';

const mongoose = require('mongoose');

const notificationDeliverySchema = new mongoose.Schema({
  eventKey: { type: String, required: true, unique: true, index: true },
  type: { type: String, enum: ['weekly_reward', 'referral_initial'], required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  telegramId: { type: String, required: true },
  status: { type: String, enum: ['pending', 'sending', 'sent', 'unknown'], default: 'pending', index: true },
  attempts: { type: Number, default: 0, min: 0 },
  sendingAt: { type: Date, default: null, index: true },
  sentAt: { type: Date, default: null },
  error: { type: String, default: '' }
});

module.exports = mongoose.model('NotificationDelivery', notificationDeliverySchema);
