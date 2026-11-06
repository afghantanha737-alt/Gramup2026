# گزارش نهایی ممیزی جامع GramUp

**دامنه:** ممیزی خواندنی مخزن `telegram-mini-audit` بر پایه یافته‌های شش محور ارائه‌شده: referral و ضدتقلب، scheduler و Render، leaderboard و i18n، Telegram auth و API security، معماری API و عملیات اعلان، و مدل‌های داده/مالی/تست/عملیات.

**تاریخ گزارش:** ۱۴۰۵/۰۸/۰۴ برابر با ۲۰۲۶-۱۰-۲۶  
**نوع گزارش:** Audit-only؛ در این ممیزی هیچ کد، تست، migration یا تنظیمی تغییر داده و هیچ تستی اجرا نشده است.

## ۱. خلاصه اجرایی

مهم‌ترین ریسک قطعی، امکان جعل انتساب referral از طریق ساخت لینک Mini App با Telegram ID خام و پذیرش شناسه عددی بدون امضا است (`utils/referralCore.js:51-73`). این نقص می‌تواند انتساب، پاداش و commission را به حساب دلخواه منحرف کند. در کنار آن، جریان Contact و pending referral به‌صورت کامل و اتمیک در همان رویداد احراز نمی‌شود و وضعیت pending expiry/consumption روشنی ندارد؛ بنابراین تأخیر، از دست‌رفتن اعلان یا رفتار وابسته به ترتیب درخواست محتمل است.

دومین خوشه پرخطر، پایداری scheduler و عملیات پس از خرابی است: اجرای روزانه به `setInterval` شصت‌ثانیه‌ای و پنجره دقیق یک دقیقه متکی است و اجرای جبرانی پس از restart، sleep یا downtime مشاهده نشد. scheduler در همان web process اجرا می‌شود و وجود worker/cron خارجی در دامنه ممیزی اثبات نشد. در delivery اعلان نیز رکورد می‌تواند پس از خطای provider در وضعیت `sending` باقی بماند و قابل retry نباشد.

در لایه امنیت، validator موازی `utils/verifyTelegram.js` در صورت reachable بودن، کنترل max-age، duplicate key، validation و مقایسه timing-safe کامل ندارد؛ استفاده واقعی آن از فایل‌های خوانده‌شده اثبات نشد. CORS هدر `Authorization` را در allowed headers ندارد و عملیات admin نیز به private chat محدود نشده است؛ فعال بودن همه این مسیرها در محیط production از کد به‌تنهایی اثبات نشد.

در لایه کیفیت خروجی کاربر، اعلان پاداش leaderboard آرگومان هفته را ارسال نمی‌کند و در هر سه زبان مقدار `undefined` در متن ممکن است (`utils/weeklyLeaderboardSettlement.js:173-180` در برابر قرارداد `utils/botMessages.js:98-101`). API leaderboard نیز فیلتر banned را برای `above` و top یکسان اجرا نمی‌کند و limit پیش از lookup/فیلتر اعمال می‌شود.

در مدل‌های مالی و داده، وجود constraintهای کافی برای ضد double-credit، source/transaction یکتا، completion تکراری، و invariantهای cross-field اثبات نشد. idempotency قدیمی پس از crash lease/reclaim/reconciliation ندارد. این موارد ریسک طراحی و پوشش آزمون‌اند، نه اثبات رخداد واقعی ناسازگاری داده، crash، outage یا vulnerability وابستگی.

**جمع‌بندی شدت:** یک High قطعی در جعل referral؛ چند High/Medium قطعی یا مشروط در scheduler، notification recovery، قرارداد خطا، correlation logging، auth و مدل‌های مالی؛ یک High قطعی در نقص متن leaderboard. هیچ ادعایی درباره exploit فعال، رخداد production یا وجود/عدم وجود کامل تست‌ها فراتر از فایل‌های بررسی‌شده مطرح نمی‌شود.

## ۲. جدول ریسک‌های تلفیق‌شده

