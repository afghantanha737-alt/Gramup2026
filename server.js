require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const { startRequest } = require('./utils/metrics');
const { consumeRateLimit } = require('./utils/sharedRateLimit');
const { verifyMongoTransactionCapability, getMongoTransactionStatus } = require('./utils/mongoTransaction');
const { isValidAdminKey } = require('./utils/adminKey');
const { withDistributedJobLock } = require('./utils/distributedJobLock');
const { getMaintenanceState, telegramIdFromInitData, isAllowedTelegramId } = require('./utils/maintenance');

const app = express();
app.disable('x-powered-by');

/* =========================================================
   CONFIG
========================================================= */
const PORT = Number(process.env.PORT || 3000);
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('❌ MONGO_URI is not configured.');
  process.exit(1);
}
if (!process.env.BOT_TOKEN) {
  console.error('❌ BOT_TOKEN is not configured.');
  process.exit(1);
}
const WEBHOOK_SECRET_VALID = /^[A-Za-z0-9_-]{1,256}$/.test(String(process.env.TELEGRAM_WEBHOOK_SECRET || ''));
if (process.env.NODE_ENV === 'production' && !WEBHOOK_SECRET_VALID) {
  console.error('❌ A valid TELEGRAM_WEBHOOK_SECRET is required in production.');
  process.exit(1);
}

/* =========================================================
   SECURITY / MIDDLEWARE
========================================================= */
app.set('trust proxy', 1);
app.use(startRequest);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

const allowedOrigins = String(process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.length === 0) {
        return callback(process.env.NODE_ENV === 'production' ? new Error('CORS origin not configured') : null, process.env.NODE_ENV !== 'production');
      }
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('CORS origin not allowed'));
    },
    allowedHeaders: ['Content-Type', 'X-Telegram-Init-Data', 'Idempotency-Key', 'x-admin-session', 'x-admin-key'],
    credentials: true
  })
);

app.use(express.json({ limit: '150kb' }));
app.use(express.urlencoded({ extended: false, limit: '150kb' }));

/* TEST-only Maintenance Mode: Admin and the access probe remain available. */
app.use('/api', async (req, res, next) => {
  if (req.path === '/maintenance/access' || req.path === '/health' || req.path === '/ready' || req.path.startsWith('/admin')) return next();
  try {
    const state = await getMaintenanceState();
    if (!state.enabled) return next();
    const telegramId = telegramIdFromInitData(req.get('X-Telegram-Init-Data'));
    if (isAllowedTelegramId(state, telegramId)) return next();
    return res.status(423).json({ success: false, code: 'MAINTENANCE_MODE', maintenance: true, message: 'Mini App در حال بروزرسانی است.' });
  } catch (error) {
    console.error('Maintenance access check failed:', error.message || error);
    return res.status(503).json({ success: false, code: 'MAINTENANCE_CHECK_UNAVAILABLE', message: 'سرویس موقتاً در دسترس نیست.' });
  }
});

/* =========================================================
   SHARED DATABASE RATE LIMITS — common to every app instance
========================================================= */
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX_REQUESTS = 120;
const ADMIN_RATE_MAX_REQUESTS = 45;

app.use('/api', async (req, res, next) => {
  try {
    const result = await consumeRateLimit(req.ip || 'unknown', 'api', RATE_MAX_REQUESTS, RATE_WINDOW_MS);
    if (!result.allowed) return res.status(429).json({ success: false, message: 'درخواست‌های شما بیش از حد مجاز است. کمی صبر کنید.' });
    return next();
  } catch (error) {
    console.error('Shared API rate limiter unavailable:', error.message || error);
    return res.status(503).json({ success: false, code: 'RATE_LIMIT_UNAVAILABLE', message: 'درخواست موقتاً در دسترس نیست.' });
  }
});

app.use('/api/admin', async (req, res, next) => {
  try {
    const result = await consumeRateLimit(req.ip || 'unknown', 'admin', ADMIN_RATE_MAX_REQUESTS, RATE_WINDOW_MS);
    if (!result.allowed) return res.status(429).json({ success: false, message: 'تعداد درخواست‌های پنل زیاد است. یک دقیقه بعد دوباره تلاش کنید.' });
    return next();
  } catch (error) {
    console.error('Shared Admin rate limiter unavailable:', error.message || error);
    return res.status(503).json({ success: false, code: 'RATE_LIMIT_UNAVAILABLE', message: 'درخواست موقتاً در دسترس نیست.' });
  }
});

