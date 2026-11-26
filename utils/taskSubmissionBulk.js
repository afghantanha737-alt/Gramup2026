'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');
const Task = require('../models/Task');
const User = require('../models/User');
const Settings = require('../models/Settings');
const TaskCompletion = require('../models/TaskCompletion');
const PointsLedger = require('../models/PointsLedger');
const TaskSubmissionBulkJob = require('../models/TaskSubmissionBulkJob');
const { recordLedgerRequired } = require('./ledger');
const { rewardCostUsd } = require('./sponsor');
const { withMongoTransaction } = require('./mongoTransaction');

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const RUNNER_LEASE_MS = 60 * 1000;
const activeRunners = new Set();

function submissionError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function approveTaskSubmission({ submissionId, adminActor, settings }) {
  const reviewedAt = new Date();
  return withMongoTransaction(async session => {
    const submission = await TaskCompletion.findById(submissionId).session(session);
    if (!submission) throw submissionError('Submission پیدا نشد.', 'SUBMISSION_NOT_FOUND');
    if (submission.status !== 'pending') throw submissionError('این submission دیگر در انتظار بررسی نیست.', 'SUBMISSION_NOT_PENDING');
    if (!IMAGE_MIMES.includes(submission.proofMimeType)) throw submissionError('تصویر معتبر برای این submission ثبت نشده است.', 'SUBMISSION_IMAGE_MISSING');

    const task = await Task.findById(submission.task).session(session);
    if (!task) throw submissionError('Task Screenshot Verification پیدا نشد.', 'TASK_NOT_FOUND');
    const reward = Number(submission.reward);
    if (!Number.isFinite(reward) || reward <= 0) throw submissionError('پاداش ثبت‌شده برای submission نامعتبر است.', 'INVALID_REWARD');

    const sourceId = `task:${task._id}:user:${submission.user}`;
    const existingLedger = await PointsLedger.findOne({ sourceId }).select('_id').session(session);
    if (existingLedger) throw submissionError('پاداش این task قبلاً در تاریخچه ثبت شده است.', 'TASK_REWARD_ALREADY_PAID');

    const reservedTask = await Task.findOneAndUpdate(
      { _id: task._id, $or: [{ maxCompletions: null }, { $expr: { $lt: ['$completedCount', '$maxCompletions'] } }] },
      { $inc: { completedCount: 1 } },
      { new: true, session }
    );
    if (!reservedTask) throw submissionError('ظرفیت task تکمیل شده است.', 'TASK_FULL');

    const approved = await TaskCompletion.findOneAndUpdate(
      { _id: submission._id, status: 'pending' },
      { $set: { status: 'approved', reviewedAt, reviewedBy: adminActor } },
      { new: true, session }
    );
    if (!approved) throw submissionError('این submission هم‌زمان توسط ادمین دیگری بررسی شد.', 'SUBMISSION_NOT_PENDING');

    if (reservedTask.maxCompletions != null && reservedTask.completedCount >= reservedTask.maxCompletions) {
      await Task.updateOne({ _id: reservedTask._id }, { $set: { isActive: false } }, { session });
    }

    const user = await User.findByIdAndUpdate(submission.user, { $inc: { points: reward } }, { new: true, session });
    if (!user) throw submissionError('کاربر submission پیدا نشد.', 'SUBMISSION_USER_NOT_FOUND');

    const ledger = await recordLedgerRequired({
      user: user._id, type: 'task', amount: reward, description: `Task Reward — ${task.title}`,
      balanceAfter: user.points, sourceId, session
    });
    if (!ledger.created) throw submissionError('پاداش task قبلاً ثبت شده است؛ پرداخت دوباره انجام نشد.', 'TASK_REWARD_ALREADY_PAID');

    const revenueUsd = reservedTask.isSponsored ? Number(reservedTask.sponsorPriceUsd) || 0 : 0;
    const costUsd = rewardCostUsd(reward, 0.0001, settings.usdtUsdPrice);
    await TaskCompletion.updateOne({ _id: approved._id, status: 'approved' }, { $set: { revenueUsd, costUsd } }, { session });
    return { reward, points: user.points, taskTitle: task.title, userId: user._id };
  });
}