| شناسه | Severity | حوزه | شرح مستند | مسیر/خط |
|---|---|---|---|---|
| R-01 | High | Referral | لینک Mini App با Telegram ID خام ساخته و شناسه عددی بدون امضا پذیرفته می‌شود؛ جعل انتساب و نسبت‌دادن پاداش/commission ممکن است. | `utils/referralCore.js:51-73` |
| R-02 | Medium | Referral | پس از Contact معتبر، pending referral همان‌جا مصرف و link نمی‌شود؛ اعلان و پاداش تا احراز بعدی تضمین نشده‌اند. | `routes/telegramWebhook.js:42-73`؛ `utils/telegramAuth.js:131-150` |
| R-03 | Medium | Referral | pending state فیلدهای expiry/consumption اتمیک و policy روشن برای ورود مجدد ندارد؛ ترتیب درخواست‌ها اثرگذار است. | `utils/telegramAuth.js:131-150` |
| R-04 | Medium | Referral data | رابطه فقط `(referrerId,referredUserId)` را unique می‌کند و ancestor یکتا در هر level مستقل از schema enforce نشده است. | `models/ReferralRelationship.js:15-16` |
| R-05 | Medium/Hardening | Claims | taskId در embedded claim unique نیست؛ دفاع اصلی route-level `findOneAndUpdate` است و مسیرهای دیگر/داده قدیمی با schema مسدود نمی‌شوند. | `models/ReferralRewardClaim.js:4-10`؛ `User.js:41-43`؛ `routes/referral.js:210-239` |
| R-06 | Low/Medium | Notification | اعلان پس از commit fire-and-forget است و retry durable از دامنه بررسی‌شده اثبات نشد. | `utils/referralSystem.js:247-264` |
| R-07 | High | Scheduler | scheduler فقط `setInterval` و پنجره دقیق دقیقه را دارد؛ tick در ثانیه ۲۰/۵۹، delay یا startup بعد از پنجره می‌تواند اجرا را از دست بدهد. | `server.js:286-288`؛ `dailyReminder.js:12-17` |
| R-08 | High | Scheduler/Infra | scheduler در web process است و worker/cron خارجی یا catch-up پس از downtime مشاهده نشد. | `server.js:282-312` |
| R-09 | Medium | Scheduler | timezone/local در Settings ذخیره می‌شود اما تصمیم runtime بر اساس UTC fields است؛ تنظیم ممکن است با رفتار واقعی جدا شود. | `Settings.js:13-20`؛ `server.js:269-277`؛ `dailyReminder.js:12-17` |
| R-10 | Medium | Scheduler | migration نسخه ۲ فیلدهای تنظیمات را برای اسناد قدیمی overwrite می‌کند، بدون snapshot/audit مشاهده‌شده. | `server.js:268-280` |
| R-11 | High/Medium | Scheduler | lease و heartbeat بدون fencing/idempotency side effect دارند؛ expiry یا renewal failure می‌تواند overlap ایجاد کند. | `distributedJobLock.js:5-37` |
| R-12 | Medium | Scheduler | marker پیش از notify ثبت می‌شود؛ خطای transient همان روز retry نمی‌شود. | `dailyReminder.js:122-130` |
| R-13 | Medium/Conditional | Scheduler | دو sweep تعریف روز متفاوت و marker مشترک دارند؛ caller فعال check-in sweep در دامنه دیده نشد، پس اثر جاری اثبات نشده است. | `dailyReminder.js:80-89`؛ `dailyCheckinNotification.js:21-23,62-74` |
| R-14 | High | Leaderboard/i18n | آرگومان week به `leaderboardReward` ارسال نشده و متن هر سه زبان می‌تواند `undefined` داشته باشد. | `utils/weeklyLeaderboardSettlement.js:173-180`؛ `utils/botMessages.js:98-101` |
| R-15 | Medium | Leaderboard | `above` کاربران banned را فیلتر نمی‌کند، در حالی‌که top فیلتر می‌کند؛ rank با جدول قابل مشاهده ناسازگار می‌شود. | `routes/leaderboard.js:53-72` |
| R-16 | Medium | Leaderboard | limit=50 پیش از lookup و فیلتر banned است؛ bannedهای ابتدای فهرست جدول سالم را کوتاه می‌کنند. | `routes/leaderboard.js:53-60` |
| R-17 | High if reachable | Auth | validator موازی Telegram فاقد max-age، duplicate-key/type validation، try/catch و کنترل کامل مقایسه است؛ استفاده واقعی helper اثبات نشد. | `utils/verifyTelegram.js:5-26` |
| R-18 | Medium | API security | `Authorization` در allowedHeaders نیست و preflight مسیر Bearer موبایل ممکن است شکست بخورد؛ bypass احراز هویت اثبات نشده است. | `server.js:54-66`؛ `utils/unifiedAuth.js:12-15`؛ `utils/mobileAuth.js:71-90` |
| R-19 | Medium/High conditional | Admin security | admin فقط sender ID را بررسی می‌کند و private chat/همسانی chat با sender کنترل نشده؛ افشا/اجرای ناخواسته در گروه مشروط به فعال بودن مسیر است. | `routes/telegramWebhook.js:146-163,328-330` |
| R-20 | Medium | Auth hardening | session admin با telegramId و نه `(telegramId,chatId)` نگه‌داری می‌شود؛ callback چت دیگر می‌تواند state را مصرف کند. | `routes/telegramWebhook.js:113-163,331-336` |
| R-21 | Medium | Auth hardening | `INIT_DATA_MAX_AGE` هر مقدار مثبت env را بدون hard cap می‌پذیرد؛ replay در پنجره مجاز نیز one-time نیست. نشت یا exploit فعال اثبات نشده است. | `utils/telegramAuth.js:15-59,42-45` |
| R-22 | Medium | Auth privacy | پذیرش initData از query/body خطر ثبت در log/history/referrer دارد؛ نشت واقعی اثبات نشده است. | `utils/telegramAuth.js:168-169` |
| R-23 | High | Notification | خطای `notifyUser` پس از claim، رکورد `sending` را بدون transition/error persistence رها می‌کند؛ retry خودکار مشاهده نشد. | `utils/notificationDelivery.js:15-48` |
| R-24 | High | API architecture | خطاها بین global handler و catch دستی پخش‌اند و status/code/message قرارداد واحد ندارند. | `server.js:189-205`؛ routeهای tasks/points |
| R-25 | High | Observability | requestId با لاگ‌ها correlation نشده و logging عمدتاً console و غیرساختاریافته است؛ secret sanitization استاندارد مشاهده نشد. | `server.js:81-205`؛ `utils/metrics.js:8-21` |
| R-26 | Medium | Metrics | metrics حافظه‌ای/process-local است، path/error/inflight ندارد و average latency بر ورودی‌ها از جمله ناتمام تقسیم می‌شود. | `utils/metrics.js:4-33` |
| R-27 | Medium/High | Webhook | failed update با 500 ثبت می‌شود اما رفتار reclaim/lease برای failed از دامنه اثبات نشد؛ duplicate مستقیم 200 می‌گیرد. | `routes/telegramWebhook.js:271-348` |
| R-28 | Medium | API | statusهای duplicate/conflict/expired/unavailable و retry hintها ناسازگارند. | `routes/points.js`؛ `routes/tasks.js`؛ `routes/mobileAuth.js` |
| R-29 | Medium | Async | `asyncHandler` فقط متدهای اصلی Router را patch می‌کند و `router.use/param` و middlewareها قرارداد یکنواخت ندارند. | `utils/asyncHandler.js:9-21` |
| R-30 | Medium | API/ops | notificationهای بعد از پاسخ fire-and-forget هستند و unhandledRejection فقط log می‌شود؛ drain/readiness policy مشاهده نشد. | `routes/admin.js:1000-1006`؛ `routes/points.js:568-576`؛ `server.js:351-357` |
| R-31 | High | Idempotency/finance | عملیات `processing` پس از crash lease/reclaim/reconciliation ندارد؛ retry می‌تواند برای همیشه duplicate رد شود. | `utils/idempotency.js:50-56,71-112`؛ `models/IdempotencyOperation.js:16-25` |
| R-32 | High | Finance/data | schemaها sign/type، محدوده پول، endAt>startAt، سقف claim و سازگاری balance/ledger را cross-field enforce نمی‌کنند. | `models/PointsLedger.js:13-49`؛ `VipSubscription.js:5-20`؛ `Settings.js:5-38`؛ `User.js:13-16`؛ `utils/ledger.js:9-21` |
| R-33 | Medium | Finance | refund برداشت با `admin_adjust` ثبت می‌شود و نوع مستقل `withdrawal_refund` ندارد؛ گزارش‌گیری منبع کسب‌وکار را از دست می‌دهد. | `utils/withdrawalFinance.js:42-64` |
| R-34 | Medium | Finance | `recordLedger` خطا را فقط log می‌کند؛ caller می‌تواند balance را بدون ledger معتبر تغییر دهد مگر نتیجه را دستی بررسی کند. | `utils/ledger.js:9,23-33` |
| R-35 | Medium | Data integrity | `TaskCompletion` unique compound ندارد و مسیر findOne سپس save متکی است؛ race duplicate/reward ممکن است، اما وقوع واقعی اثبات نشده است. | `models/TaskCompletion.js:37-51`؛ `routes/points.js:1095-1100` |
| R-36 | Medium | Migration/Ops | migration referral scan و apply را جدا اجرا می‌کند و write lock/enforcement ندارد؛ README توقف write را توصیه کرده است. | `scripts/migrate-referral-v2.js:129-143`؛ `README.md:29-43` |
| R-37 | Medium | Operations | runbook backup/restore، retention، restore drill، RPO/RTO، lag و alerting در مستندات خوانده‌شده اثبات نشد. | `README.md:14,31-43`؛ `.env.example:8-9` |
| R-38 | Medium | Tests | تست‌های مشاهده‌شده عمدتاً static/source-contract یا unit/fake response هستند؛ integration واقعی Mongo replica set، concurrency، rollback و provider contract اثبات نشد. | `package.json:6-11` و تست‌های اشاره‌شده |
| R-39 | Low/Medium | Operations | verify-production فقط health/readiness را GET می‌کند و smoke مالی/index/provider ندارد. | `scripts/verify-production.js:17-25,41-54` |
| R-40 | Low | Supply chain | lockfile integrity دارد، اما policy صریح `npm ci`، Node pin و audit دوره‌ای در scriptها مستند/پیاده نشده؛ vulnerability قطعی اثبات نشد. | `package-lock.json:1-20`؛ `package.json:9-11` |

