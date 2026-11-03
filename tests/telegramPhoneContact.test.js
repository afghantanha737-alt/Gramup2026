'use strict';

const assert = require('assert');
const { normalizeTelegramContact, contactRequestKeyboard, isVerifiedAllowedPhone } = require('../utils/telegramPhoneContact');

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
  { ok: true, countryCode: '+1' }
);
assert.deepStrictEqual(
  normalizeTelegramContact({ user_id: 101, phone_number: '+44 20 7946 0958' }, 101),
  { ok: true, countryCode: '+44' }
);
assert.deepStrictEqual(
  normalizeTelegramContact({ user_id: 101, phone_number: '+358 40 1234567' }, 101),
  { ok: true, countryCode: '+358' }
);
assert.deepStrictEqual(
  normalizeTelegramContact({ user_id: 101, phone_number: '+9991234567' }, 101),
  { ok: true, countryCode: '+' }
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
assert.deepStrictEqual(
  normalizeTelegramContact({ user_id: 202, phone_number: '+01234567' }, 202),
  { ok: false, reason: 'invalid_phone' }
);
assert.deepStrictEqual(
  normalizeTelegramContact({ user_id: 202, phone_number: '+1234567890123456' }, 202),
  { ok: false, reason: 'invalid_phone' }
);
const keyboard = contactRequestKeyboard('Share my number');
assert.strictEqual(keyboard.keyboard[0][0].request_contact, true);
assert.strictEqual(keyboard.keyboard[0][0].text, 'Share my number');
assert.strictEqual(isVerifiedAllowedPhone({ phoneVerifiedAt: new Date(), phoneCountryCode: '+93' }), true);
assert.strictEqual(isVerifiedAllowedPhone({ phoneVerifiedAt: new Date(), phoneCountryCode: '+1' }), true);
assert.strictEqual(isVerifiedAllowedPhone({ phoneVerifiedAt: new Date(), phoneCountryCode: '+44' }), true);
assert.strictEqual(isVerifiedAllowedPhone({ phoneVerifiedAt: new Date(), phoneCountryCode: '+358' }), true);
assert.strictEqual(isVerifiedAllowedPhone({ phoneVerifiedAt: new Date(), phoneCountryCode: '+' }), true);
assert.strictEqual(isVerifiedAllowedPhone({ phoneVerifiedAt: new Date(), phoneCountryCode: '' }), false);
assert.strictEqual(isVerifiedAllowedPhone({ phoneCountryCode: '+98' }), false);

console.log('ALL PASS — Telegram-owned contacts accept valid international E.164 numbers without storing full phone data');
