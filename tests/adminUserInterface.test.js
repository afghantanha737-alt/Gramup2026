'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const adminHtml = fs.readFileSync(path.join(__dirname, '../public/admin.html'), 'utf8');
const adminRoutes = fs.readFileSync(path.join(__dirname, '../routes/admin.js'), 'utf8');
const helper = fs.readFileSync(path.join(__dirname, '../utils/adminUserDeletion.js'), 'utf8');

assert.match(adminHtml, /onclick="deleteUser\('\$\{u\._id\}'\)"/,
  'each user row must still bind the delete action');
assert.match(adminHtml, /Delete User \(TEST only\)/,
  'the interface must disclose deletion is test-environment-only');
assert.match(adminHtml, /api\(`\/api\/admin\/users\/\$\{id\}`, \{ method: "DELETE" \}\)/,
  'the UI must use the existing admin DELETE endpoint');
assert.match(adminRoutes, /router\.delete\('\/users\/:id'/,
  'the existing admin delete route must remain mounted');
assert.match(adminRoutes, /code: 'TEST_ONLY'/,
  'the server must retain its test-only safety refusal');
assert.match(adminRoutes, /REFERRAL_DEPENDENCIES_EXIST/,
  'referral-dependent deletions must remain explicitly refused');
assert.match(helper, /if \(appEnv === 'production'\) return false/,
  'the explicit application production marker must always refuse deletion');
assert.match(helper, /gramup-test\.onrender\.com/,
  'the isolated TEST deployment hostname must remain recognized by the UI route guard');

assert.match(adminHtml, /params\.set\("page", String\(userCurrentPage\)\)/,
  'the users UI must request API-supported pages');
assert.match(adminHtml, /changeUserPage\(-1\)/);
assert.match(adminHtml, /changeUserPage\(1\)/);
assert.match(adminHtml, /انتخاب همه کاربران این صفحه/,
  'selection text must accurately describe the visible page');

console.log('PASS — admin user-delete UI contract and user-list pagination');
