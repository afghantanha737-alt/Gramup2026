'use strict';
const assert = require('node:assert/strict');
process.env.BOT_TOKEN = 'phase3-test-token';
const { parseStarsPayload, STARS_PRODUCTS } = require('../routes/telegramWebhook');

const valid = parseStarsPayload('gramup-stars:v1:507f1f77bcf86cd799439011:hash_boost_7d:nonce-123');
assert.equal(valid.productKey, 'hash_boost_7d');
assert.equal(valid.product.stars, 150);
assert.equal(parseStarsPayload('gramup-stars:v1:bad:hash_boost_7d:nonce'), null);
assert.equal(parseStarsPayload('gramup-stars:v1:507f1f77bcf86cd799439011:hash_boost_7d'), null);
assert.deepEqual(Object.keys(STARS_PRODUCTS).sort(), ['hash_boost_7d', 'streak_freeze', 'vip_gold']);
assert.equal(STARS_PRODUCTS.vip_gold.stars, 250);
console.log('PASS — Telegram Stars product catalog and invoice payload verification');