**کنترل‌های مثبت مستند:** `User.telegramId` و `referralCode` unique هستند؛ `referredBy` با شرط null اتمیک set می‌شود؛ link و payout در transaction انجام می‌شوند؛ cycle detection، webhook `update_id` dedup و gateهای risk/review وجود دارند؛ HMAC اصلی و timing-safe compare در `telegramAuth.js`، phone self-contact/country gate، مصرف اتمیک mobile challenge، hash/revocation/TTL session، secret webhook fail-closed، rate limit مشترک DB و برخی indexهای هویتی موجودند.

## ۳. وضعیت فعلی requirementهای کاربر

| Requirement | وضعیت فعلی | نتیجه ممیزی |
|---|---|---|
| Referral امن و ضدجعل | ناقص | HMAC signed token، expiry، audience/bot binding و audit event موجود/اثبات‌شده نیست؛ ID خام پذیرفته می‌شود. |
| تکمیل referral بعد از Contact | ناقص | link/consume در همان جریان Contact تضمین نشده؛ pending policy و idempotency روشن نیست. |
| یکتایی رابطه، claim و payout | ناقص/وابسته به route | برخی guardهای اتمیک وجود دارد، اما schema/index جامع برای ancestor level، claim و ledger از دامنه اثبات نشد. |
| اعلان قابل اتکا | ناقص | fire-and-forget و `sending` گیرکرده ممکن است؛ outbox durable و retry/replay مشاهده نشد. |
| scheduler روزانه مقاوم | ناقص | پنجره دقیق و web-process dependency؛ catch-up و worker خارجی اثبات نشده است. |
| timezone/local | ناسازگار | settings local ذخیره می‌شود ولی runtime بر UTC fields تصمیم می‌گیرد. |
| leaderboard و i18n | ناقص | week در اعلان جا افتاده و فیلتر banned بین top/rank یکسان نیست؛ قرارداد کامل ترجمه آزموده‌شده نیست. |
| Telegram auth | بخشی صحیح، بخشی پرریسک | مسیر اصلی کنترل‌های قوی دارد، اما helper موازی و replay/query risks باید canonical شوند. |
| admin isolation | ناقص/مشروط | private chat و bind شدن session به chat اثبات نشده است. |
| API error contract و observability | ناقص | handler، status، log، metrics و async policy یکپارچه نیستند. |
| idempotency و مالی | ناقص/اثبات‌نشده | reclaim/reconciliation، Decimal/typed ledger، unique source و integration concurrency تکمیل/اثبات نشده‌اند. |
| migration و عملیات | ناقص | lock/resume/post-check و runbook restore/RPO/RTO مشاهده نشد. |
| پوشش تست | ناکافی در دامنه مشاهده‌شده | تست‌های unit/static موجودند، اما integration، HTTP contract، concurrency، retry و provider tests اثبات نشدند. |