/* =========================================================
   STATIC FRONTEND
========================================================= */
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  setHeaders(res, filePath) {
    if (['index.html', 'admin.html', 'app.js'].includes(path.basename(filePath))) {
      res.setHeader('Cache-Control', 'no-store, max-age=0');
    }
  }
}));

/* =========================================================
   API ROUTES
========================================================= */
app.use('/api/auth', require('./routes/auth'));
app.use('/api/required-channels', require('./routes/membership'));
app.use('/api/app-info', require('./routes/appInfo'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/ton-proof', require('./routes/tonProof'));
app.use('/api/points', require('./routes/points'));
app.use('/api/referral', require('./routes/referral'));
app.use('/api/leaderboard', require('./routes/leaderboard'));
app.use('/api/mobile-auth', require('./routes/mobileAuth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/maintenance', require('./routes/maintenance'));
app.use('/api/telegram', require('./routes/telegramWebhook'));

app.get('/api/health', (req, res) => {
  const mongoState = mongoose.connection.readyState;
  const transactions = getMongoTransactionStatus();
  const mongoStatus = mongoState === 1 ? 'connected' : mongoState === 2 ? 'connecting' : 'disconnected';
  res.json({ success: true, status: 'ok', service: 'telegram-mini-app', mongodb: mongoStatus,
    transactions: transactions.checked ? (transactions.supported ? 'supported' : 'unavailable') : 'unchecked',
    readiness: mongoState === 1 && transactions.supported ? 'ready' : 'not_ready',
    uptime: Math.floor(process.uptime()), timestamp: new Date().toISOString() });
});

app.get('/api/ready', (req, res) => {
  const mongoState = mongoose.connection.readyState;
  const transactions = getMongoTransactionStatus();
  const production = process.env.NODE_ENV === 'production';
  const required = {
    mongoUriConfigured: Boolean(MONGO_URI),
    botConfigured: Boolean(process.env.BOT_TOKEN),
    adminKeyConfigured: isValidAdminKey(String(process.env.ADMIN_KEY || '')),
    appUrlConfigured: Boolean(String(process.env.APP_URL || '').trim()),
    webhookSecretValid: WEBHOOK_SECRET_VALID,
    allowedOriginsConfigured: String(process.env.ALLOWED_ORIGINS || '').split(',').some(value => value.trim())
  };
  const requiredConfigReady = required.mongoUriConfigured && required.botConfigured && required.adminKeyConfigured
    && (!production || (required.appUrlConfigured && required.webhookSecretValid && required.allowedOriginsConfigured));
  const ready = mongoState === 1 && transactions.supported && requiredConfigReady;
  res.status(ready ? 200 : 503).json({ success: ready, status: ready ? 'ready' : 'not_ready',
    mongodb: mongoState === 1 ? 'connected' : 'disconnected', transactionSupport: transactions.checked ? transactions.supported : false,
    transactionReason: transactions.supported ? '' : (transactions.checked ? transactions.reason : 'not checked'),
    requiredConfig: required, production, timestamp: new Date().toISOString() });
});

app.use('/api', (req, res) => {
  res.status(404).json({ success: false, message: 'API endpoint not found' });
});

/* =========================================================
   FRONTEND FALLBACK
========================================================= */
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* =========================================================
   GLOBAL ERROR HANDLER
========================================================= */
app.use((err, req, res, next) => {
  // هنگام خاموش شدن (مثلاً دیپلوی جدید) اتصال دیتابیس بسته می‌شود؛ این خطای مورد انتظار است، نه باگ.
  if (err && err.name === 'MongoClientClosedError') {
    if (res.headersSent) return undefined;
    return res.status(503).json({ success: false, message: 'Server is restarting. Please try again.' });
  }

  console.error('Unhandled server error:', err);
  if (res.headersSent) return next(err);

  if (err.message === 'CORS origin not allowed') {
    return res.status(403).json({ success: false, message: 'Origin not allowed' });
  }
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ success: false, message: 'Invalid JSON payload' });
  }
  return res.status(500).json({ success: false, message: 'Internal server error' });
});

/* =========================================================
   DATABASE + START
========================================================= */
let server;

