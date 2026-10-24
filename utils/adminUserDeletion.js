'use strict';

function isTestDeleteEnvironment(env = process.env) {
  const nodeEnv = String(env.NODE_ENV || '').trim().toLowerCase();
  const appEnv = String(env.APP_ENV || '').trim().toLowerCase();

  // An explicit application production marker always wins. The project's test
  // deployment uses its dedicated hostname even when Render sets NODE_ENV to
  // production, so that hostname remains a valid TEST signal when APP_ENV is not.
  if (appEnv === 'production') return false;
  if (nodeEnv === 'test' || appEnv === 'test') return true;

  try {
    const hostname = new URL(String(env.APP_URL || '')).hostname.toLowerCase();
    if (hostname === 'gramup-test.onrender.com' || hostname.endsWith('.gramup-test.onrender.com')) return true;
  } catch {
    // Missing or invalid APP_URL is not evidence of a test environment.
  }

  return false;
}

module.exports = { isTestDeleteEnvironment };
