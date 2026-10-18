/* GramUp Wallet Connection — TON Connect UI 5.x, no financial action is sent here. */
(function () {
  'use strict';

  const manifestUrl = `${window.location.origin}/tonconnect-manifest.json`;
  const state = {
    ready: false,
    connected: false,
    address: '',
    network: '',
    walletName: '',
    publicKey: '',
    error: '',
    ui: null,
    unsubscribe: null
  };

  function shortAddress(value) {
    const text = String(value || '');
    return text.length > 18 ? `${text.slice(0, 7)}…${text.slice(-7)}` : text;
  }

  function labels() {
    const lang = window.state?.language || 'fa';
    return lang === 'en'
      ? { connect: 'Connect Wallet', loading: 'Wallet connection is loading…', hint: 'Use your connected Wallet for safer withdrawals.', connected: 'Wallet connected', disconnect: 'Disconnect' }
      : lang === 'ps'
        ? { connect: 'والټ وصل کړئ', loading: 'د والټ نښلول روان دي…', hint: 'د خوندي ایستلو لپاره خپل والټ وصل کړئ.', connected: 'والټ وصل شو', disconnect: 'جلا کول' }
        : { connect: 'وصل کردن Wallet', loading: 'در حال آماده‌سازی اتصال Wallet…', hint: 'برای برداشت امن‌تر Wallet خود را وصل کنید.', connected: 'Wallet متصل است', disconnect: 'قطع اتصال' };
  }

  function notify() {
    window.dispatchEvent(new CustomEvent('gramup:wallet-change', { detail: { ...state } }));
    if (typeof window.onGramupWalletChange === 'function') window.onGramupWalletChange({ ...state });
    if (document.getElementById('tonWalletConnection')) mount('tonWalletConnection');
  }

  async function syncServer(wallet) {
    const api = window.gramupApi;
    if (typeof api !== 'function' || !wallet?.account?.address) return;
    try {
      await api('/api/points/wallet/connect', {
        method: 'POST',
        body: {
          address: wallet.account.address,
          network: wallet.account.chain || '',
          publicKey: wallet.account.publicKey || '',
          walletApp: wallet.device?.appName || wallet.provider?.name || ''
        }
      });
    } catch (error) {
      state.error = error?.message || 'Wallet connection could not be saved.';
    }
  }

  async function clearServer() {
    const api = window.gramupApi;
    if (typeof api !== 'function') return;
    try { await api('/api/points/wallet/connect', { method: 'DELETE' }); } catch (error) { console.warn('Wallet disconnect sync failed:', error); }
  }

  function applyWallet(wallet) {
    const account = wallet?.account;
    state.connected = Boolean(account?.address);
    state.address = account?.address || '';
    state.network = account?.chain || '';
    state.publicKey = account?.publicKey || '';
    state.walletName = wallet?.device?.appName || wallet?.provider?.name || '';
    state.error = '';
    notify();
    if (wallet) void syncServer(wallet);
    if (typeof window.renderWalletConnectionStatus === 'function') window.renderWalletConnectionStatus();
  }

  function getStatusHtml() {
    const text = labels();
    if (!state.ready) return `<div class="walletConnectCard"><div class="walletConnectTitle">${text.connect}</div><div class="walletConnectHint">${text.loading}</div></div>`;
    if (!state.connected) {
      return `<div class="walletConnectCard"><div><div class="walletConnectTitle">${text.connect}</div><div class="walletConnectHint">${text.hint}</div></div><button type="button" class="walletConnectButton" data-wallet-connect>${text.connect}</button></div>`;
    }
    return `<div class="walletConnectCard walletConnected"><div><div class="walletConnectTitle">${text.connected}</div><div class="walletConnectHint"><span class="walletStatusDot"></span>${shortAddress(state.address)}</div></div><button type="button" class="walletDisconnectButton" data-wallet-disconnect>${text.disconnect}</button></div>`;
  }

  function mount(rootId) {
    const root = document.getElementById(rootId);
    if (!root) return;
    root.innerHTML = getStatusHtml();
    root.querySelector('[data-wallet-connect]')?.addEventListener('click', () => connect());
    root.querySelector('[data-wallet-disconnect]')?.addEventListener('click', () => disconnect());
  }

  async function connect() {
    if (!state.ui) {
      state.error = 'Wallet connection is unavailable.';
      notify();
      return;
    }
    state.error = '';
    try { await state.ui.openModal(); } catch (error) { state.error = error?.message || 'Wallet connection was cancelled.'; notify(); }
  }

  async function disconnect() {
    if (!state.ui) return;
    try { await state.ui.disconnect(); } catch (error) { console.warn('Wallet disconnect failed:', error); }
    await clearServer();
  }

  async function init() {
    if (state.ready) return state;
    if (!window.TON_CONNECT_UI?.TonConnectUI) {
      state.error = 'TON Connect UI is unavailable.';
      notify();
      return state;
    }
    try {
      state.ui = new window.TON_CONNECT_UI.TonConnectUI({ manifestUrl });
      state.unsubscribe = state.ui.onStatusChange(wallet => applyWallet(wallet));
      state.ready = true;
      applyWallet(state.ui.wallet);
    } catch (error) {
      state.error = error?.message || 'Wallet connection failed to initialize.';
      notify();
    }
    return state;
  }

  window.gramupWallet = { state, init, mount, connect, disconnect, getStatusHtml, getAddress: () => state.address, isConnected: () => state.connected };
  window.initGramupWalletConnect = init;
})();
