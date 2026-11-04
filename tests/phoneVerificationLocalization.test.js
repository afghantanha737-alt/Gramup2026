'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { botText } = require('../utils/botMessages');

const window = { state: { language: 'fa' } };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/i18n.js'), 'utf8'), { window });
const appSource = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
const authSource = fs.readFileSync(path.join(__dirname, '../utils/telegramAuth.js'), 'utf8');

const keys = [
  'optional_phone_privacy',
  'referral_message_consent_eyebrow', 'referral_message_consent_title', 'referral_message_consent_desc',
  'referral_message_consent_status', 'referral_message_consent_unset', 'referral_message_consent_granted',
  'referral_message_consent_denied', 'referral_message_consent_allow', 'referral_message_consent_deny',
  'referral_message_consent_error', 'menu_referral_message_consent'
];

for (const language of ['fa', 'ps', 'en']) {
  window.state.language = language;
  for (const key of keys) {
    const value = window.t(key, { status: 'test' });
    assert.ok(value && value !== 'Translation unavailable.', `${key} must resolve in ${language}`);
  }
  assert.ok(botText('phoneContactRequest', language).length > 20, `phone contact text/${language}`);
  assert.ok(botText('phoneShareButton', language).length > 4, `phone share button/${language}`);
  assert.ok(botText('phoneContactVerified', language).length > 10, `phone verified/${language}`);
  assert.ok(botText('referralInitial', language, 'Ava', 10).includes('Ava'), `referral initial/${language}`);
}
assert.doesNotMatch(appSource, /phoneVerificationRequired|renderPhoneVerificationGate|requestPhoneContact/,
  'the mini-app no longer renders or calls a phone verification gate');
assert.doesNotMatch(authSource, /PHONE_VERIFICATION_REQUIRED|isPhoneVerificationBootstrapRequest/,
  'Telegram API authorization does not require a phone contact');

console.log('ALL PASS — optional phone privacy, consent UI and Telegram contact/referral templates resolve in fa/ps/en');
