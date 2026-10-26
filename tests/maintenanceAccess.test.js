'use strict';
const assert = require('assert');
const http = require('http');
const express = require('express');

const settingsPath = require.resolve('../models/Settings');
const telegramAuthPath = require.resolve('../utils/telegramAuth');
let settings = { maintenanceEnabled: true, maintenanceAllowedTelegramIds: ['123456789'] };
require.cache[settingsPath] = {
  id: settingsPath,
  filename: settingsPath,
  loaded: true,
  exports: { getGlobal: async () => settings }
};
require.cache[telegramAuthPath] = {
  id: telegramAuthPath,
  filename: telegramAuthPath,
  loaded: true,
  exports: { verifyInitData: value => value === 'valid-init' ? { user: { id: 123456789 } } : null }
};

const originalEnv = Object.fromEntries(['NODE_ENV', 'APP_ENV', 'APP_URL', 'ALLOW_TEST_MAINTENANCE'].map(key => [key, process.env[key]]));
process.env.NODE_ENV = 'production';
process.env.APP_ENV = 'production';
process.env.APP_URL = 'https://gramup.onrender.com';
delete process.env.ALLOW_TEST_MAINTENANCE;
const router = require('../routes/maintenance');
const app = express();
app.use('/api/maintenance', router);

function request(path) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const req = http.get({ host: '127.0.0.1', port: address.port, path }, response => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { body += chunk; });
        response.on('end', () => server.close(error => error ? reject(error) : resolve({ status: response.statusCode, body: JSON.parse(body) })));
      });
      req.on('error', error => server.close(() => reject(error)));
    });
    server.on('error', reject);
  });
}

(async () => {
  const productionResult = await request('/api/maintenance/access');
  assert.deepStrictEqual(productionResult.body, { success: true, maintenance: false, allowed: true }, 'persisted TEST maintenance must not gate production');

  process.env.APP_ENV = 'test';
  process.env.NODE_ENV = 'test';
  process.env.APP_URL = 'https://gramup-test.onrender.com';
  const queryOnly = await request('/api/maintenance/access?initData=valid-init');
  assert.strictEqual(queryOnly.status, 423, 'initData in a URL query must not grant allowlisted maintenance access');

  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  console.log('PASS — production maintenance access ignores TEST settings; query-string initData is not accepted');
})().catch(error => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  console.error(error);
  process.exitCode = 1;
});
