# گزارش تست کامل سناریوهای ربات تلگرام Gramup

**تاریخ گزارش:** ۱۷ نوامبر ۲۰۲۶
**شاخه تست:** `english-payout-fix`
**وضعیت remote در زمان تست:** `origin/main` روی commit `2c2249d`
**محیط:** تست محلی و mock/synthetic؛ بدون استفاده از توکن واقعی، کاربران واقعی، کیف پول واقعی یا دیتابیس Production.

## خلاصه اجرایی

آخرین اجرای `npm test` با کد خروجی `0` کامل شد و عبارت `REFERRAL_MESSAGE_VALIDATION=PASS` ثبت گردید. در مجموع **۱۲۱ فایل تست** اجرا شد که **۳۸ فایل** مستقیماً به Telegram، احراز هویت، Webhook، اعلان‌ها، Referral، عضویت کانال، Broadcast، Health یا دسترسی phone-free مربوط بودند.

نتیجه تست‌های خودکار: **PASS**.
نتیجه تست زنده با Telegram Production: **NOT TESTED**؛ این suite از mock و داده synthetic استفاده می‌کند و به Telegram واقعی پیام ارسال نمی‌کند.

## ماتریس سناریوها

| حوزه | سناریو | نتیجه | شواهد تست |
|---|---|---:|---|
| احراز هویت | Telegram initData معتبر با HMAC و header امضاشده | PASS | `telegramInitDataAuth.test.js` |
| احراز هویت | initData در query string به‌جای header | PASS — رد می‌شود | `telegramInitDataAuth.test.js` |
| احراز هویت | start_param داخل initData امضاشده | PASS | `telegramInitDataAuth.test.js` |
| احراز هویت | ورود هم‌زمان چند درخواست برای کاربر جدید | PASS | `telegramAuthConcurrency.test.js` |
| احراز هویت | جلوگیری از خطای 500 در duplicate-key هم‌زمان | PASS | `telegramAuthConcurrency.test.js` |
| دسترسی | ثبت‌نام و استفاده بدون شماره تلفن | PASS | `phoneFreeAccess.test.js`, `phoneFreeUi.test.js` |
| دسترسی | contact update یا contact prompt قدیمی | PASS — نادیده گرفته می‌شود | `telegramWebhookStart.integration.test.js` |
| `/start` | `/start` بدون payload | PASS | `telegramStart.test.js` |
| `/start` | `/start <payload>` و `/start@Bot <payload>` | PASS | `telegramStart.test.js` |
| `/start` | payload نامعتبر یا متن اضافی | PASS — رد می‌شود | `telegramStart.test.js` |
| `/start` | کاربر جدید و پیام خوش‌آمدگویی | PASS | `telegramStart.test.js`, `telegramWebhookStart.integration.test.js` |
| `/start` | کاربر قدیمی بدون تغییر referral قبلی | PASS | `telegramStart.test.js` |
| `/start` | تکرار همان `/start` و جلوگیری از پاداش تکراری | PASS | `telegramStart.test.js` |
| Webhook | secret معتبر | PASS | `telegramWebhookStart.integration.test.js` |
| Webhook | secret نامعتبر | PASS — HTTP 401 | `telegramWebhookStart.integration.test.js` |
| Webhook | نبود secret در production configuration | PASS — fail closed، HTTP 503 | `telegramWebhookStart.integration.test.js` |
| Webhook | تلاش GET برای bootstrap/set-webhook | PASS — مسدود می‌شود | `telegramWebhookStart.integration.test.js` |
| Webhook | duplicate update و durable delivery state | PASS | `telegramWebhookStart.integration.test.js` |
| Webhook | خطای دائمی chat-not-found | PASS — درخواست acknowledge می‌شود و retry بی‌نهایت ندارد | `telegramWebhookStart.integration.test.js` |
| Referral | لینک مستقیم Mini App با `?startapp=<TELEGRAM_ID>` | PASS | `referralIdentifier.test.js`, `directMiniAppReferral.test.js` |
| Referral | پشتیبانی از signed legacy link | PASS | `referralIdentifier.test.js` |
| Referral | self-referral، identifier مخرب و query نامعتبر | PASS — رد می‌شود | `referralIdentifier.test.js` |
| Referral | پاداش اولیه فقط یک‌بار | PASS | `referralInitialReward.test.js`, `productionRetention.test.js` |
| Referral | چهار درخواست هم‌زمان برای یک referral | PASS — یک پاداش و یک ledger | `productionReplicaSet.integration.js`, `productionRetention.test.js` |
| Referral | اعلان referral فقط هنگام ثبت عضو جدید | PASS | `referralInitialReward.test.js` |
| Referral | عدم ارسال اعلان برای کمیسیون‌های مستمر | PASS | `referralCommissionStage2.test.js` |
| Referral | consent برابر unset یا denied | PASS — اعلان ارسال نمی‌شود | `referralInitialReward.test.js` |
| Referral | متن چندزبانه و پاراگراف‌بندی‌شده referral | PASS | `referralWelcomeDetails.test.js` |
| Referral | پایداری outbox، retry و جلوگیری از retry payloadهای قدیمی | PASS | `referralNotificationDurability.test.js` |
| Referral | دکمه Invite Friends و نگهداری reply markup در retry | PASS در regression/source contract | `referralNotificationDurability.test.js` + اجرای کامل suite |
| اعلان | خطای sync هنگام ارسال Telegram | PASS — فرآیند اصلی متوقف نمی‌شود | `telegramNotificationIsolation.test.js` |
| اعلان | Promise rejection، timeout و پاسخ malformed | PASS — ایزوله می‌شود | `telegramNotificationIsolation.test.js` |
| اعلان | کاربر bot-blocked یا 403 | PASS — تشخیص داده می‌شود | `telegramBlocked.test.js` |
| اعلان | کاربر chat-not-found | PASS — قابلیت علامت‌گذاری blocked | `telegramBotBroadcastRecipients.test.js` |
| اعلان | timeout ارسال و deadline | PASS | `telegramNotificationIsolation.test.js` |
| Broadcast | انتخاب فقط Telegram ID معتبر و کاربران فعال | PASS | `telegramBotBroadcastRecipients.test.js` |
| Broadcast | FloodWait / HTTP 429 و retry محدود | PASS | `telegramBroadcastDelivery.test.js` |
| Broadcast | کاربر blocked، failed و sent در یک batch | PASS | `telegramBroadcastDelivery.test.js` |
| Broadcast | sanitize کردن HTML و جلوگیری از URL مخرب | PASS | `telegramBroadcastDelivery.test.js` |
| Broadcast | دکمه URL/WebApp در پیام متنی و تصویری | PASS | `telegramBroadcastDelivery.test.js` |
| Broadcast | قالب‌بندی پیام‌های Admin | PASS | `adminBroadcastFormatting.test.js`, `adminNotification.test.js` |
| عضویت | موفقیت بررسی عضویت کانال | PASS | `membership.test.js` |
| عضویت | عضو نبودن کاربر | PASS — 403 در gate | `membership.test.js`, `taskMembershipFailure.test.js` |
| عضویت | خطای موقت Telegram API | PASS — 503/retry-safe | `membership.test.js`, `taskMembershipFailure.test.js` |
| عضویت | `withMembership`: ابتدا auth و سپس membership | PASS | `membership.test.js` |
| تسک رسمی | Start Official Bot و activation hook | PASS | `officialBotTask.test.js` |
| تسک رسمی | verify_chat، reset کردن blocked state و پاداش یک‌باره | PASS | `officialBotTask.test.js` |
| اعلان روزانه | reminder، consent، deduplication و failure isolation | PASS | `dailyCheckinNotification.test.js`, `productionRetention.test.js` |
| اعلان کمپین | ارسال ترتیبی پیام در هر سه زبان | PASS | `weeklyCampaignNotification.test.js` |
| Health | `/healthz` و `/readyz` | PASS | `productionHealth.test.js`, `productionReplicaSet.integration.js` |
| API امنیتی | درخواست بدون auth برای API خصوصی | PASS — 401 | `productionReplicaSet.integration.js` |
| API امنیتی | درخواست unsigned برای task/profile | PASS — 401 | `productionReplicaSet.integration.js` |

