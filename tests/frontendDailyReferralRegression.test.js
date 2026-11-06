'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
const i18n = fs.readFileSync(path.join(root, 'public/js/i18n.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');

function aggregateReferralBuckets(networkLevels, configuredRates) {
  const buckets = [
    { key: '1', min: 1, max: 1 },
    { key: '2', min: 2, max: 2 },
    { key: '3', min: 3, max: 3 },
    { key: '4plus', min: 4, max: Infinity }
  ];
  return buckets.map(bucket => {
    const rows = networkLevels.filter(row => row.level >= bucket.min && row.level <= bucket.max);
    const rates = (bucket.key === '4plus' ? configuredRates.slice(3) : [configuredRates[bucket.min - 1]])
      .filter(Number.isFinite);
    return {
      key: bucket.key,
      members: rows.reduce((sum, row) => sum + row.members, 0),
      active: rows.reduce((sum, row) => sum + row.activeMembers, 0),
      earned: rows.reduce((sum, row) => sum + row.commissionPoints, 0),
      rates
    };
  });
}

// F01: a Home-originated check-in must not unconditionally render Tasks, and the
// accepted POST must be followed by a forced read-model refresh.
assert.match(app, /function rerenderActiveUserDataView\(\)/);
assert.match(app, /await loadUserData\(\{ force: true \}\);/);
assert.match(app, /rerenderActiveUserDataView\(\);\s*try \{\s*await loadUserData/s);
const checkInBody = app.slice(app.indexOf('async function doCheckIn'), app.indexOf('window.doCheckIn'));
assert.doesNotMatch(checkInBody, /renderTasks\(\)/);
assert.match(checkInBody, /error\?\.code === "ALREADY_CHECKED_IN"[\s\S]*?loadUserData\(\{ force: true \}\)/);

// Return/focus refresh is bounded and read-only; no new polling interval is introduced.
assert.match(app, /lastUserDataReturnRefreshAt/);
assert.match(app, /window\.addEventListener\("focus"/);
assert.match(app, /window\.addEventListener\("pageshow"/);
assert.match(app, /now - lastUserDataReturnRefreshAt < CLIENT_DATA_TTL_MS/);
assert.doesNotMatch(app, /userDataReturnRefresh.*setInterval/);

// F02: levels 4, 5, ... are aggregated together and all configured downstream
// rates are retained for the displayed 4+ policy rather than using a 2% literal.
const fixture = aggregateReferralBuckets([
  { level: 4, members: 2, activeMembers: 1, commissionPoints: 7 },
  { level: 5, members: 3, activeMembers: 2, commissionPoints: 11 },
  { level: 6, members: 1, activeMembers: 1, commissionPoints: 5 }
], [10, 5, 3, 2, 1, 0.5]);
assert.deepStrictEqual(fixture[3], {
  key: '4plus', members: 6, active: 4, earned: 23, rates: [2, 1, 0.5]
});
assert.match(app, /key: "4plus"[\s\S]*?max: Infinity/);
assert.match(app, /configuredRates\.slice\(3\)/);
assert.match(app, /rateLabel/);
assert.doesNotMatch(app, /bucket\.key === "4plus" \? 2/);

// F03: reward copy comes from the server-populated state and has an explicit
// unconfigured fallback instead of silently advertising ten points.
assert.match(app, /referralInitialRewardPoints: 0/);
assert.match(app, /const rewardPoints = Number\(state\.referralInitialRewardPoints\)/);
assert.match(app, /referral_reward_unconfigured/);
assert.doesNotMatch(app, /const rewardPoints = 10/);

// F06: both level badge sinks escape server-controlled values.
assert.strictEqual((app.match(/escapeHTML\(level\.badge\)/g) || []).length, 2);

// F07: notification aria text, wallet copy, and translation parity are wired.
assert.match(index, /data-i18n-aria="notifications"/);
assert.match(app, /t\("wallet_connect_required"\)/);
assert.match(app, /t\("wallet_exchange_success"/);
assert.match(app, /t\('deposit_network_ton_mainnet'\)/);
assert.match(i18n, /streak_label: "اوسنۍ پرله‌پسې ورځې — د پرله‌پسې ورځو په ساتلو سره نور پوائنټونه ترلاسه کړئ"/);
assert.match(i18n, /deposit_copy_empty: "د کاپي لپاره هېڅ شی نشته\."/);

const context = { console, window: {}, globalThis: null };
context.globalThis = context;
vm.runInNewContext(`${i18n}\nglobalThis.__translations = TRANSLATIONS;`, context);
const dictionaries = context.__translations;
assert.deepStrictEqual(Object.keys(dictionaries.fa).sort(), Object.keys(dictionaries.ps).sort());
assert.deepStrictEqual(Object.keys(dictionaries.fa).sort(), Object.keys(dictionaries.en).sort());
for (const key of ['notifications', 'wallet_connect_required', 'wallet_connection_unavailable', 'wallet_exchange_success', 'referral_reward_unconfigured']) {
  assert.ok(dictionaries.fa[key] && dictionaries.ps[key] && dictionaries.en[key], `missing translation key: ${key}`);
}
assert.strictEqual(dictionaries.ps.deposit_copy_success, 'کاپي شو.');
assert.strictEqual(dictionaries.ps.deposit_pending_amount, 'د تایید په تمه');

console.log('ALL PASS — frontend daily/referral regression contracts');
