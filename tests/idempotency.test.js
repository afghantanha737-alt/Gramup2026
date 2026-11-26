'use strict';
const assert = require('assert');
const mongoose = require('mongoose');
const { validateIdempotencyKey, hashIdempotencyRequest, idempotencyTransactionId } = require('../utils/idempotency');
const IdempotencyOperation = require('../models/IdempotencyOperation');
const Withdrawal = require('../models/Withdrawal');
const { normalizeTonTxHash, legacyTonTxHashMatcher } = require('../utils/tonVerify');

assert.strictEqual(validateIdempotencyKey('spin:550e8400-e29b-41d4-a716-446655440000'), 'spin:550e8400-e29b-41d4-a716-446655440000');
assert.strictEqual(validateIdempotencyKey('bad key'), null);
assert.strictEqual(validateIdempotencyKey('short'), null);
assert.strictEqual(validateIdempotencyKey('x'.repeat(121)), null);
assert.strictEqual(
  hashIdempotencyRequest('exchange_points_to_usdt', { direction: 'points_to_usdt', amount: 100 }),
  hashIdempotencyRequest('exchange_points_to_usdt', { amount: 100, direction: 'points_to_usdt' }),
  'stable payload hashing ignores property order'
);
assert.notStrictEqual(
  hashIdempotencyRequest('exchange_points_to_usdt', { amount: 100 }),
  hashIdempotencyRequest('exchange_usdt_to_points', { amount: 100 }),
  'operation scope is part of the hash'
);
assert.strictEqual(
  idempotencyTransactionId({ userId: 'user-a', scope: 'spin', key: 'spin:operation-1', leg: 'reward' }),
  idempotencyTransactionId({ userId: 'user-a', scope: 'spin', key: 'spin:operation-1', leg: 'reward' })
);
assert.notStrictEqual(
  idempotencyTransactionId({ userId: 'user-a', scope: 'spin', key: 'spin:operation-1', leg: 'reward' }),
  idempotencyTransactionId({ userId: 'user-b', scope: 'spin', key: 'spin:operation-1', leg: 'reward' })
);

const idempotencyIndexes = IdempotencyOperation.schema.indexes();
assert(idempotencyIndexes.some(([keys, options]) => keys.userId === 1 && keys.scope === 1 && keys.key === 1 && options.unique === true));
assert(idempotencyIndexes.every(([, options]) => options.expireAfterSeconds == null), 'financial idempotency records must not expire');
assert(IdempotencyOperation.schema.path('scope').enumValues.includes('vip0_claim'), 'VIP0 activation must be allowed by the durable idempotency scope enum');
const exchangeScopes = [
  'exchange_points_to_usdt', 'exchange_usdt_to_points',
  'exchange_points_to_gram', 'exchange_gram_to_points',
  'exchange_up_to_gram', 'exchange_gram_to_up',
  'exchange_up_to_usdt', 'exchange_usdt_to_up',
  'exchange_gram_to_usdt', 'exchange_usdt_to_gram'
];
for (const scope of exchangeScopes) {
  const operation = new IdempotencyOperation({
    userId: new mongoose.Types.ObjectId(), scope, key: 'exchange:scope-test-001', requestHash: 'a'.repeat(64)
  });
  assert.strictEqual(operation.validateSync(), undefined, `${scope} must pass durable idempotency model validation`);
}

const withdrawalIndexes = Withdrawal.schema.indexes();
assert(withdrawalIndexes.some(([keys, options]) => keys.txHashNormalized === 1 && options.unique === true && options.partialFilterExpression));
assert.strictEqual(normalizeTonTxHash('A'.repeat(64)), 'a'.repeat(64));
assert.strictEqual(normalizeTonTxHash('  abcdef123456  '), null);
assert(legacyTonTxHashMatcher('A'.repeat(64)) instanceof RegExp);
assert.strictEqual(legacyTonTxHashMatcher('abcdef123456'), 'abcdef123456');

console.log('ALL PASS — idempotency validation, durable unique indexes and normalized txHash contract');