## سناریوهای خطا و تاب‌آوری

تست‌ها نشان دادند که خطاهای ارسال پیام Telegram باعث توقف ثبت‌نام، bootstrap، ledger یا جریان‌های اصلی نمی‌شوند. خطاهای شبکه، timeout، پاسخ نامعتبر، 403، chat-not-found و FloodWait به‌صورت جداگانه مدیریت شده‌اند.

در Broadcast، ارسال‌ها در برابر خطای یک گیرنده متوقف نمی‌شوند؛ گیرنده‌های موفق، ناموفق و blocked جداگانه شمرده می‌شوند. برای FloodWait نیز retry محدود با تأخیر انجام می‌شود و retry بی‌نهایت وجود ندارد.

در `/start` و bootstrap، شکست ارسال خوش‌آمدگویی باعث fail شدن ثبت‌نام یا پاسخ HTTP اصلی نمی‌شود. این مورد با تست failure و late rejection تأیید شده است.

## سناریوهای مالی و Referral

در تست‌های synthetic، پاداش referral اولیه، پاداش کاربر دعوت‌شده، ledger و idempotency بررسی شده‌اند. چهار درخواست هم‌زمان برای یک رابطه تنها یک پاداش اولیه و یک رکورد ledger تولید می‌کنند.

کمیسیون‌های مستمر referral همچنان credit و ledger می‌شوند، اما اعلان Telegram جداگانه برای آن‌ها ارسال نمی‌شود. این رفتار عمداً برای جلوگیری از spam حفظ شده است.