async function rejectTaskSubmission({ submissionId, adminActor, note }) {
  const submission = await TaskCompletion.findOneAndUpdate(
    { _id: submissionId, status: 'pending', proofMimeType: { $in: IMAGE_MIMES } },
    { $set: { status: 'rejected', adminNote: note, reviewedAt: new Date(), reviewedBy: adminActor } },
    { new: true }
  );
  if (!submission) {
    const exists = await TaskCompletion.exists({ _id: submissionId });
    throw submissionError(exists ? 'این submission دیگر در انتظار بررسی نیست.' : 'Submission پیدا نشد.', exists ? 'SUBMISSION_NOT_PENDING' : 'SUBMISSION_NOT_FOUND');
  }
  return { status: 'rejected' };
}

function publicJob(job) {
  return {
    id: String(job._id), action: job.action, status: job.status, total: job.total,
    processed: job.processed, succeeded: job.succeeded, failed: job.failed,
    currentSubmissionId: job.currentSubmissionId ? String(job.currentSubmissionId) : null,
    lastError: job.lastError || '', failures: (job.failures || []).slice(-50),
    startedAt: job.startedAt, finishedAt: job.finishedAt
  };
}

async function runTaskSubmissionBulkJob(jobId) {
  const key = String(jobId);
  if (activeRunners.has(key)) return;
  activeRunners.add(key);
  const runnerToken = crypto.randomUUID();
  try {
    const claimed = await TaskSubmissionBulkJob.findOneAndUpdate(
      { _id: jobId, status: { $in: ['queued', 'running'] }, $or: [{ status: 'queued' }, { runnerLeaseUntil: { $lte: new Date() } }, { runnerToken }] },
      { $set: { status: 'running', runnerToken, runnerLeaseUntil: new Date(Date.now() + RUNNER_LEASE_MS), startedAt: new Date() } },
      { new: true }
    );
    if (!claimed) return;

    const settings = claimed.action === 'approve' ? await Settings.getGlobal() : null;
    while (true) {
      const job = await TaskSubmissionBulkJob.findById(jobId);
      if (!job || job.status !== 'running' || job.runnerToken !== runnerToken) return;
      if (job.nextIndex >= job.total) {
        await TaskSubmissionBulkJob.updateOne({ _id: jobId, runnerToken }, { $set: { status: 'completed', finishedAt: new Date(), runnerLeaseUntil: null, currentSubmissionId: null } });
        return;
      }

      const submissionId = job.submissionIds[job.nextIndex];
      await TaskSubmissionBulkJob.updateOne(
        { _id: jobId, status: 'running', runnerToken },
        { $set: { currentSubmissionId: submissionId, runnerLeaseUntil: new Date(Date.now() + RUNNER_LEASE_MS) } }
      );
      let succeeded = false;
      let failure = null;
      try {
        if (job.action === 'approve') await approveTaskSubmission({ submissionId, adminActor: job.adminActor, settings });
        else await rejectTaskSubmission({ submissionId, adminActor: job.adminActor, note: job.note });
        succeeded = true;
      } catch (error) {
        failure = { submissionId, code: error.code || 'SERVER_ERROR', message: String(error.message || error).slice(0, 500) };
      }

      const update = {
        $set: {
          nextIndex: job.nextIndex + 1,
          currentSubmissionId: null,
          runnerLeaseUntil: new Date(Date.now() + RUNNER_LEASE_MS),
          ...(failure ? { lastError: failure.message } : { lastError: '' })
        },
        $inc: { processed: 1, ...(succeeded ? { succeeded: 1 } : { failed: 1 }) }
      };
      if (failure) update.$push = { failures: { $each: [failure], $slice: -200 } };
      await TaskSubmissionBulkJob.updateOne({ _id: jobId, status: 'running', runnerToken }, update);
    }
  } catch (error) {
    await TaskSubmissionBulkJob.updateOne({ _id: jobId, runnerToken }, { $set: { status: 'failed', finishedAt: new Date(), runnerLeaseUntil: null, lastError: String(error.message || error).slice(0, 500) } }).catch(() => {});
    console.error('Task submission bulk job failed:', error);
  } finally {
    activeRunners.delete(key);
  }
}

function startTaskSubmissionBulkJob(job) {
  setImmediate(() => { void runTaskSubmissionBulkJob(job._id); });
}

async function resumePendingTaskSubmissionBulkJobs() {
  const jobs = await TaskSubmissionBulkJob.find({ status: { $in: ['queued', 'running'] } }).select('_id').lean();
  for (const job of jobs) startTaskSubmissionBulkJob(job);
  return jobs.length;
}

module.exports = {
  IMAGE_MIMES,
  approveTaskSubmission,
  rejectTaskSubmission,
  publicJob,
  startTaskSubmissionBulkJob,
  resumePendingTaskSubmissionBulkJobs,
  runTaskSubmissionBulkJob
};
