require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const { startRequest } = require('./utils/metrics');
const { ensureVipActivationTasks } = require('./utils/vipActivationTasks');

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

/* =========================================================
   SECURITY / MIDDLEWARE
========================================================= */
app.set('trust proxy', 1);
app.use(startRequest);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Telegram Web (web.telegram.org) Mini App را داخل iframe باز می‌کند؛ X-Frame-Options: DENY آن را خراب می‌کرد.
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org https://telegram.org");
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
    credentials: true
  })
);

app.use(express.json({ limit: '150kb' }));
app.use(express.urlencoded({ extended: false, limit: '150kb' }));

/* =========================================================
   BASIC RATE LIMIT (بدون وابستگی خارجی)
========================================================= */
const rateBuckets = new Map();
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX_REQUESTS = 120;
const adminRateBuckets = new Map();
const ADMIN_RATE_MAX_REQUESTS = 45;

app.use('/api', (req, res, next) => {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const bucket = rateBuckets.get(key) || { count: 0, resetAt: now + RATE_WINDOW_MS };

  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + RATE_WINDOW_MS;
  }
  bucket.count += 1;
  rateBuckets.set(key, bucket);

  if (bucket.count > RATE_MAX_REQUESTS) {
    return res.status(429).json({ success: false, message: 'درخواست‌های شما بیش از حد مجاز است. کمی صبر کنید.' });
  }
  next();
});

// پنل ادمین عملیات مالی و مدیریتی دارد؛ محدودیت جداگانه جلوی brute-force کلید و فشار ناگهانی را می‌گیرد.
app.use('/api/admin', (req, res, next) => {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const bucket = adminRateBuckets.get(key) || { count: 0, resetAt: now + RATE_WINDOW_MS };
  if (now > bucket.resetAt) { bucket.count = 0; bucket.resetAt = now + RATE_WINDOW_MS; }
  bucket.count += 1;
  adminRateBuckets.set(key, bucket);
  if (bucket.count > ADMIN_RATE_MAX_REQUESTS) {
    return res.status(429).json({ success: false, message: 'تعداد درخواست‌های پنل زیاد است. یک دقیقه بعد دوباره تلاش کنید.' });
  }
  next();
});

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets.entries()) {
    if (now > bucket.resetAt + RATE_WINDOW_MS) rateBuckets.delete(key);
  }
  for (const [key, bucket] of adminRateBuckets.entries()) {
    if (now > bucket.resetAt + RATE_WINDOW_MS) adminRateBuckets.delete(key);
  }
}, 5 * 60 * 1000);

/* =========================================================
   STATIC FRONTEND
========================================================= */
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  setHeaders(res, filePath) {
    if (path.basename(filePath) === 'index.html') {
      res.setHeader('Cache-Control', 'no-store, max-age=0');
    }
  }
}));

