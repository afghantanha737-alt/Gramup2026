'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  USER_DELETION_CONFIRMATION_PREFIX,
  userDeletionConfirmation,
  hasUserDeletionConfirmation
} = require('../utils/adminUserDeletion');

const userId = '0123456789abcdef01234567';
assert.strictEqual(USER_DELETION_CONFIRMATION_PREFIX, 'DELETE USER');
assert.strictEqual(userDeletionConfirmation(userId), `DELETE USER ${userId}`);
assert.strictEqual(hasUserDeletionConfirmation(`DELETE USER ${userId}`, userId), true);
assert.strictEqual(hasUserDeletionConfirmation('DELETE USER', userId), false);
assert.strictEqual(hasUserDeletionConfirmation(`DELETE USER ${'f'.repeat(24)}`, userId), false);
assert.strictEqual(hasUserDeletionConfirmation(`DELETE USER ${userId} `, userId), false);
assert.strictEqual(userDeletionConfirmation('not-an-object-id'), '');

const source = fs.readFileSync(path.join(__dirname, '../routes/admin.js'), 'utf8');
const start = source.indexOf("router.delete('/users/:id'");
const end = source.indexOf("router.post('/users/:id/test-weekly-reward-notification'", start);
assert.ok(start >= 0 && end > start);
const route = source.slice(start, end);
assert.doesNotMatch(route, /isTestDeleteEnvironment|TEST_ONLY|TEST environment/);
assert.match(route, /hasUserDeletionConfirmation\(req\.body\?\.confirmation, req\.params\.id\)/);
assert.match(route, /getMongoTransactionStatus\(\)/);
assert.match(route, /PointsLedger\.exists\(financialLinks\)/);
assert.match(route, /Transaction\.exists\(financialLinks\)/);
assert.match(route, /VipSubscription\.exists\(\{ user: user\._id \}\)/);
assert.match(route, /BalanceAudit\.exists\(\{ userId: user\._id, currency: \{ \$in: \['points', 'gram'\] \} \}\)/);
assert.match(route, /WeeklyLeaderboardAward\.exists/);
assert.match(route, /hasOpenFinancialOperations/);
assert.match(route, /hasDependents/);
for (const model of ['ReferralRelationship', 'TaskCompletion', 'LatestPostEngagementState', 'Withdrawal', 'Deposit',
  'NotificationDelivery', 'IdempotencyOperation', 'BalanceAudit', 'GramSwapIntent', 'MobileSession',
  'OnboardingChallenge', 'TonProofChallenge']) {
  assert.match(route, new RegExp(`${model}\\.deleteMany`));
}
assert.doesNotMatch(route, /VipSubscription\.deleteMany|WeeklyLeaderboardAward\.deleteMany/);
assert.match(route, /recordAdminLogRequired\(/);
assert.doesNotMatch(route, /AdminLog\.deleteMany/);
assert.match(route, /User\.deleteOne\(/);

console.log('PASS — production deletion confirmation, financial/referral guards, atomic audit and linked-record cleanup');