هیچ تستی در این گزارش عملیات واقعی برداشت، واریز، خرید، claim واقعی یا TON transaction انجام نداده است.

## مواردی که واقعاً تست زنده نشده‌اند

موارد زیر در این محیط به‌صورت live با Telegram یا Production اجرا نشده‌اند و نباید به‌عنوان تأیید عملیاتی تلقی شوند:

1. دریافت update از Telegram Production با Bot Token واقعی.
2. نمایش واقعی دکمه Invite Friends در کلاینت Telegram Android یا iOS.
3. بررسی زنده `getChatMember` روی کانال واقعی.
4. ارسال Broadcast واقعی به کاربران.
5. تأیید واقعی `allows_write_to_pm` در حساب‌های Telegram.
6. تست با دیتابیس Production یا کاربران واقعی.
7. تست Webhook عمومی روی HTTPS واقعی Render.
8. تست latency و rate limit واقعی Telegram در مقیاس production.

## هشدار تست محیطی

در خروجی suite چند پیام آزمایشی مانند `Telegram API unavailable` و `getChatMember failed` دیده شد، اما این‌ها بخشی از fixtureهای خطا هستند و باعث شکست تست نشدند. این پیام‌ها نشان می‌دهند مسیر fail-safe فعال است؛ آن‌ها نشانه‌ی خرابی Production نیستند.

همچنین پیام `Sensitive shared rate limiter unavailable: offline store unavailable` مربوط به نبود store مشترک در محیط تست محلی است. تست امنیتی در این حالت fail-closed را تأیید کرده است؛ برای Production باید Redis یا store مشترک مطابق تنظیمات واقعی بررسی شود.

## وضعیت Git و انتشار

این گزارش فقط گزارش تست است. در زمان تهیه گزارش، تغییرات اخیر مربوط به پیام referral و reply markup هنوز در working tree محلی بودند و به Production ارسال نشده بودند. هیچ deployment، migration یا عملیات مالی انجام نشد.

## نتیجه نهایی

- **Regression خودکار:** PASS
- **سناریوهای Telegram/Auth/Webhook:** PASS در محیط mock/synthetic
- **مدیریت خطا و ادامه فرآیند:** PASS
- **Referral و جلوگیری از duplicate reward:** PASS
- **اعلان‌های چندزبانه و outbox retry:** PASS
- **تست زنده Telegram Production:** NOT TESTED
- **آمادگی برای انتشار بر اساس تست محلی:** نیازمند بررسی دستی secret، webhook HTTPS، BotFather configuration و یک تست کنترل‌شده با حساب آزمایشی Telegram است.

**نتیجه عملیاتی:** کد در تست‌های محلی پایدار است، اما بدون تست HTTPS staging و Telegram test bot نمی‌توان پایداری end-to-end در Production را ادعا کرد.
