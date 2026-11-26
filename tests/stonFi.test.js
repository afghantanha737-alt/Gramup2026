'use strict';
const assert = require('assert');
const { constants, parseDecimalUnits, unitsToDecimal } = require('../routes/stonFi');

assert.strictEqual(parseDecimalUnits('1', 9), '1000000000');
assert.strictEqual(parseDecimalUnits('0.000000001', 9), '1');
assert.strictEqual(parseDecimalUnits('1.234567', 6), '1234567');
assert.strictEqual(parseDecimalUnits('1.0000001', 6), null);
assert.strictEqual(parseDecimalUnits('0', 9), null);
assert.strictEqual(unitsToDecimal('961393', 6), '0.961393');
assert.strictEqual(unitsToDecimal('1000000000', 9), '1');
assert.strictEqual(constants.GRAM_ADDRESS.length, 48);
assert.strictEqual(constants.USDT_ADDRESS.length, 48);
console.log('stonFi.test.js passed');