## ۴. مواردی که واقعاً نیاز به کدنویسی دارند

1. جایگزینی referral token خام با token امضاشده HMAC، دارای expiry، audience/bot binding، nonce یا replay defense و audit event؛ حذف یا محدودسازی branch شناسه عددی.
2. ساخت سرویس idempotent برای مصرف pending referral و `linkReferralByIdentifier` پس از Contact، همراه با transaction/outbox و پاک‌سازی فقط پس از موفقیت.
3. افزودن `createdAt/expiresAt/consumedAt` و conditional `findOneAndUpdate` برای pending؛ تعریف policy ورود مجدد، logout/login و start تکراری.
4. افزودن unique constraint/index متناسب با policy رابطه، claims، ledger source/transaction و TaskCompletion؛ migration داده‌های تکراری و write path واحد لازم است.
5. پیاده‌سازی outbox durable اعلان با eventKey یکتا، وضعیت queued/sending/sent/failed، lease/timeout، retry/backoff، replay و dead-letter.
6. بازطراحی scheduler به catch-up بر اساس آخرین اجرای موفق/day key idempotent، اجرای startup و worker/cron مستقل؛ اعمال timezone canonical.
7. اضافه‌کردن fencing/idempotency به side effectهای worker و monitor کردن lease/heartbeat.
8. اصلاح leaderboard برای pipeline مشترک، فیلتر banned پیش از sort/limit و tie-break یکسان؛ ارسال `window.key` به پیام و validator قرارداد پیام‌های fa/ps/en.
9. حذف یا canonical کردن `verifyTelegram.js` با validator اصلی؛ افزودن max-age، hard cap، schema/duplicate validation، try/catch و timing-safe compare.
10. محدودکردن admin به private chat و bind کردن state به chatId/messageId/nonce؛ استانداردسازی CORS Authorization و حذف initData از query/body یا redaction/no-store.
11. تعریف `AppError` و taxonomy واحد، global handler، async wrapper صریح، status/code/retryAfter استاندارد و structured logging/metrics با requestId.
12. بازطراحی idempotency برای lease/reclaim/reconciliation و تعریف ledger typed/failed-closed با Decimal یا واحد صحیح ثابت و invariantهای مالی.
13. refactor مرحله‌ای controllerهای بزرگ به serviceهای finance/webhook/notification/read model؛ این مورد نگهداری است و مستقیماً به‌عنوان exploit گزارش نشده است.
14. افزودن integration و concurrency tests، migration tests، provider contract tests و property tests.

