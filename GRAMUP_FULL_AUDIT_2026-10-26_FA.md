# گزارش ممیزی و بهسازی Gramup

**تاریخ:** ۲۶ اکتبر ۲۰۲۶
**دامنه:** ممیزی منبع‌محور چندحوزه‌ای روی سرور، احراز هویت، مسیرهای مالی، پاداش‌ها، وب‌هوک‌ها، پنل مدیریت، مینی‌اپ، آزمون‌ها و وابستگی‌ها
**وضعیت:** اصلاحات این مرحله در working tree محلی هستند؛ commit یا production deploy انجام نشده است.

## خلاصهٔ اجرایی

ممیزی مستقل هفت حوزهٔ فنی انجام شد. تست‌های پایهٔ پروژه در شروع کار موفق بودند. در بررسی source و مسیرهای حساس، چند نقص قابل‌تکرار در پذیرش تراکنش TON، استفاده از شناسه‌های API در inline JavaScript، هم‌خوانی وضعیت maintenance، رتبه‌بندی leaderboard، handling امن initData و دسترس‌پذیری انتخاب زبان پیدا و اصلاح شد. همچنین میانگین زمان پاسخ در metrics اصلاح شد تا درخواست‌های هنوز تمام‌نشده میانگین را به‌طور مصنوعی پایین نیاورند.

دو وابستگی با advisory قابل‌رفع، بدون تغییر major و فقط از طریق lockfile ارتقا یافتند. با وجود این، ممیزی به معنی تضمین «بدون نقص» یا تأیید عملکرد live نیست: دو advisory سطح High در زنجیرهٔ TON باقی است، finality تراکنش TON هنوز نیازمند بررسی مستندات provider است، و بازیابی اعلان‌ها/ارسال‌های همگانی بعد از crash باید جداگانه طراحی و آزموده شود.

## یافته‌های اصلاح‌شده

### ۱. اعتبارسنجی پرداخت TON

در `utils/tonVerify.js` اگر TonCenter تراکنش را صریحاً `aborted: true` می‌گزارش‌کرد، verifier قبلاً فقط وضعیت compute/action را بررسی می‌کرد و چنین تراکنشی می‌توانست به مسیر تأیید پرداخت برسد. اکنون وضعیت صریح aborted رد می‌شود و آزمون رگرسیون اضافه شده است.

**محدودیت باقی‌مانده:** این اصلاح فقط جلوی تراکنش صریحاً abort‌شده را می‌گیرد. شرط masterchain inclusion/finality در مسیر پرداخت هنوز اضافه نشده، چون semantics پاسخ provider و معنای قطعی فیلدهای finality باید پیش از تغییر معیار مالی تأیید شود. بنابراین این بخش نیازمند مرحلهٔ مالی جداگانه و fixtureهای واقعی/مستند است.

### ۲. شناسه‌های API در markup و inline handlers

در `public/js/app.js` شناسه‌های task، referral، VIP و withdrawal از پاسخ API در `onclick`/`onchange` یا selector داینامیک استفاده می‌شدند. eventها اکنون از handlerهای delegated و `data-*`های HTML-escaped خوانده می‌شوند؛ جست‌وجوی عنصر با مقایسهٔ مقدار dataset انجام می‌شود، نه ساخت selector با مقدار خام، و شناسه در pathهای API encode می‌شود. آزمون source-contract جدید، نبودن inline handlerهای حساس را بررسی می‌کند.

### ۳. نگهبان maintenance

`GET /api/maintenance/access` و bootstrap مسیر `/api/auth/me` اکنون از `getMaintenanceState()` واحد استفاده می‌کنند. بنابراین تنظیم maintenance ذخیره‌شده برای TEST نباید در production به‌صورت متناقض public gate یا bootstrap را مسدود کند. همچنین initData از query string دیگر برای این gate پذیرفته نمی‌شود. آزمون route-level برای حالت production با تنظیم ذخیره‌شدهٔ روشن و query-only credential اضافه شد.

