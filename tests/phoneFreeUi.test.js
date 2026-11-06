'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

const retiredGatePatterns = [
  /PHONE_VERIFICATION_REQUIRED/,
  /phoneVerificationRequired/,
  /request-phone-contact/,
  /request_contact/,
  /phone_gate_/,
  /phoneGate/,
  /phone-verification-required/
];
const files = [
  'public/js/app.js',
  'public/js/i18n.js',
  'public/index.html',
  'public/css/style.css',
  'routes/auth.js',
  'routes/mobileAuth.js',
  'routes/telegramWebhook.js',
  'utils/telegramAuth.js',
  'utils/mobileAuth.js',
  'utils/telegramStart.js',
  'utils/referralSystem.js',
  'utils/referralNotificationRetry.js',
  'utils/retentionNotifications.js',
  'utils/botMessages.js'
];

for (const relativePath of files) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  for (const pattern of retiredGatePatterns) {
    assert.doesNotMatch(source, pattern, `${relativePath} still contains retired phone gate pattern ${pattern}`);
  }
}

console.log('PASS — no frontend, auth, Telegram, referral, or notification code retains phone-verification gates/prompts');
