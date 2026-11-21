'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const worker = fs.readFileSync(path.join(root, 'utils/taskSubmissionBulk.js'), 'utf8');
const model = fs.readFileSync(path.join(root, 'models/TaskSubmissionBulkJob.js'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'routes/admin.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'public/admin.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

assert.match(worker, /async function runTaskSubmissionBulkJob/);
assert.match(worker, /while \(true\)/);
assert.match(worker, /await approveTaskSubmission/);
assert.match(worker, /await rejectTaskSubmission/);
assert.match(worker, /nextIndex: job\.nextIndex \+ 1/);
assert.match(worker, /resumePendingTaskSubmissionBulkJobs/);
assert.match(model, /enum: \['queued', 'running', 'completed', 'failed'\]/);
assert.match(model, /processed: \{ type: Number/);
assert.match(model, /succeeded: \{ type: Number/);
assert.match(model, /failed: \{ type: Number/);
assert.match(admin, /router\.post\('\/task-submissions\/bulk-action'/);
assert.match(admin, /router\.get\('\/task-submissions\/bulk-action\/:id'/);
assert.match(ui, /monitorScreenshotBulkJob/);
assert.match(ui, /screenshotBulkProgress/);
assert.ok(!ui.includes('Promise.allSettled(ids.map(id => api('), 'bulk UI must not fan out requests in parallel');
assert.match(server, /resumePendingTaskSubmissionBulkJobs/);

console.log('PASS — task submission bulk processing is sequential, persisted, observable, and resumable');
