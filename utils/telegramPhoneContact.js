'use strict';

// ITU international calling codes, ordered longest-first for unambiguous
// extraction while retaining only the prefix (never the full phone number).
const COUNTRY_CALLING_CODES = Object.freeze([
  '1','7','20','27','30','31','32','33','34','36','39','40','41','43','44','45','46','47','48','49',
  '51','52','53','54','55','56','57','58','60','61','62','63','64','65','66','81','82','84','86','90',
  '91','92','93','94','95','98','211','212','213','216','218','220','221','222','223','224','225','226',
  '227','228','229','230','231','232','233','234','235','236','237','238','239','240','241','242','243',
  '244','245','246','248','249','250','251','252','253','254','255','256','257','258','260','261','262',
  '263','264','265','266','267','268','269','290','291','297','298','299','350','351','352','353','354',
  '355','356','357','358','359','370','371','372','373','374','375','376','377','378','380','381','382',
  '383','385','386','387','389','420','421','423','500','501','502','503','504','505','506','507','508',
  '509','590','591','592','593','594','595','596','597','598','599','670','672','673','674','675','676',
  '677','678','679','680','681','682','683','685','686','687','688','689','690','691','692','800','808',
  '850','852','853','855','856','870','878','880','881','882','883','886','888','960','961','962','963',
  '964','965','966','967','968','970','971','972','973','974','975','976','977','979','992','993','994',
  '995','996','998'
].sort((a, b) => b.length - a.length));
const E164_REGEX = /^\+?[1-9]\d{6,14}$/;

function normalizeTelegramContact(contact, senderTelegramId) {
  if (!contact || contact.user_id == null || senderTelegramId == null) {
    return { ok: false, reason: 'not_self_contact' };
  }
  if (String(contact.user_id) !== String(senderTelegramId)) {
    return { ok: false, reason: 'not_self_contact' };
  }

  let digits = String(contact.phone_number || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (!E164_REGEX.test(digits)) return { ok: false, reason: 'invalid_phone' };
  const countryDigits = COUNTRY_CALLING_CODES.find(code => digits.startsWith(code)) || '';
  // Keep accepting structurally valid E.164 numbers even if their calling
  // code is newly assigned or absent from the local prefix table. '+' is a
  // privacy-safe verified-number marker in that uncommon case.
  const countryCode = countryDigits ? `+${countryDigits}` : '+';
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
  return Boolean(user?.phoneVerifiedAt && /^(?:\+|\+[1-9]\d{0,2})$/.test(String(user.phoneCountryCode || '')));
}

module.exports = { COUNTRY_CALLING_CODES, E164_REGEX, normalizeTelegramContact, contactRequestKeyboard, isVerifiedAllowedPhone };
