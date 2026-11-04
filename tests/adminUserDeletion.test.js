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
assert.doesNotMatch(route, /hasFinancialHistory|FINANCIAL_HISTORY_IMMUTABLE|PointsLedger\.exists|Transaction\.exists|BalanceAudit\.exists/,
  'completed immutable financial history must not block profile deletion');
assert.match(route, /hasOpenFinancialOperations/);
assert.doesNotMatch(route, /REFERRAL_DEPENDENCIES_EXIST|hasDependents/,
  'referral connections must be detached instead of blocking profile deletion');
assert.match(route, /VipSubscription\.exists\(\{ user: user\._id, status: 'active' \}\)/,
  'an active VIP contract remains protected as an unresolved liability');
assert.match(route, /User\.updateMany\(\{ referredBy: user\._id \}, \{ \$set: \{ referredBy: null \} \}/,
  'direct invitees must be detached from the deleted profile');
assert.match(route, /User\.updateMany\(\{ activeReferralIds: user\._id \}/,
  'cached referral identifiers must be removed from other profiles');
assert.match(route, /Settings\.updateOne\([\s\S]*maintenanceAllowedTelegramIds/,
  'the deleted Telegram ID must be removed from the maintenance allowlist');
for (const model of ['ReferralRelationship', 'TaskCompletion', 'LatestPostEngagementState',
  'NotificationDelivery', 'IdempotencyOperation', 'MobileSession', 'MobileAuthChallenge',
  'OnboardingChallenge', 'TonProofChallenge', 'TaskReactionState', 'TelegramAdminConversation']) {
  assert.match(route, new RegExp(`${model}\\.deleteMany`));
}
assert.doesNotMatch(route, /(?:PointsLedger|Transaction|BalanceAudit|Deposit|Withdrawal|GramSwapIntent|VipSubscription|WeeklyLeaderboardAward)\.deleteMany/,
  'financial ledgers, audits, payment records, awards and VIP history must be preserved');
assert.match(route, /AdminLog\.updateMany\([\s\S]*targetId: \{ \$in: \[String\(user\._id\), String\(user\.telegramId\)\] \}/,
  'old admin logs linked to the account must be redacted');
assert.match(route, /recordAdminLogRequired\(/);
assert.match(route, /action: 'user_delete_anonymized'/);
assert.match(route, /targetId: ''/,
  'the deletion audit event must not retain a link to the deleted profile');
assert.match(route, /User\.deleteOne\(/);

console.log('PASS — profile deletion is not blocked by completed financial history; access/personal data is purged, unresolved liabilities are guarded, and accounting records are preserved');