## ۵. پیشنهاد معماری هدف

### ۵.۱ جریان referral و اعلان

Referral باید از یک مسیر canonical عبور کند: `signed token -> validate token -> resolve invitee/referrer -> fraud/risk gates -> transactional relationship/reward/ledger writes -> outbox event`. token شامل شناسه، audience، bot، issue/expiry، version و nonce/replay key باشد. pending referral به‌عنوان state machine با `created/active/consumed/expired` و conditional update نگهداری شود.

Outbox باید در همان transaction رکورد event را ثبت کند. worker با eventKey یکتا، lease، retry محدود، backoff و dead-letter آن را ارسال کند. state اعلان از state claim مالی جدا باشد تا خطای Telegram باعث rollback یا گم‌شدن accounting نشود.

### ۵.۲ scheduler و زمان

منبع زمان را UTC canonical نگه دارید و timezone کاربر را فقط برای محاسبه day boundary تبدیل کنید. اجرای job باید بر اساس `lastSuccessfulRun` و day keyهای قابل replay باشد، نه برابری دقیقه. یک worker/cron پایدار خارج از web process با distributed lock، fencing token و idempotency side effect نیاز است. markerهای reminder و check-in purpose جدا یا pipeline مشترک با boundary یکسان داشته باشند.

### ۵.۳ امنیت و API

