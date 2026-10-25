'use strict';

const assert = require('assert');
const { ALLOWED_COUNTRY_CODES, normalizeTelegramContact, contactRequestKeyboard, isVerifiedAllowedPhone } = require('../utils/telegramPhoneContact');

assert.deepStrictEqual(ALLOWED_COUNTRY_CODES, ['+93', '+98']);
assert.deepStrictEqual(
  normalizeTelegramContact({ user_id: 101, phone_number: '+93 (700) 123 456' }, '101'),
  { ok: true, countryCode: '+93' }
);
assert.deepStrictEqual(
  normalizeTelegramContact({ user_id: 202, phone_number: '0098 912 123 4567' }, 202),
  { ok: true, countryCode: '+98' }
);
assert.deepStrictEqual(
  normalizeTelegramContact({ user_id: 101, phone_number: '+1 202 555 0100' }, 101),
  { ok: false, reason: 'unsupported_country' }
);
assert.deepStrictEqual(
  normalizeTelegramContact({ user_id: 999, phone_number: '+93 700 123 456' }, 101),
  { ok: false, reason: 'not_self_contact' }
);
assert.deepStrictEqual(
  normalizeTelegramContact({ phone_number: '+98 912 123 4567' }, 202),
  { ok: false, reason: 'not_self_contact' }
);
assert.deepStrictEqual(
  normalizeTelegramContact({ user_id: 202, phone_number: '+93' }, 202),
  { ok: false, reason: 'invalid_phone' }
);
const keyboard = contactRequestKeyboard('Share my number');
assert.strictEqual(keyboard.keyboard[0][0].request_contact, true);
assert.strictEqual(keyboard.keyboard[0][0].text, 'Share my number');
assert.strictEqual(isVerifiedAllowedPhone({ phoneVerifiedAt: new Date(), phoneCountryCode: '+93' }), true);
assert.strictEqual(isVerifiedAllowedPhone({ phoneVerifiedAt: new Date(), phoneCountryCode: '+1' }), false);
assert.strictEqual(isVerifiedAllowedPhone({ phoneVerifiedAt: new Date(), phoneCountryCode: '' }), false);
assert.strictEqual(isVerifiedAllowedPhone({ phoneCountryCode: '+98' }), false);

console.log('ALL PASS — Telegram-owned contacts accept only country codes +93/+98 without returning full phone data');
