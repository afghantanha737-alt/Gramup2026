# Gramup Full-Stack Audit & Hardening Report

**Date:** 2026-11-08
**Audit mode:** Static source review plus isolated/unit regression tests. No production database, Telegram API, Render instance, user balances, or production records were accessed or changed.

## Executive summary

The review found reliability issues in Admin Panel broadcasts, optional work on the Mini-App startup path, Telegram membership verification error handling, recurring bio-link task capacity enforcement, and error feedback in user/admin screens. Targeted fixes were implemented and the focused tests and syntax checks passed.

This is not a claim that the system is now “100% reliable.” The full test suite still has 10 known failures in older tests that rely on stale source contracts, old exports, or existing palette assumptions. `npm audit` still reports two high-severity advisories in `zod` pulled by `@ton/ton`; the audit service reports no compatible automatic fix. Long-running broadcast recovery, full route-by-route production behavior, MongoDB query plans/indexes, CDN compression, and real production recipient counts remain to be verified.

## Implemented fixes

### Admin and Telegram broadcasts

- The Admin Panel now validates stored Telegram IDs and filters banned/blocked records before setting the eligible-recipient total.
- The Admin Panel now delegates to the shared delivery helper instead of maintaining a second, divergent sender. This uses per-recipient pacing and retries one Telegram `retry_after` / FloodWait response.
- Broadcast status now reports `blocked` separately from other `failed` deliveries; pending is derived from all terminal counts. The panel displays delivered, blocked/unreachable, failed, and pending counts.
- Progress persistence is checkpointed every 25 recipients to reduce database writes while still reporting the final recipient.
- Telegram-bot copy broadcasts now validate recipient IDs and make one bounded retry after a Telegram FloodWait.

**Still open:** worker execution remains an in-process detached task; a process restart can strand a `running` broadcast. There is no durable per-recipient checkpoint or automatic recovery/resume. The bot copy path sends small parallel batches and does not yet share the Admin sender’s single-recipient pacing model. No production dry-run/audience preview endpoint was added. The reported `2,000+` versus `119–200` audience discrepancy cannot be diagnosed without the Admin audit counts or production data; do not infer its root cause from source alone.

### Mini-App startup performance

- Core scripts use `defer` and app assets received an updated cache key.
- The TON Connect UI CDN is no longer loaded as a static startup dependency. The Wallet Connect module loads the SDK on demand when Wallet initialization occurs, with a bounded timeout and retryable error state.
- Wallet initialization no longer blocks app boot; it is started when the Wallet tab is rendered.
- Referral data no longer loads synchronously along with ordinary Home/Tasks rendering. Home’s referral summary is refreshed in the background after the initial render; referral data also loads when the referral surface is entered.
- `/api/points/me` now fetches global settings and the independent lifetime ledger aggregate concurrently.

**Still open:** no browser performance trace, production response-size measurement, database `explain()` on representative data, index inventory from the deployed database, or Render/CDN compression inspection was available. No compression middleware was added because the deployment may already compress upstream and that could not be verified here.

### Backend task reliability and data integrity

- Generic Telegram `getChatMember` failures are now represented as transient verification outages and return retryable HTTP 503 (`MEMBERSHIP_VERIFY_UNAVAILABLE`); actual nonmembership remains `NOT_JOINED`, and configuration issues remain separate.
- Bio-link claims now apply the shared finite-capacity and expiry predicate both when reading the task inside the transaction and when reserving the completion counter, preventing claims beyond a configured cap.

**Still open:** referral eligibility/count maintenance after successful task claims remains fire-and-forget in a separate transaction. A durable outbox or reliable reconciliation path is preferable, but needs a separate design and operational plan. The audit did not prove a production incident for this path.

### User/Admin UI reliability

- Profile transaction history distinguishes an actual empty result from request failure and offers a retry; a loaded-once flag prevents repeatedly fetching an empty result or automatically looping after a failed request.
- Admin API calls now have a 30-second bound and use existing error display flows if the request stalls.
- Admin Home dashboard request failures replace referral/chart placeholders with a visible retry action rather than leaving them blank or loading.

## Dependency audit

`npm audit` initially identified three high-severity package entries. The safe patch-level transitive fix upgraded `follow-redirects` from `1.16.1` to `1.16.2` in the lockfile. The resulting audit still reports **two high-severity entries**: `zod` and its dependent `@ton/ton` tree. `npm audit` states no compatible automatic fix is available. I did not force a breaking dependency update or change the TON SDK dependency without compatibility validation.

## Verification

Passed: syntax checks for modified backend/frontend JavaScript, extracted Admin Panel inline-script syntax, `git diff --check`, and focused tests for Telegram broadcast delivery/progress/recipient filtering, task membership outages and bio-link capacity, startup cache contracts, wallet lazy-loading behavior, VIP mining/accrual, and existing Admin VIP route behavior.

`npm test` does not pass. It stops at `tests/brandPalette.test.js`; running test files independently reports these 10 remaining failures:

- `tests/brandPalette.test.js` — dark-mode palette expectation does not match current CSS token location/value.
- `tests/missedStreak.test.js` — expects an old `STREAK_FREEZE_COST` source contract.
- `tests/paidSpinPayment.test.js` and `tests/paidSpinResourceId.test.js` — expect old spin implementation source patterns.
- `tests/phase1LuckySpin.test.js`, `tests/phase2LuckySpinOverhaul.test.js`, and `tests/spinRewardPool.test.js` — expect `pointsRoute.spinPolicy` export no longer present.
- `tests/phase2Growth.test.js` — expects `calculateMiningCommissionAmount` export no longer present.
- `tests/phase3Stars.test.js` — expects `parseStarsPayload` export no longer present.
- `tests/referralProfileRedesign.test.js` — expects an older Groups navigation implementation.

These are not attributed to the fixes above; however, the broader suite is not clean and these failures should be triaged rather than ignored.

## Security and operational follow-up

- Telegram `initData` validation accepts signed data up to the configured maximum of 24 hours. Tightening this in isolation could break a Mini-App kept open while it continues sending the same launch `initData`; a safer mitigation is a carefully tested exchange to a short-lived server session with replay controls.
- Admin login inherits the global `/api/admin` rate limit; a stricter login-specific limiter and explicit key-strength enforcement are defense-in-depth improvements.
- Some authenticated account-level mutations rely on IP-based throttling rather than per-user limits; review each operation’s cost, idempotency, and abuse profile before changing limits.
- No current production query plans, index states, deployment headers, environment configuration, or actual database counts were inspected. No data migration was run.

## Files touched

Broadcast: `routes/admin.js`, `utils/bot.js`; related tests: `tests/broadcastReliability.test.js`, `tests/telegramBroadcastDelivery.test.js`, and `tests/telegramBotBroadcastRecipients.test.js`.
Startup and UI: `public/index.html`, `public/js/app.js`, `public/js/walletConnect.js`, `public/admin.html`.
Backend: `routes/points.js`, `routes/tasks.js`.
Regression test added: `tests/taskMembershipFailure.test.js`. Cache-contract tests were updated for the new app/wallet assets.
Dependency patch: `package-lock.json` (`follow-redirects` 1.16.1 → 1.16.2).