### ۴. حفاظت از credential تلگرام

در middleware اصلی Telegram، `initData` از query string خوانده نمی‌شود؛ header اختصاصی `X-Telegram-Init-Data` و body برای مسیرهای سازگار باقی مانده‌اند. همهٔ استفاده‌های داخلی Mini App که بررسی شد header را می‌فرستند. آزمون با HMAC معتبر نشان می‌دهد query رد و header پذیرفته می‌شود.

### ۵. رتبه‌بندی leaderboard

در API هفتگی، حساب‌های banned قبلاً بعد از sort/limit حذف می‌شدند و در محاسبهٔ rank بالاتر نیز شمرده می‌شدند. اکنون lookup و فیلتر حساب‌های eligible قبل از sort/top-50 و پیش از شمارش rank قرار دارد؛ ترتیب tie-break با settlement (`points` نزولی، سپس `_id` صعودی) حفظ شده است. مسیر settlement دست‌کاری نشده است.

### ۶. دسترس‌پذیری زبان

گزینه‌های زبان در `public/index.html` از `div` کلیک‌پذیر به `<button type="button">` تبدیل شدند؛ سبک دکمه‌ها حفظ و focus قابل‌مشاهده برای صفحه‌کلید اضافه شد.

### ۷. دقت metrics

`utils/metrics.js` میانگین latency را قبلاً بر تعداد درخواست‌های شروع‌شده تقسیم می‌کرد، حتی وقتی برخی هنوز کامل نشده بودند. اکنون تعداد درخواست‌های کامل‌شده جداگانه ثبت و در مخرج میانگین استفاده می‌شود. آزمون، وضعیت in-flight و پایان درخواست را بررسی می‌کند.

### ۸. وابستگی‌ها

بررسی read-only با `npm audit --omit=dev` در ابتدا چهار advisory سطح High نشان داد. به‌روزرسانی semver-compatible، `multer` را به `2.5.0` و `body-parser` را به `1.20.9` در lockfile رساند. `package.json` برای این تغییر نسخه‌ای عوض نشده است.

پس از اصلاح، دو advisory High باقی است:

- `@ton/ton` به‌علت dependency روی `zod` آسیب‌پذیر گزارش می‌شود.
- نسخهٔ فعلی `zod` (`3.25.76`) در محدودهٔ advisory حافظه قرار دارد.

npm برای این زنجیره fix خودکار ارائه نمی‌دهد. override کردن Zod به major 4 یا تغییر TON SDK بدون آزمون سازگاری می‌تواند مسیرهای کیف پول/تأیید زنجیره را خراب کند؛ این کار در این مرحله انجام نشد.

## سرنخ‌های تأییدشده اما عمداً دست‌نخورده

- `utils/notificationDelivery.js` وضعیت `sending` را با lease/recovery قابل‌بازیابی نمی‌کند و `sending`/`unknown` را خودکار دوباره ارسال نمی‌کند. اگر process در پنجرهٔ ارسال crash کند، notification ممکن است در حالت نامشخص بماند. retry خودکار هم می‌تواند پیام تکراری بسازد؛ سیاست at-most-once فعلی باید پیش از تغییر، با نیاز محصول روشن شود.
- ارسال پنل مدیریت در `routes/admin.js` در process حافظه‌ای همان درخواست اجرا می‌شود. اگر سرور restart شود، job ذخیره‌شده می‌تواند `running` بماند، ولی worker مستقل/صف durable و checkpoint گیرنده برای resume وجود ندارد. تغییر آن نیازمند طراحی صف و جلوگیری از ارسال تکراری به هزاران کاربر است.
- `utils/webhookDedup.js` processing را پس از ۱۰ دقیقه stale قابل reclaim می‌داند. token جلوی تکمیل‌شدن رکورد توسط worker قدیمی را می‌گیرد، ولی به‌تنهایی اثر جانبی handler قدیمی را متوقف نمی‌کند. سناریوی handler واقعاً بیش از ۱۰ دقیقه باید با رفتارهای واقعی ارزیابی شود؛ تغییر lease یا fencing بدون بررسی می‌تواند webhookها را گم یا دوباره اجرا کند.

