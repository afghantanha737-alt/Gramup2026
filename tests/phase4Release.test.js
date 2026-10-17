'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const envExample = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'scripts/migrate-referral-v2.js'), 'utf8');

assert.ok(packageJson.scripts.test.includes('tests/*.test.js'), 'npm test includes the standard tests directory');
assert.ok(fs.existsSync(path.join(root, 'tests/referralIdentifier.test.js')), 'referral contract test is in the standard tests directory');
assert.ok(packageJson.scripts['migrate:referral-v2'], 'referral migration command is present');
assert.ok(migration.includes("mode: options.apply ? 'apply' : 'dry-run'"), 'migration has explicit dry-run/apply modes');
assert.ok(migration.includes('legacy_exempt'), 'migration never awards historical referral rewards');
assert.ok(migration.includes('withTransaction'), 'migration apply path is transactional');
for (const key of [
  'NODE_ENV', 'APP_ENV', 'BOT_TOKEN', 'MONGO_URI', 'ADMIN_KEY', 'APP_URL',
  'ALLOWED_ORIGINS', 'TELEGRAM_WEBHOOK_SECRET', 'REFERRAL_RISK_SECRET',
  'REFERRAL_LINK_SECRET', 'ADMIN_TELEGRAM_IDS', 'GRAM_APP_PUBLIC_URL',
  'COMMUNITY_CHANNEL_URL', 'PAYOUT_CHANNEL_ID', 'TONCENTER_API_KEY'
]) {
  assert.ok(new RegExp(`^${key}=`, 'm').test(envExample), `${key} is documented in .env.example`);
}

console.log('ALL PASS — Stage 4 release contract, safe migration and environment documentation');