یک validator Telegram و یک contract برای همه routeها داشته باشید. initData فقط در header یا body کنترل‌شده با no-store و redaction مصرف شود. admin command state با chat/message/nonce bind شود و private chat اجباری باشد. global error handler، request context، structured logger و metrics backend مشترک باید مرز API را تشکیل دهند.

### ۵.۴ داده و مالی

Ledger append-only و typed باشد؛ mutation balance فقط در transaction و همراه ledger موفق مجاز شود. source/transaction idempotency باید با index و policy مشخص enforce شود. مقادیر مالی با Decimal یا integer fixed-point ذخیره شوند. برای مسیرهای حساس، unique index و transaction را با Mongo replica-set integration test اثبات کنید، نه فقط با source inspection.

## ۶. برنامه اصلاح مرحله‌ای

### فاز صفر: مهار فوری و شواهد

- branch شناسه خام referral را غیرفعال یا فقط برای migration داخلی محدود کنید.
- پیام leaderboard را با افزودن week argument اصلاح کنید.
- CORS `Authorization` را اصلاح و admin private-chat check را اضافه کنید.
- metric/alert موقت برای missed scheduler، `sending` stuck، failed webhook و duplicate financial operation ایجاد کنید.
- snapshot، data inventory و فهرست indexهای واقعی production تهیه کنید؛ موارد «اثبات‌نشده» را با inspection محیط تکمیل کنید.

### فاز یک: یکپارچگی referral، اعلان و scheduler

- signed token و pending state machine را پیاده کنید.
- transaction + outbox برای referral و notification بسازید.
- worker اعلان با retry/replay/dead-letter و worker scheduler مستقل راه‌اندازی کنید.
- catch-up/day-key، timezone policy، distributed lock/fencing و migration قابل resume را اضافه کنید.

### فاز دو: امنیت و قرارداد API

- validator canonical Telegram و hard cap max-age را اعمال کنید.
- sessionهای admin را به chat bind و query/body initData را حذف/محدود کنید.
- `AppError`، taxonomy، async handling، structured logging، metrics export و graceful drain را یکپارچه کنید.
- claim/finish webhook را برای processing/completed/failed با lease و reclaim مستند کنید.

### فاز سه: داده و مالی

- indexها و constraintهای referral/claim/ledger/TaskCompletion را با migration کنترل‌شده اضافه کنید.
- ledger typed و fail-closed، Decimal/fixed-point و cross-field validation را اعمال کنید.
- idempotency recovery و reconciliation را اضافه و public history را cursor-based کنید.
- migration referral را با write lock یا maintenance mode، batch/resume و post-check اجرا کنید.

### فاز چهار: اثبات و عملیات پایدار