async function startServer() {
  try {
    await mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE || 20),
      minPoolSize: Number(process.env.MONGO_MIN_POOL_SIZE || 2),
      heartbeatFrequencyMS: 10000
    });
    console.log('✅ MongoDB connected');
    const transactionCheck = await verifyMongoTransactionCapability();
    if (!transactionCheck.supported) {
      console.error('❌ MongoDB transaction capability unavailable:', transactionCheck.reason);
      if (process.env.NODE_ENV === 'production') throw new Error('Production requires transaction-capable MongoDB; readiness remains blocked.');
    }

    // Build and verify durable constraints before accepting financial or webhook requests.
    // These are schema indexes only; no existing financial records are rewritten or dropped.
    for (const modelPath of [
      './models/Settings', './models/PointsLedger', './models/Withdrawal', './models/TaskCompletion',
      './models/IdempotencyOperation', './models/TelegramWebhookUpdate', './models/RateLimitBucket',
      './models/AdminSession', './models/TelegramAdminConversation', './models/AdminLog', './models/DistributedJobLock',
      './models/TaskReactionState', './models/LatestPostEngagementState', './models/Deposit',
      './models/VipPlan', './models/VipSubscription', './models/BroadcastJob', './models/TonProofChallenge', './models/GramSwapIntent'
    ]) await require(modelPath).init();

    // Latest Post Engagement requires its per-channel/post/user uniqueness constraint
    // before Telegram webhooks are accepted.
    await require('./models/TaskReactionState').init();
    // Open→Check authorization is unique per user/task and must be indexed before serving.
    await require('./models/LatestPostEngagementState').init();
    // Deposit invoices are unique per user and each TON tx hash may be credited only once.
    await require('./models/Deposit').init();
    // VIP plan/subscription indexes must exist before purchases or daily claims are served.
    const VipPlan = require('./models/VipPlan');
    await VipPlan.init();
    await require('./models/VipSubscription').init();
    await VipPlan.ensureDefaults();

    // Existing legacy indexes/data are inspected and handled only through an
    // explicit operator-managed migration; startup never drops indexes or rewrites rows.

    const runJob = (key, label, job) => withDistributedJobLock(key, job)
      .catch(error => console.error(`${label} failed:`, error.message || error));

    const runReferralSweep = require('./utils/referralSweep');
    void runJob('referral-sweep', 'Referral sweep', runReferralSweep);
    setInterval(() => { void runJob('referral-sweep', 'Scheduled referral sweep', runReferralSweep); }, 15 * 60 * 1000);

    // Shared database leases prevent each app instance from sending the same reminders.
    const { runDailyReminderSweep } = require('./utils/dailyReminder');
    setInterval(() => { void runJob('daily-reminder-sweep', 'Daily reminder sweep', runDailyReminderSweep); }, 10 * 60 * 1000);

    const { settleClosedWeeks } = require('./utils/weeklyLeaderboardSettlement');
    void runJob('weekly-leaderboard-settlement', 'Initial weekly settlement', settleClosedWeeks);
    setInterval(() => { void runJob('weekly-leaderboard-settlement', 'Scheduled weekly settlement', settleClosedWeeks); }, 60 * 1000);

    const { runWeeklyChallengeStartNotification } = require('./utils/weeklyChallengeStartNotification');
    void runJob('weekly-challenge-start-notification', 'Initial weekly challenge start notification', runWeeklyChallengeStartNotification);
    setInterval(() => { void runJob('weekly-challenge-start-notification', 'Scheduled weekly challenge start notification', runWeeklyChallengeStartNotification); }, 60 * 1000);

    const { settleMaturedVipSubscriptions } = require('./utils/vipSettlement');
    void runJob('vip-principal-settlement', 'Initial VIP principal settlement', () => settleMaturedVipSubscriptions());
    setInterval(() => { void runJob('vip-principal-settlement', 'Scheduled VIP principal settlement', () => settleMaturedVipSubscriptions()); }, 60 * 1000);

    server = app.listen(PORT, () => {
      server.requestTimeout = 120000;
      server.headersTimeout = 125000;
      server.keepAliveTimeout = 5000;
      console.log(`🚀 Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    process.exit(1);
  }
}

/* =========================================================
   GRACEFUL SHUTDOWN
========================================================= */
async function shutdown(signal) {
  console.log(`\n${signal} received. Shutting down...`);
  try {
    if (server) {
      // اول اتصال‌های بیکار (keep-alive) بسته می‌شوند و درخواست‌های در حال انجام تمام می‌شوند؛
      // بعد دیتابیس بسته می‌شود تا درخواستی وسط کار با «client was closed» خراب نشود.
      await new Promise(resolve => {
        server.close(resolve);
        if (server.closeIdleConnections) server.closeIdleConnections();
        const force = setTimeout(() => { if (server.closeAllConnections) server.closeAllConnections(); }, 8000);
        force.unref();
      });
    }
    await mongoose.connection.close(false);
    console.log('✅ Server shutdown completed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Shutdown error:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', error => console.error('Unhandled Promise Rejection:', error));
process.on('uncaughtException', error => {
  console.error('Uncaught Exception:', error);
  shutdown('uncaughtException').catch(() => process.exit(1));
});

startServer();
