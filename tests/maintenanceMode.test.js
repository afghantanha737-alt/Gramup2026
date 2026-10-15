'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const project = path.join(__dirname, '..');
const settingsPath = require.resolve('../models/Settings');
const authPath = require.resolve('../utils/telegramAuth');
let settings = { maintenanceEnabled: false, maintenanceAllowedTelegramIds: [] };
require.cache[settingsPath] = {
  id: settingsPath,
  filename: settingsPath,
  loaded: true,
  exports: { getGlobal: async () => settings }
};
require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: { verifyInitData: value => value === 'valid-init' ? { user: { id: 123456789 } } : null }
};

const maintenance = require('../utils/maintenance');

const original = { NODE_ENV: process.env.NODE_ENV, APP_ENV: process.env.APP_ENV, APP_URL: process.env.APP_URL };
function restoreEnv() {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

(async () => {
  process.env.APP_ENV = 'test';
  delete process.env.NODE_ENV;
  settings = { maintenanceEnabled: false, maintenanceAllowedTelegramIds: [] };
  assert.strictEqual((await maintenance.getMaintenanceState()).enabled, false, 'OFF allows normal app mode');

  settings = { maintenanceEnabled: true, maintenanceAllowedTelegramIds: ['123456789'] };
  const onState = await maintenance.getMaintenanceState();
  assert.strictEqual(onState.enabled, true, 'TEST maintenance turns on');
  assert.strictEqual(maintenance.isAllowedTelegramId(onState, maintenance.telegramIdFromInitData('valid-init')), true, 'allowed Telegram user passes');
  assert.strictEqual(maintenance.isAllowedTelegramId(onState, maintenance.telegramIdFromInitData('invalid-init')), false, 'invalid init data is denied');

  process.env.APP_URL = 'https://gramup-test.onrender.com';
  process.env.APP_ENV = 'PROD';
  process.env.NODE_ENV = 'production';
  assert.strictEqual((await maintenance.getMaintenanceState()).enabled, true, 'known TEST host wins over Render production-like env values');

  process.env.APP_ENV = 'production';
  process.env.APP_URL = 'https://gramup.onrender.com';
  assert.strictEqual((await maintenance.getMaintenanceState()).enabled, false, 'Production can never be put into TEST maintenance mode');
  restoreEnv();

  assert.deepStrictEqual(maintenance.normalizeAllowedTelegramIds(['1', 1, '002', 'bad', '']), ['1', '002'], 'allowed IDs are normalized and deduplicated');
  assert.strictEqual(maintenance.normalizeAllowedTelegramIds(Array.from({ length: 101 }, (_, index) => String(index + 1))), null, 'allowed list is bounded');

  const page = fs.readFileSync(path.join(project, 'public', 'maintenance.html'), 'utf8');
  assert.match(page, /English/);
  assert.match(page, /فارسی/);
  assert.match(page, /پښتو/);
  assert.match(page, /localStorage/);

  const server = fs.readFileSync(path.join(project, 'server.js'), 'utf8');
  assert.match(server, /MAINTENANCE_MODE/);
  assert.match(server, /isAllowedTelegramId/);
  const admin = fs.readFileSync(path.join(project, 'routes', 'admin.js'), 'utf8');
  assert.match(admin, /router\.put\('\/maintenance'/);
  assert.match(admin, /isTestEnvironment/);

  console.log('ALL PASS — Maintenance OFF/ON, Allowed User, Production guard, languages and refresh persistence');
})().catch(error => {
  restoreEnv();
  console.error(error);
  process.exitCode = 1;
});
