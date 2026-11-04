'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const adminHtml = fs.readFileSync(path.join(__dirname, '../public/admin.html'), 'utf8');
const adminRoutes = fs.readFileSync(path.join(__dirname, '../routes/admin.js'), 'utf8');

assert.match(adminHtml, /onclick="deleteUser\('\$\{u\._id\}'\)"/,
  'each user row must still bind the delete action');
assert.match(adminHtml, /Delete User(?! \(TEST only\))/);
assert.doesNotMatch(adminHtml, /TEST only/);
assert.match(adminHtml, /const confirmationText = `DELETE USER \$\{id\}`/);
assert.match(adminHtml, /api\(`\/api\/admin\/users\/\$\{id\}`, \{[\s\S]*body: JSON\.stringify\(\{ confirmation \}\)/);
assert.match(adminHtml, /financial history|سابقهٔ مالی/);
assert.match(adminRoutes, /router\.delete\('\/users\/:id'/,
  'the existing admin delete route must remain mounted');
assert.match(adminRoutes, /REFERRAL_DEPENDENCIES_EXIST/,
  'referral-dependent deletions must remain explicitly refused');

assert.match(adminHtml, /params\.set\("page", String\(userCurrentPage\)\)/,
  'the users UI must request API-supported pages');
assert.match(adminHtml, /changeUserPage\(-1\)/);
assert.match(adminHtml, /changeUserPage\(1\)/);
assert.match(adminHtml, /انتخاب همه کاربران این صفحه/,
  'selection text must accurately describe the visible page');

console.log('PASS — confirmed permanent-delete UI and user-list pagination');