- integration با Mongo replica set، provider mock، HTTP contract و concurrency suite را در CI اجرا کنید.
- `npm ci`، Node pin، dependency audit و staging readiness smoke را اجباری کنید.
- backup/restore drill، RPO/RTO، retention، encryption، Mongo lag و alert runbook را نسخه‌دار کنید.
- rollout را canary، با feature flag و rollback criteria انجام دهید.

## ۷. تست‌های لازم

### Referral، ضدتقلب و اعلان

- token معتبر/نامعتبر، ID خام، signature غلط، expiry، replay، audience/bot mismatch.
- دو link هم‌زمان برای یک invitee با دو referrer؛ دقیقاً یک رابطه، reward و commission.
- Contact معتبر/نامعتبر، کشور غیرمجاز، تکرار Contact، start تکراری و logout/login.
- banned، risk blocked، under review، restricted، self-referral، cycle و max depth.
- eventKey یکتا، retry transient/permanent، lease recovery، provider failure و replay.

### Scheduler

- fake clock در 03:59:59، 04:00:00، 04:00:59 و 04:01:00؛ startup در 04:00:20 و downtime چندساعته.
- دو worker، lock busy، duplicate-key، owner قدیمی/جدید، lease expiry و fencing.
- timezone conversion، day boundary UTC/Kabul، markerهای مستقل و banned/missing telegramId.
- migration version 0/1، تنظیم سفارشی، اجرای مجدد و حفظ snapshot.

### Leaderboard، i18n و auth

- `leaderboardReward` در fa/ps/en با rank/points/week و نبود literal `undefined/null`.
- contract تمام dictionaryها، fallback زبان/کلید، vars گمشده و unknown language.
- بیش از ۵۰ رکورد با bannedهای ابتدای جدول، tie-break و یکسانی top/myRank.
- HMAC canonical، duplicate key، JSON خراب، id معتبر، auth_date قدیمی/آینده/مرزی، replay و env خارج بازه.
- CORS OPTIONS با Authorization، origin مجاز/غیرمجاز، admin private/group و callback chat متفاوت.

### API، webhook و observability

- Express واقعی برای AppError، malformed JSON، unknown error، CORS و Mongo unavailable.
- correlation requestId در response و structured log و sanitization secret/token.
- metrics برای finish/close/abort، 4xx/5xx، inflight و latency histogram.
- webhook new/duplicate completed/processing/failed، lease expiry و retry پس از 500.
- async rejection در route، `router.use`، auth middleware و param handler.
- matrix status/code برای duplicate، expired، invalid، unavailable و rate-limit.

### مالی، داده و migration

- هم‌زمانی check-in/exchange/withdrawal/deposit/swap/VIP؛ فقط یک balance delta و ledger row.
- rollback عمدی قبل/بعد از balance و ledger؛ crash/recovery idempotency و hash mismatch.
- provider tx duplicate، مبلغ/مبدأ/reference ناهماهنگ، timeout، زیر حداقل و approval هم‌زمان.
- unique/index واقعی، normalized tx hash، sourceId/transactionId، relationship و TaskCompletion.
- property test quantization، نرخ صفر/بزرگ، non-finite، negative balance و round-trip point/GRAM.
- migration missing parent، cycle، concurrent write، rerun، partial failure و post-apply counts.
- explain/performance برای `/points/me`، history، public-history و admin account.

## ۸. مواردی که فقط با پیکربندی یا زیرساخت بیرونی حل می‌شوند

این موارد با تغییر کد به‌تنهایی تضمین نمی‌شوند و نیازمند تصمیم/منبع بیرونی‌اند:

