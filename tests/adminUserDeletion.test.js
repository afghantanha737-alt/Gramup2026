'use strict';

const assert = require('assert');
const { isTestDeleteEnvironment } = require('../utils/adminUserDeletion');

assert.strictEqual(isTestDeleteEnvironment({ NODE_ENV: 'test' }), true);
assert.strictEqual(isTestDeleteEnvironment({ APP_ENV: 'test' }), true);
assert.strictEqual(isTestDeleteEnvironment({ APP_URL: 'https://gramup-test.onrender.com' }), true);
assert.strictEqual(isTestDeleteEnvironment({ APP_URL: 'https://preview.gramup-test.onrender.com' }), true);
assert.strictEqual(isTestDeleteEnvironment({ NODE_ENV: 'production', APP_URL: 'https://gramup-test.onrender.com' }), true,
  'the dedicated TEST host remains usable when the host provider sets NODE_ENV=production');
assert.strictEqual(isTestDeleteEnvironment({ NODE_ENV: 'production', APP_ENV: 'test', APP_URL: 'https://gramup-test.onrender.com' }), true,
  'explicit APP_ENV=test identifies the isolated test application');
assert.strictEqual(isTestDeleteEnvironment({ APP_ENV: 'production', NODE_ENV: 'test' }), false);
assert.strictEqual(isTestDeleteEnvironment({ NODE_ENV: 'staging', APP_ENV: 'staging', APP_URL: 'https://gramup.onrender.com' }), false);
assert.strictEqual(isTestDeleteEnvironment({}), false);

console.log('PASS — admin user deletion is TEST-only and honors the configured TEST-host contract');
