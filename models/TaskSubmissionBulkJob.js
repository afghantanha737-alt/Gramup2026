'use strict';
const mongoose = require('mongoose');

const taskSubmissionBulkJobSchema = new mongoose.Schema({
  action: { type: String, enum: ['approve', 'reject'], required: true },
  submissionIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'TaskCompletion', required: true }],
  note: { type: String, default: '', maxlength: 500 },
  adminActor: { type: String, default: 'ادمین', maxlength: 200 },
  status: { type: String, enum: ['queued', 'running', 'completed', 'failed'], default: 'queued', index: true },
  total: { type: Number, required: true, min: 0 },
  nextIndex: { type: Number, default: 0, min: 0 },
  processed: { type: Number, default: 0, min: 0 },
  succeeded: { type: Number, default: 0, min: 0 },
  failed: { type: Number, default: 0, min: 0 },
  currentSubmissionId: { type: mongoose.Schema.Types.ObjectId, ref: 'TaskCompletion', default: null },
  failures: [{
    submissionId: { type: mongoose.Schema.Types.ObjectId, ref: 'TaskCompletion' },
    code: { type: String, default: 'SERVER_ERROR' },
    message: { type: String, default: '' }
  }],
  lastError: { type: String, default: '' },
  runnerToken: { type: String, default: '' },
  runnerLeaseUntil: { type: Date, default: null },
  startedAt: { type: Date, default: null },
  finishedAt: { type: Date, default: null }
}, { timestamps: true });

taskSubmissionBulkJobSchema.index({ status: 1, runnerLeaseUntil: 1 });

module.exports = mongoose.model('TaskSubmissionBulkJob', taskSubmissionBulkJobSchema);
