'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function main() {
  const root = path.join(__dirname, '..');
  const app = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'public/css/style.css'), 'utf8');
  const i18n = fs.readFileSync(path.join(root, 'public/js/i18n.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');

  function extract(startMarker, endMarker) {
    const start = app.indexOf(startMarker);
    const end = app.indexOf(endMarker, start);
    assert.ok(start >= 0 && end > start, `Expected source block: ${startMarker}`);
    return app.slice(start, end);
  }

  const minePanel = extract('function renderMiningPanel()', '\nasync function claimMining()');
  assert.match(minePanel, /mineConsole--empty/,
    'a missing mining read model must render a visible empty state, not an empty string');
  assert.match(minePanel, /mining_loading/);
  assert.match(minePanel, /mining_load_error/);
  assert.match(minePanel, /retryMiningStatus\(\)/);

  const renderContext = {
    state: { mining: null, miningLoading: true },
    t: key => ({
      mining_title: 'Gramup Mining',
      mining_loading: 'Loading mining data...',
      mining_load_error: 'Mining data is unavailable. Please try again.',
      retry_button: 'Try again'
    })[key] || key,
    escapeHTML: value => String(value)
  };
  vm.runInNewContext(`${minePanel}; globalThis.renderPanel = renderMiningPanel;`, renderContext);
  let rendered = renderContext.renderPanel();
  assert.match(rendered, /mineConsole--empty/);
  assert.match(rendered, /Loading mining data/);
  assert.doesNotMatch(rendered, /^\s*$/);

  renderContext.state.miningLoading = false;
  rendered = renderContext.renderPanel();
  assert.match(rendered, /Mining data is unavailable/);
  assert.match(rendered, /onclick="retryMiningStatus\(\)"/);
  assert.match(rendered, /Try again/);

  const loadedContext = {
    state: {
      mining: {
        accumulatedPoints: 12,
        boostActive: false,
        boostMultiplier: 1,
        effectiveRatePerHour: 20,
        history: [],
        isStorageFull: false,
        level: 1,
        maxStoragePoints: 60,
        rigName: 'Basic CPU Miner'
      },
      rate: 0.0001,
      streak: 4
    },
    t: key => key,
    escapeHTML: value => String(value),
    miningLiveValues: () => ({ points: 12, percent: 20, remainingSeconds: 3600, full: false }),
    renderMiningHistory: () => '<div class="mineHistoryEmpty">No claims</div>',
    formatNumber: (value, decimals = 0) => Number(value).toFixed(decimals),
    formatMiningDuration: () => '1h 00m',
    formatPoints: value => String(value)
  };
  vm.runInNewContext(`${minePanel}; globalThis.renderPanel = renderMiningPanel;`, loadedContext);
  const loadedPanel = loadedContext.renderPanel();
  assert.match(loadedPanel, /class="mineConsole"/);
  assert.match(loadedPanel, /data-mine-earned/);
  assert.match(loadedPanel, /class="mineProgressTrack"/);
  assert.match(loadedPanel, /class="mineMetrics"/);
  assert.match(loadedPanel, /class="mineSessionCard"/);

  const loader = extract('let miningStatusPromise = null;', '\nlet miningTickerTimer = null;');
  let apiCalls = 0;
  let resolveStatusResponse;
  const loaderContext = {
    state: { mining: null, miningLoading: false },
    api: route => {
      assert.equal(route, '/api/mining/status');
      apiCalls += 1;
      return new Promise(resolve => {
        resolveStatusResponse = () => resolve({
          mining: { level: 1 },
          history: [{ type: 'mining_claim', amount: 4, createdAt: '2026-11-06T12:00:00.000Z' }]
        });
      });
    },
    console: { warn: () => {} }
  };
  vm.runInNewContext(`${loader}; globalThis.loadStatus = loadMiningStatus;`, loaderContext);
  const firstStatusLoad = loaderContext.loadStatus();
  const secondStatusLoad = loaderContext.loadStatus();
  assert.equal(apiCalls, 1, 'concurrent Mine entries should share one mining-status request');
  assert.equal(loaderContext.state.miningLoading, true);
  resolveStatusResponse();
  assert.deepEqual(await Promise.all([firstStatusLoad, secondStatusLoad]), [true, true]);
  assert.equal(loaderContext.state.mining.level, 1);
  assert.equal(loaderContext.state.mining.history[0].amount, 4);
  assert.equal(loaderContext.state.miningLoading, false);

  const renderMineTab = extract('async function renderVipTab()', '\nasync function retryMiningStatus()');
  const content = { innerHTML: '' };
  let resolveMiningStatus;
  const tabContext = {
    navigationSequence: 1,
    profileView: '',
    state: { activeTab: 'vip', mining: null, miningLoading: false },
    $: () => content,
    loadMiningStatus: () => {
      tabContext.state.miningLoading = true;
      return new Promise(resolve => {
        resolveMiningStatus = () => {
          tabContext.state.mining = { level: 1 };
          tabContext.state.miningLoading = false;
          resolve(true);
        };
      });
    },
    renderProfileVip: () => tabContext.state.mining
      ? '<div class="mineConsole">Loaded mining console</div>'
      : `<div class="mineConsole mineConsole--empty">${tabContext.state.miningLoading ? 'Loading mining data...' : 'Mining data is unavailable'}</div>`,
    startVipCountdown: () => {}
  };
  vm.runInNewContext(`${renderMineTab}; globalThis.renderMineTab = renderVipTab;`, tabContext);
  const pendingRender = tabContext.renderMineTab();
  assert.match(content.innerHTML, /mineConsole--empty/,
    'Mine navigation should show a visible loading panel while its status request is pending');
  resolveMiningStatus();
  await pendingRender;
  assert.match(content.innerHTML, /Loaded mining console/,
    'Mine navigation should render the console after mining status resolves');
  assert.doesNotMatch(content.innerHTML, /mineConsole--empty/);

  const dispatcher = extract('async function renderCurrentTab(', '\n/* ================= BOOT');
  const vipDispatchStart = dispatcher.indexOf('} else if (tab === "vip") {');
  const vipDispatchEnd = dispatcher.indexOf('} else if (tab === "wallet") {', vipDispatchStart);
  assert.ok(vipDispatchStart >= 0 && vipDispatchEnd > vipDispatchStart);
  assert.match(dispatcher.slice(vipDispatchStart, vipDispatchEnd), /await renderVipTab\(\)/,
    'both cached and uncached Mine routes must enter the status-loading renderer');

  assert.match(css, /\.mineConsole--empty\s*\{/);
  assert.match(css, /\.mineEmptySpinner\s*\{/);
  assert.equal((i18n.match(/mining_loading:/g) || []).length, 3,
    'the loading message must be translated in Dari, Pashto, and English');
  assert.equal((i18n.match(/mining_load_error:/g) || []).length, 3,
    'the retry message must be translated in Dari, Pashto, and English');
  assert.match(html, /style\.css\?v=up_v28_20261106_4/);
  assert.match(html, /i18n\.js\?v=up_v31_mine_status_fix/);
  assert.match(html, /app\.js\?v=up_v31_mine_status_fix/);

  console.log('PASS — Mine status loads on navigation, missing data stays visible/retryable, locales and cache versions are complete');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
