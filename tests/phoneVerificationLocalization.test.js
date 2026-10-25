'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { botText } = require('../utils/botMessages');

const window = { state: { language: 'fa' } };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/i18n.js'), 'utf8'), { window });

const keys = [
  'phone_gate_eyebrow', 'phone_gate_title', 'phone_gate_desc', 'phone_gate_privacy',
  'phone_gate_share', 'phone_gate_check', 'phone_gate_sent', 'phone_gate_pending', 'phone_gate_error',
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

console.log('ALL PASS — phone gate, consent UI and Telegram contact/referral templates resolve in fa/ps/en');