این موارد در این نوبت تغییر داده نشدند، چون بدون سیاست retry، صف durable و تحلیل side-effectها، اصلاح ظاهراً ساده می‌تواند اعلان/وب‌هوک تکراری یا گم‌شده ایجاد کند.

## اعتبارسنجی انجام‌شده

- `npm test`: موفق؛ تمام **۶۲ فایل آزمون** اجرا شدند.
- `node --check` روی فایل‌های JavaScript در `routes`, `utils`, `models`, `scripts`, `public/js` و `tests`: موفق.
- `git diff --check`: موفق.
- آزمون‌های جدید/اصلاح‌شده: پرداخت abort‌شدهٔ TON، maintenance route در production، رد query initData، امن‌بودن handlerهای frontend، ranking هفتگی و metrics in-flight.
- `npm audit --omit=dev`: پس از به‌روزرسانی قفل، ۲ High باقی مانده؛ هر دو در زنجیرهٔ `@ton/ton → zod` و بدون fix خودکار.

تست‌های پروژه عمدتاً unit، mock و source-contract هستند. در این نوبت MongoDB تولید، تراکنش‌های واقعی، Bot API زنده، provider واقعی TON، Telegram WebView واقعی، screen reader یا browser automation اجرا نشد.

## محدودیت مربوط به خطای عضویت در کانال

خطای نمایش‌داده‌شده در تصویر قبلی («Unable to verify membership right now») با ممیزی source به‌تنهایی به علت قطعی نرسید. بررسی پیشین endpoint عمومی فقط وجود یک required channel فعال را نشان داد. برای تشخیص قطعی باید خطای همان زمان در Render logs، `chat_id` فعال و دسترسی bot به کانال (حداقل وضعیت لازم برای `getChatMember`) در محیط production بررسی شود. در این مرحله هیچ تنظیم production یا دسترسی کانال تغییر نکرد.

## تغییرات قبلی که دست‌نخورده ماندند

در شروع ممیزی، working tree شامل تغییرات محلی مرتبط با پاداش تسک Bio بود. این موارد نه پاک و نه به commit ممیزی اضافه شدند: `package.json`, `public/js/i18n.js`, `routes/admin.js`, `routes/tasks.js`, `tests/bioLinkTask.test.js`, `utils/bioLinkTask.js`, `scripts/update-bio-latest-task-rewards.js`, `tests/taskRewardMigration.test.js`, `utils/taskRewardMigration.js`.

## فایل‌های تغییر‌یافته در این ممیزی

`utils/tonVerify.js`, `tests/tonPayoutVerification.test.js`, `routes/maintenance.js`, `routes/auth.js`, `utils/telegramAuth.js`, `routes/leaderboard.js`, `public/js/app.js`, `public/index.html`, `public/css/style.css`, `utils/metrics.js`, `tests/opsMetrics.test.js`, `package-lock.json`، به‌علاوه آزمون‌های جدید `tests/maintenanceAccess.test.js`, `tests/telegramInitDataAuth.test.js`, `tests/weeklyLeaderboardRoute.test.js`, `tests/frontendIdentifierSafety.test.js`.

## وضعیت تحویل

کد و گزارش در working tree محلی هستند. هیچ migration دیتابیس اجرا نشده، هیچ تنظیم production تغییر نکرده، و هیچ commit یا deploy انجام نشده است. پیش از production deploy توصیه می‌شود: (۱) تصمیم‌گیری و رفع زنجیرهٔ `@ton/ton`/Zod با آزمون کیف پول، (۲) بررسی provider finality برای پرداخت، و (۳) طراحی durable worker برای اعلان‌ها/ارسال همگانی انجام شود.
