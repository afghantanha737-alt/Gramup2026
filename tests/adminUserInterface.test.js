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
assert.match(adminHtml, /سوابق دفترکل، تراکنش‌ها و ممیزی مالی[\s\S]*حفظ می‌شوند/,
  'the warning must disclose that immutable financial history is retained');
assert.match(adminHtml, /واریز، برداشت، تبدیل، جایزهٔ هفتگیِ باز یا طرح Mining فعال/,
  'the warning must disclose unresolved financial operations that temporarily block deletion');
assert.match(adminRoutes, /router\.delete\('\/users\/:id'/,
  'the existing admin delete route must remain mounted');
assert.doesNotMatch(adminRoutes, /FINANCIAL_HISTORY_IMMUTABLE|REFERRAL_DEPENDENCIES_EXIST/,
  'settled financial history and referral edges must not block profile deletion');
assert.match(adminRoutes, /OPEN_FINANCIAL_OPERATIONS/);

assert.match(adminHtml, /params\.set\("page", String\(userCurrentPage\)\)/,
  'the users UI must request API-supported pages');
assert.match(adminHtml, /changeUserPage\(-1\)/);
assert.match(adminHtml, /changeUserPage\(1\)/);
assert.match(adminHtml, /انتخاب همه کاربران این صفحه/,
  'selection text must accurately describe the visible page');

console.log('PASS — confirmed permanent-delete UI and user-list pagination');