- اضافه‌کردن Render Cron Job، Cloud Scheduler، GitHub Actions یا worker پایدار و تنظیم credential، health check و restart policy.
- پیکربندی distributed lock storage، replica set واقعی Mongo، indexهای production و تأیید وجود unique indexهای ledger.
- راه‌اندازی metrics/log backend مانند Prometheus/OpenTelemetry-compatible collector، alerting، dashboard و retention؛ حافظه process-local برای عملیات production کافی نیست.
- backup، encryption، retention، restore drill، RPO/RTO، disaster recovery و runbook مالک‌دار.
- کنترل Telegram bot permissions، webhook secret، provider quota/credit، blocked users و سیاست ارسال/تلاش مجدد؛ کد فقط رفتار را مدیریت می‌کند.
- pin نسخه Node در build/runtime، `npm ci` و dependency audit در CI/CD و staging smoke environment.
- maintenance window/write freeze یا lock عملیاتی برای migrationهای داده و دسترسی به snapshot قبل از migration.
- تعریف سیاست محصول برای expiry pending، سطح commission، رفتار ورود مجدد، timezone canonical، semantics banned/restricted و retention داده؛ بدون این تصمیم‌ها constraint درست قابل انتخاب نیست.

## ۹. محدودیت‌های شواهد و نتیجه نهایی

این گزارش بر یافته‌های خواندنی ارائه‌شده استوار است. در مسیرهای متعارف `tests/`، `test/` و `__tests__/` برای برخی حوزه‌ها تست مرتبط پیدا نشد، اما نبود تست در کل مخزن ادعا نمی‌شود. وجود unique index در `PointsLedger`، retry داخلی `sendNotificationOnce`، reclaim دقیق `claimWebhookUpdate` و فعال‌بودن برخی مسیرهای مشروط از فایل‌های بررسی‌شده اثبات نشده است. همچنین هیچ رخداد production، exploit فعال، crash، outage یا ناسازگاری واقعی داده ادعا نمی‌شود مگر جایی که نقص در کد مستقیماً قابل مشاهده بوده است.

نتیجه ممیزی این است که GramUp کنترل‌های مثبت مهمی دارد، اما برای ادعای آمادگی production در referral، notification، scheduler، admin security، مالی و عملیات، ابتدا باید R-01، R-07/R-08، R-23، R-24/R-25 و R-31/R-32 برطرف و سپس با تست‌های concurrency، recovery و integration اثبات شوند. تا آن زمان، وضعیت مناسب محصول «دارای کنترل‌های پایه اما نیازمند اصلاح و hardening پیش از اتکای کامل عملیاتی» است.

## ۸. اصلاحات پیاده‌سازی‌شده پس از ممیزی

این بخش پس از audit-only و اجرای تغییرات اصلاحی تکمیل شده است:

- لینک‌های Mini App referral اکنون با HMAC امضا می‌شوند و شناسهٔ عددی خام دیگر به‌عنوان referral پذیرفته نمی‌شود.
- پس از تأیید Contact معتبر، pending referral تکمیل و فقط پس از موفقیت مصرف می‌شود؛ مسیر شکست، pending را برای retry نگه می‌دارد.
- پیام referral اولیه شامل نام/نام‌کاربری، پاداش اولیه، Level 1، نرخ ۱۰٪ کمیسیون و timestamp در `Asia/Kabul` است.
- اعلان‌های Telegram در صورت exception دیگر در وضعیت `sending` گیر نمی‌کنند و lease قدیمی قابل reclaim است.
- اعلان leaderboard اکنون `weekKey` را به template می‌دهد و pipeline رتبه‌بندی bannedها را پیش از limit حذف می‌کند.
- CORS هدر `Authorization` را برای mobile auth مجاز می‌کند و عملیات admin در webhook فقط از private chat پذیرفته می‌شود.
- `utils/verifyTelegram.js` به validator canonical پروژه متصل شد تا از HMAC، max-age و کنترل‌های مرکزی استفاده کند.
- scheduler یادآوری پس از startup اجرای catch-up دارد تا از دست‌رفتن پنجرهٔ `04:00 UTC` در restart یا sleep جلوگیری شود؛ lock و marker روزانه همچنان idempotency را حفظ می‌کنند.

## ۹. اعتبارسنجی پس از اصلاحات

- تمام فایل‌های تغییرکرده syntax-check شدند.
- تست‌های referral، webhook، scheduler و notification اجرا شدند.
- کل suite پروژه با `npm test` موفق شد (`TEST_STATUS:0`).
- هیچ migration مالی یا تغییر موجودی کاربران در این مرحله اجرا نشد.
