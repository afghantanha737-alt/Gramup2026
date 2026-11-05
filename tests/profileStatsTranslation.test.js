'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

async function main() {
  const root = path.join(__dirname, '..');
  const expectedLabels = {
    fa: 'موجودی قابل استفاده',
    ps: 'د کارولو وړ بیلانس',
    en: 'Available Balance'
  };
  const expectedEarnedLabels = {
    fa: 'کسب‌شده',
    ps: 'ترلاسه شوي',
    en: 'EARNED'
  };

  const context = {
    window: { state: { language: 'fa' } },
    state: {
      language: 'fa', user: null, points: 123.45, gramBalance: 0.807,
      invitedCount: 2, activeInvitedCount: 1, referralDataLoaded: true,
      referralLoading: false, referralError: '', totalEarnedPoints: 456.78, level: null
    },
    profileView: 'menu',
    THEME_REGISTRY: {},
    getTelegramUser: () => ({}),
    getInitials: () => 'A',
    escapeHTML: value => String(value ?? ''),
    formatPoints: value => String(value),
    formatNumber: value => String(value),
    tokenAmount: value => String(value)
  };
  vm.createContext(context);

  const i18n = fs.readFileSync(path.join(root, 'public/js/i18n.js'), 'utf8');
  vm.runInContext(`${i18n}\nglobalThis.__translations = TRANSLATIONS;`, context);
  const app = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');

  const iconStart = app.indexOf('function tokenIconMarkup() {');
  const iconEnd = app.indexOf('\nfunction tokenAmount(', iconStart);
  assert.ok(iconStart >= 0 && iconEnd > iconStart, 'actual UP token icon helper must be present');
  vm.runInContext(app.slice(iconStart, iconEnd), context);
  const tokenLogo = '<img class="upTokenIcon" src="img/gramup-logo-new.png" alt="" aria-hidden="true">';
  assert.strictEqual(vm.runInContext('tokenIconMarkup()', context), tokenLogo,
    'Profile token icon must use the existing PNG logo with an accessible decorative treatment');
  const logoPath = path.join(root, 'public/img/gramup-logo-new.png');
  assert.ok(fs.existsSync(logoPath), 'the Profile UP token logo asset must exist');
  assert.strictEqual(fs.readFileSync(logoPath).subarray(0, 8).toString('hex'), '89504e470d0a1a0a',
    'the Profile UP logo must be a valid PNG, not a broken or misnamed asset');

  const renderStart = app.indexOf('function renderProfileMenu() {');
  const renderEnd = app.indexOf('\nfunction renderProfileAbout()', renderStart);
  assert.ok(renderStart >= 0 && renderEnd > renderStart, 'Profile menu renderer must be present');
  vm.runInContext(app.slice(renderStart, renderEnd), context);

  for (const [language, expectedLabel] of Object.entries(expectedLabels)) {
    context.state.language = language;
    context.window.state.language = language;
    const html = vm.runInContext('renderProfileMenu()', context);
    const stats = html.match(/<section class="profilePulseGrid"[\s\S]*?<\/section>/)?.[0] || '';
    const leftCard = stats.match(/<div><strong>123\.45[\s\S]*?<\/div>/)?.[0] || '';
    const centerCard = stats.match(/<div><strong>2<\/strong>[\s\S]*?<\/div>/)?.[0] || '';
    const rightCard = stats.match(/<div><strong>456\.78[\s\S]*?<\/div>/)?.[0] || '';

    assert.ok(leftCard.includes(`<strong>123.45</strong><small class="profilePulseUnit">${tokenLogo}<span>UP</span></small><span class="profilePulseLabel">${expectedLabel}</span>`),
      `balance card must render amount, one logo/UP badge, then ${expectedLabel} in ${language}`);
    assert.strictEqual((leftCard.match(/<span>UP<\/span>/g) || []).length, 1,
      `balance card must contain exactly one visible UP symbol in ${language}`);
    assert.strictEqual((leftCard.match(/class="upTokenIcon"/g) || []).length, 1,
      `balance card must contain exactly one token logo in ${language}`);
    assert.ok(!leftCard.includes('profilePulseUnit">UP'), 'balance card must not add a second hard-coded UP label');

    assert.ok(centerCard.includes(`<strong>2</strong><span class="profilePulseLabel">${context.__translations[language].referral_kpi_direct}</span>`),
      `center card must contain only the direct-invite count and its label in ${language}`);
    assert.doesNotMatch(centerCard, /profilePulseUnit|upTokenIcon|<span>UP<\/span>/,
      'Direct Invites card must not display a token logo or UP unit');

    assert.ok(rightCard.includes(`<strong>456.78</strong><small class="profilePulseUnit">${tokenLogo}<span>UP</span></small><span class="profilePulseLabel">${expectedEarnedLabels[language]}</span>`),
      `earned card must render amount, one logo/UP badge, then ${expectedEarnedLabels[language]} in ${language}`);
    assert.strictEqual((rightCard.match(/<span>UP<\/span>/g) || []).length, 1,
      `earned card must contain exactly one visible UP symbol in ${language}`);
    assert.strictEqual((rightCard.match(/class="upTokenIcon"/g) || []).length, 1,
      `earned card must contain exactly one token logo in ${language}`);
    assert.ok(!stats.includes('Translation unavailable.'),
      `rendered Profile stats must not show generic missing-translation text in ${language}`);
  }

  context.state.language = 'en';
  context.window.state.language = 'en';
  context.__translations.en.wallet_points_card_title = '';
  let html = vm.runInContext('renderProfileMenu()', context);
  let stats = html.match(/<section class="profilePulseGrid"[\s\S]*?<\/section>/)?.[0] || '';
  assert.ok(stats.includes(`<strong>123.45</strong><small class="profilePulseUnit">${tokenLogo}<span>UP</span></small><span class="profilePulseLabel">Available Balance</span>`),
    'blank locale values must use the clean balance-label fallback without duplicating the UP badge');

  delete context.__translations.en.wallet_points_card_title;
  html = vm.runInContext('renderProfileMenu()', context);
  stats = html.match(/<section class="profilePulseGrid"[\s\S]*?<\/section>/)?.[0] || '';
  assert.ok(stats.includes(`<strong>123.45</strong><small class="profilePulseUnit">${tokenLogo}<span>UP</span></small><span class="profilePulseLabel">Available Balance</span>`),
    'missing locale keys must use the clean balance-label fallback');
  context.__translations.en.wallet_points_card_title = 'Available Balance';

  const css = fs.readFileSync(path.join(root, 'public/css/style.css'), 'utf8');
  assert.match(css, /\.profileOverviewCard\s*\{[^}]*display:\s*grid/,
    'profile header must reserve a distinct grid column for the balance');
  assert.match(css, /\.profileBalanceMini\s*\{[^}]*position:\s*static/,
    'profile balance must not float over the Gold rank badge');
  assert.match(css, /@media \(max-width: 420px\) \{[\s\S]*?\.profileBalanceMini \{[^}]*grid-column: 1 \/ -1/,
    'narrow screens must place the balance on its own row');
  assert.match(css, /\.profilePulseGrid \.profilePulseUnit\s*\{[^}]*display:\s*flex/,
    'the one logo/UP token badge must render as a single aligned row');
  assert.match(css, /\.profilePulseGrid \.profilePulseUnit \.upTokenIcon\s*\{[^}]*width:\s*12px/,
    'the UP logo must have a bounded size in the stats card');
  assert.match(css, /\.profilePulseGrid \.profilePulseLabel\s*\{/,
    'translated descriptive labels must be styled separately from the token badge');

  const indexHtml = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  for (const asset of ['i18n.js', 'app.js', 'maintenanceGate.js', 'readModelCache.js', 'walletConnect.js']) {
    assert.ok(indexHtml.includes(`/js/${asset}?v=up_v16_20261105_1`), `${asset} must use the latest cache-busting version`);
  }
  assert.ok(indexHtml.includes('/css/style.css?v=up_v16_20261105_1'), 'main CSS must use the latest asset version');
  assert.ok(indexHtml.includes('/css/theme-selector.css?v=up_v16_20261105_1'), 'theme CSS must use the latest asset version');

  const referralRoute = fs.readFileSync(path.join(root, 'routes/referral.js'), 'utf8');
  assert.match(referralRoute, /User\.countDocuments\(\{ referredBy: u\._id \}\)/,
    'direct invite count must come from users directly referred by this account');
  assert.match(referralRoute, /invitedCount:\s*totalReferralCount/,
    'the referral API must expose the authoritative direct-invite count');

  context.state.language = 'en';
  context.window.state.language = 'en';
  context.state.activeTab = 'profile';
  context.state.referralDataLoaded = false;
  context.state.referralLoading = false;
  context.state.referralError = '';
  context.state.invitedCount = 0;
  context.profileView = 'menu';
  context.__content = { innerHTML: '' };
  context.$ = () => context.__content;
  context.stopWeeklyCompetitionCountdown = () => {};
  context.stopVipCountdown = () => {};
  context.leaderboardMode = 'daily';
  let apiCalls = 0;
  context.api = async endpoint => {
    apiCalls += 1;
    assert.strictEqual(endpoint, '/api/referral/me', 'Profile must load the direct-invite endpoint');
    return {
      invitedCount: 0,
      activeInvitedCount: 8,
      referralStats: { totalReferrals: 23, activeReferrals: 8 },
      referralLevelRates: [], referralHistory: [], networkLevels: [], team: [], invited: [], referralTasks: []
    };
  };

  const referralStart = app.indexOf('let referralDataRequestSequence = 0;');
  const referralEnd = app.indexOf('\nasync function claimReferralTask', referralStart);
  assert.ok(referralStart >= 0 && referralEnd > referralStart, 'referral data loader must be present');
  vm.runInContext(app.slice(referralStart, referralEnd), context);
  const profileStart = app.indexOf('let profileRenderSequence = 0;');
  const profileEnd = app.indexOf('\nasync function renderVipTab()', profileStart);
  assert.ok(profileStart >= 0 && profileEnd > profileStart, 'Profile render lifecycle must be present');
  vm.runInContext(app.slice(profileStart, profileEnd), context);

  const initialRender = vm.runInContext('renderProfile()', context);
  assert.ok(context.__content.innerHTML.includes('<strong>…</strong><span class="profilePulseLabel">Direct invites</span>'),
    'Profile must show a loading placeholder instead of a false zero before direct counts load');
  await initialRender;
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(apiCalls, 1, 'Profile menu must fetch direct invite data on first render');
  assert.strictEqual(context.state.referralDataLoaded, true, 'successful referral response must mark the count loaded');
  assert.strictEqual(context.state.invitedCount, 23, 'direct referral stats must recover a nonzero count even if the legacy count field is zero');
  assert.ok(context.__content.innerHTML.includes('<strong>23</strong><span class="profilePulseLabel">Direct invites</span>'),
    'rendered Direct Invites card must display the authoritative API count instead of zero');

  console.log('PASS — Profile stats render exactly one UP logo/badge per token card, keep labels clean, load authoritative direct invites, and use version-4 assets');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
