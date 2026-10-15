'use strict';

const Settings = require('../models/Settings');
const { verifyInitData } = require('./telegramAuth');

function isTestEnvironment() {
  const nodeEnv = String(process.env.NODE_ENV || '').trim().toLowerCase();
  const appEnv = String(process.env.APP_ENV || '').trim().toLowerCase();
  const explicitTestMaintenance = String(process.env.ALLOW_TEST_MAINTENANCE || '').trim().toLowerCase() === 'true';
  let hostname = '';
  try {
    hostname = new URL(String(process.env.APP_URL || '')).hostname.toLowerCase();
  } catch {
    hostname = '';
  }
  // Render TEST may expose NODE_ENV/APP_ENV as production-like values. The
  // server-owned TEST hostname is the stronger environment marker here.
  if (explicitTestMaintenance) return true;
  if (hostname === 'gramup-test.onrender.com' || hostname.endsWith('.gramup-test.onrender.com')) return true;
  if (appEnv === 'production' || nodeEnv === 'production') return false;
  return appEnv === 'test' || nodeEnv === 'test';
}

function normalizeTelegramId(value) {
  const id = String(value ?? '').trim();
  return /^\d{1,20}$/.test(id) ? id : null;
}

function normalizeAllowedTelegramIds(values) {
  if (!Array.isArray(values)) return null;
  const unique = [...new Set(values.map(normalizeTelegramId).filter(Boolean))];
  return unique.length <= 100 ? unique : null;
}

async function getMaintenanceState() {
  const settings = await Settings.getGlobal();
  const allowedTelegramIds = normalizeAllowedTelegramIds(settings.maintenanceAllowedTelegramIds || []) || [];
  const configured = settings.maintenanceEnabled === true;
  return {
    enabled: isTestEnvironment() && configured,
    configured,
    allowedTelegramIds
  };
}

function telegramIdFromInitData(initData) {
  const verified = verifyInitData(String(initData || ''), process.env.BOT_TOKEN);
  return verified ? normalizeTelegramId(verified.user?.id) : null;
}

function isAllowedTelegramId(state, telegramId) {
  return Boolean(telegramId && state.allowedTelegramIds.includes(telegramId));
}

module.exports = {
  isTestEnvironment,
  normalizeTelegramId,
  normalizeAllowedTelegramIds,
  getMaintenanceState,
  telegramIdFromInitData,
  isAllowedTelegramId
};
