'use strict';

const ALLOWED_COUNTRY_CODES = Object.freeze(['+93', '+98']);

function normalizeTelegramContact(contact, senderTelegramId) {
  if (!contact || contact.user_id == null || senderTelegramId == null) {
    return { ok: false, reason: 'not_self_contact' };
  }
  if (String(contact.user_id) !== String(senderTelegramId)) {
    return { ok: false, reason: 'not_self_contact' };
  }

  let digits = String(contact.phone_number || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length < 8 || digits.length > 15) return { ok: false, reason: 'invalid_phone' };

  const countryCode = digits.startsWith('93') ? '+93' : digits.startsWith('98') ? '+98' : '';
  if (!countryCode) return { ok: false, reason: 'unsupported_country' };
  return { ok: true, countryCode };
}

function contactRequestKeyboard(buttonText) {
  return {
    keyboard: [[{ text: String(buttonText || 'Share my phone number'), request_contact: true }]],
    resize_keyboard: true,
    one_time_keyboard: true,
    input_field_placeholder: 'Share your own Telegram contact'
  };
}

function isVerifiedAllowedPhone(user) {
  return Boolean(user?.phoneVerifiedAt && ALLOWED_COUNTRY_CODES.includes(String(user.phoneCountryCode || '')));
}

module.exports = { ALLOWED_COUNTRY_CODES, normalizeTelegramContact, contactRequestKeyboard, isVerifiedAllowedPhone };
