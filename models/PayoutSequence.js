'use strict';
const mongoose = require('mongoose');

const payoutSequenceSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    value: { type: Number, required: true, min: 0, default: 185 }
  },
  { versionKey: false }
);

module.exports = mongoose.model('PayoutSequence', payoutSequenceSchema);
