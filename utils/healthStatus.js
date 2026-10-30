'use strict';

// Pure, synchronous health contracts for the parent server route. It performs no
// database/network work and deliberately omits configuration values and secrets.
function timestamp(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function livenessStatus({ service = 'telegram-mini-app', now = new Date(), uptimeSeconds = process.uptime() } = {}) {
  return {
    statusCode: 200,
    body: {
      success: true,
      status: 'ok',
      service: String(service),
      liveness: 'alive',
      uptime: Math.max(0, Math.floor(Number(uptimeSeconds) || 0)),
      timestamp: timestamp(now)
    }
  };
}

function readinessStatus({ databaseReady = false, transactionReady = true, service = 'telegram-mini-app', now = new Date() } = {}) {
  const db = databaseReady === true;
  const transactions = transactionReady === true;
  const ready = db && transactions;
  return {
    statusCode: ready ? 200 : 503,
    body: {
      success: ready,
      status: ready ? 'ready' : 'not_ready',
      service: String(service),
      database: db ? 'ready' : 'not_ready',
      transactions: transactions ? 'ready' : 'not_ready',
      timestamp: timestamp(now)
    }
  };
}

function createHealthHandlers({ databaseReady, transactionReady = true, service = 'telegram-mini-app' } = {}) {
  return {
    liveness(_req, res) {
      const result = livenessStatus({ service });
      return res.status(result.statusCode).json(result.body);
    },
    readiness(_req, res) {
      const dbReady = typeof databaseReady === 'function' ? databaseReady() === true : databaseReady === true;
      const txReady = typeof transactionReady === 'function' ? transactionReady() === true : transactionReady === true;
      const result = readinessStatus({ databaseReady: dbReady, transactionReady: txReady, service });
      return res.status(result.statusCode).json(result.body);
    }
  };
}

module.exports = { livenessStatus, readinessStatus, createHealthHandlers };