/* =========================================================
   API ROUTES
========================================================= */
app.use('/api/auth', require('./routes/auth'));
app.use('/api/required-channels', require('./routes/membership'));
app.use('/api/maintenance', require('./routes/maintenance'));
app.use('/api/app-info', require('./routes/appInfo'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/points', require('./routes/points'));
app.use('/api/ads', require('./routes/ads'));
app.use('/api/referral', require('./routes/referral'));
app.use('/api/leaderboard', require('./routes/leaderboard'));
app.use('/api/mobile-auth', require('./routes/mobileAuth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/telegram', require('./routes/telegramWebhook'));

app.get('/api/health', (req, res) => {
  const mongoState = mongoose.connection.readyState;
  const mongoStatus = mongoState === 1 ? 'connected' : mongoState === 2 ? 'connecting' : 'disconnected';
  res.json({
    success: true,
    status: 'ok',
    service: 'telegram-mini-app',
    mongodb: mongoStatus,
    readiness: mongoState === 1 ? 'ready' : 'not_ready',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

app.get('/api/ready', (req, res) => {
  const mongoState = mongoose.connection.readyState;
  const ready = mongoState === 1 && Boolean(process.env.BOT_TOKEN);
  res.status(ready ? 200 : 503).json({ success: ready, status: ready ? 'ready' : 'not_ready', mongodb: mongoState === 1 ? 'connected' : 'disconnected', botConfigured: Boolean(process.env.BOT_TOKEN), timestamp: new Date().toISOString() });
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

    // Latest Post Engagement requires its per-channel/post/user uniqueness constraint
    // before Telegram webhooks are accepted.
    await require('./models/TaskReactionState').init();
    // Open→Check authorization is unique per user/task and must be indexed before serving.
    await require('./models/LatestPostEngagementState').init();
    // Deposit invoices are unique per user and each TON tx hash may be credited only once.
    await require('./models/Deposit').init();
    await require('./models/Task').init();
    // VIP plan/subscription indexes must exist before purchases or daily claims are served.
    const VipPlan = require('./models/VipPlan');
    await VipPlan.init();
    await require('./models/VipSubscription').init();
    await VipPlan.ensureDefaults();
    await ensureVipActivationTasks();

    // پاک‌سازی ایندکس‌های قدیمی/ناسازگار که ممکن است از نسخه‌های قبلی
    // پروژه در دیتابیس باقی مانده باشند (مثلاً ایندکس روی فیلدهای
    // userId/taskId که در مدل فعلی وجود ندارند و باعث خطای duplicate
    // key کاذب می‌شوند).
    await cleanupStaleIndexes();
    await repairLedgerSourceIdIndex();

    const runReferralSweep = require('./utils/referralSweep');
    runReferralSweep().catch(error => console.error('Initial referral sweep failed:', error));
    setInterval(() => {
      runReferralSweep().catch(error => console.error('Scheduled referral sweep failed:', error));
    }, 15 * 60 * 1000);

    // یادآوری ورود روزانه: هر ۱۰ دقیقه چک می‌کند که آیا الان همان ساعتِ تنظیم‌شده در پنل ادمین هست؛
    // پیش‌فرض خاموش است (Settings.dailyReminderEnabled=false) تا خودتان تصمیم بگیرید فعالش کنید.
    const { runDailyReminderSweep } = require('./utils/dailyReminder');
    setInterval(() => {
      runDailyReminderSweep().catch(error => console.error('Daily reminder sweep failed:', error));
    }, 10 * 60 * 1000);

    // پایان هفته و پرداخت جوایز هفتگی مستقل از بازشدن صفحه‌ی کاربر اجرا می‌شود.
    // خود Settlement با Award و Ledger یکتا است؛ بنابراین restart یا اجرای هم‌زمان
    // دو نمونه باعث پرداخت دوباره نمی‌شود.
    const { settleClosedWeeks } = require('./utils/weeklyLeaderboardSettlement');
    settleClosedWeeks().catch(error => console.error('Initial weekly settlement failed:', error));
    setInterval(() => {
      settleClosedWeeks().catch(error => console.error('Scheduled weekly settlement failed:', error));
    }, 60 * 1000);

    // Principal return is idempotent and transactionally coupled to the existing Points ledger.
    const { settleMaturedVipSubscriptions } = require('./utils/vipSettlement');
    settleMaturedVipSubscriptions().catch(error => console.error('Initial VIP principal settlement failed:', error));
    setInterval(() => {
      settleMaturedVipSubscriptions().catch(error => console.error('Scheduled VIP principal settlement failed:', error));
    }, 60 * 1000);

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

async function cleanupStaleIndexes() {
  try {
    const collection = mongoose.connection.collection('taskcompletions');
    const indexes = await collection.indexes();

    // فقط نام‌های قدیمی و شناخته‌شده حذف می‌شوند؛ indexهای جدید مدل نباید
    // در هر startup حذف و دوباره ساخته شوند.
    const staleNames = new Set(['userId_1_taskId_1', 'taskId_1_userId_1']);

    for (const index of indexes) {
      if (staleNames.has(index.name)) {
        await collection.dropIndex(index.name);
        console.log(`🧹 Dropped stale index "${index.name}" from taskcompletions`);
      }
    }
  } catch (error) {
    // این عملیات صرفاً پاک‌سازی است؛ اگر کالکشن هنوز وجود ندارد یا خطای
    // بی‌ضرر دیگری رخ دهد، نباید جلوی بالا آمدن سرور را بگیرد.
    console.warn('Index cleanup skipped (non-fatal):', error.message);
  }
}

async function repairLedgerSourceIdIndex() {
  try {
    const collection = mongoose.connection.collection('pointsledgers');
    const indexes = await collection.indexes();
    const sourceIndex = indexes.find(index => index.name === 'sourceId_1');
    const explicitNullFilter = { sourceId: { $type: 'null' } };
    const nullCount = await collection.countDocuments(explicitNullFilter);
    if (sourceIndex && nullCount === 0) return;
    if (sourceIndex) await collection.dropIndex('sourceId_1');
    // نسخه قبلی sourceId را به‌صورت صریح null ذخیره می‌کرد؛ sparse unique
    // مقدار missing را نادیده می‌گیرد اما null صریح را index می‌کند.
    await collection.updateMany(explicitNullFilter, { $unset: { sourceId: '' } });
    await collection.createIndex({ sourceId: 1 }, { unique: true, sparse: true, name: 'sourceId_1' });
    console.log(`🧹 Repaired pointsledgers sourceId index; removed ${nullCount} null sourceIds`);
  } catch (error) {
    console.warn('Ledger sourceId index repair skipped (non-fatal):', error.message);
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
