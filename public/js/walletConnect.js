/* GramUp Wallet Connection — TON Connect UI with server-verified ton_proof. */
(function () {
  'use strict';
  const manifestUrl = `${window.location.origin}/tonconnect-manifest.json`;
  const state = { ready: false, connected: false, proofVerified: false, address: '', network: '', walletName: '', publicKey: '', error: '', ui: null, unsubscribe: null, proofPayload: '' };
  function shortAddress(value) { const text = String(value || ''); return text.length > 18 ? `${text.slice(0, 7)}…${text.slice(-7)}` : text; }
  function labels() {
    const lang = window.state?.language || 'fa';
    return lang === 'en'
      ? { connect: 'Connect Wallet', loading: 'Wallet connection is loading…', hint: 'Connect and verify your Wallet for swaps and safer withdrawals.', connected: 'Wallet connected', verified: 'Wallet ownership verified', reconnect: 'Reconnect Wallet', disconnect: 'Disconnect' }
      : lang === 'ps'
        ? { connect: 'والټ وصل کړئ', loading: 'د والټ نښلول روان دي…', hint: 'د Swap او خوندي ایستلو لپاره خپل والټ وصل او تایید کړئ.', connected: 'والټ وصل شو', verified: 'د والټ مالکیت تایید شو', reconnect: 'والټ بیا وصل کړئ', disconnect: 'جلا کول' }
        : { connect: 'وصل کردن Wallet', loading: 'در حال آماده‌سازی اتصال Wallet…', hint: 'برای Swap و برداشت امن، Wallet خود را وصل و تأیید کنید.', connected: 'Wallet متصل است', verified: 'مالکیت Wallet تأیید شد', reconnect: 'اتصال دوباره Wallet', disconnect: 'قطع اتصال' };
  }
  function notify() { window.dispatchEvent(new CustomEvent('gramup:wallet-change', { detail: { ...state } })); if (typeof window.onGramupWalletChange === 'function') window.onGramupWalletChange({ ...state }); if (document.getElementById('tonWalletConnection')) mount('tonWalletConnection'); }
  async function syncServer(wallet) {
    const api = window.gramupApi;
    if (typeof api !== 'function' || !wallet?.account?.address) return;
    await api('/api/points/wallet/connection', { method: 'POST', body: { address: wallet.account.address, network: wallet.account.chain || '', publicKey: wallet.account.publicKey || '', walletApp: wallet.device?.appName || wallet.provider?.name || '' } });
  }
  async function clearServer() { const api = window.gramupApi; if (typeof api !== 'function') return; try { await api('/api/points/wallet/connection', { method: 'DELETE' }); } catch (error) { console.warn('Wallet disconnect sync failed:', error); } }
  async function verifyAndSync(wallet) {
    const api = window.gramupApi;
    const proofItem = wallet?.connectItems?.tonProof;
    if (typeof api !== 'function' || !wallet?.account?.address || !proofItem || !('proof' in proofItem)) { state.proofVerified = false; state.error = wallet?.account?.address ? labels().reconnect : ''; notify(); return false; }
    try {
      await api('/api/ton-proof/verify', { method: 'POST', body: { proof: proofItem.proof, account: { address: wallet.account.address, chain: wallet.account.chain || '', walletStateInit: wallet.account.walletStateInit || '', walletApp: wallet.device?.appName || wallet.provider?.name || '' } } });
      state.proofVerified = true; state.error = ''; await syncServer(wallet); notify(); return true;
    } catch (error) { state.proofVerified = false; state.error = error?.message || 'TON Proof verification failed.'; notify(); return false; }
  }
  function applyWallet(wallet) {
    const account = wallet?.account;
    state.connected = Boolean(account?.address); state.address = account?.address || ''; state.network = account?.chain || ''; state.publicKey = account?.publicKey || ''; state.walletName = wallet?.device?.appName || wallet?.provider?.name || '';
    if (!state.connected) state.proofVerified = false;
    state.error = ''; notify(); if (wallet) void verifyAndSync(wallet); if (typeof window.renderWalletConnectionStatus === 'function') window.renderWalletConnectionStatus();
  }
  function getStatusHtml() {
    const text = labels();
    if (!state.ready) return `<div class="walletConnectCard"><div class="walletConnectTitle">${text.connect}</div><div class="walletConnectHint">${text.loading}</div></div>`;
    if (!state.connected) return `<div class="walletConnectCard"><div><div class="walletConnectTitle">${text.connect}</div><div class="walletConnectHint">${state.error || text.hint}</div></div><button type="button" class="walletConnectButton" data-wallet-connect>${text.connect}</button></div>`;
    const verifiedLabel = state.proofVerified ? text.verified : text.reconnect;
    return `<div class="walletConnectCard walletConnected"><div><div class="walletConnectTitle">${state.proofVerified ? verifiedLabel : text.connected}</div><div class="walletConnectHint"><span class="walletStatusDot"></span>${shortAddress(state.address)}${state.proofVerified ? '' : ` · ${text.reconnect}`}</div></div><button type="button" class="${state.proofVerified ? 'walletDisconnectButton' : 'walletConnectButton'}" data-wallet-${state.proofVerified ? 'disconnect' : 'connect'}>${state.proofVerified ? text.disconnect : text.reconnect}</button></div>`;
  }
  function mount(rootId) { const root = document.getElementById(rootId); if (!root) return; root.innerHTML = getStatusHtml(); root.querySelector('[data-wallet-connect]')?.addEventListener('click', () => connect()); root.querySelector('[data-wallet-disconnect]')?.addEventListener('click', () => disconnect()); }
  async function prepareProof() { const api = window.gramupApi; if (typeof api !== 'function') throw new Error('Authentication is not ready.'); const result = await api('/api/ton-proof/payload', { method: 'POST' }); if (!result?.payload) throw new Error('TON Proof challenge could not be created.'); state.proofPayload = result.payload; state.ui.setConnectRequestParameters({ state: 'ready', value: { tonProof: result.payload } }); }
  async function swapGramToPoints(amount) {
    const api = window.gramupApi;
    if (!state.ui || !state.connected || !state.proofVerified) throw Object.assign(new Error('Reconnect and verify your Wallet first.'), { code: 'WALLET_PROOF_REQUIRED' });
    const created = await api('/api/points/swap/gram-to-points/intents', { method: 'POST', body: { amount } });
    const intent = created?.intent;
    if (!intent?._id || !created.transaction) throw new Error('Swap intent could not be created.');
    await state.ui.sendTransaction(created.transaction);
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, attempt === 0 ? 3000 : 5000));
      const verified = await api(`/api/points/swap/gram-to-points/intents/${encodeURIComponent(intent._id)}/verify`, { method: 'POST', body: {} });
      if (verified?.status === 'confirmed') return verified;
    }
    const pending = new Error('Transaction sent; blockchain confirmation is still pending.');
    pending.code = 'SWAP_CONFIRMATION_PENDING';
    throw pending;
  }
  async function connect() { if (!state.ui) { state.error = 'Wallet connection is unavailable.'; notify(); return; } state.error = ''; try { await prepareProof(); await state.ui.openModal(); } catch (error) { state.error = error?.message || 'Wallet connection was cancelled.'; notify(); } }
  async function disconnect() { if (!state.ui) return; try { await state.ui.disconnect(); } catch (error) { console.warn('Wallet disconnect failed:', error); } await clearServer(); state.proofVerified = false; }
  async function init() {
    if (state.ready) return state;
    if (!window.TON_CONNECT_UI?.TonConnectUI) { state.error = 'TON Connect UI is unavailable.'; notify(); return state; }
    try { state.ui = new window.TON_CONNECT_UI.TonConnectUI({ manifestUrl }); state.unsubscribe = state.ui.onStatusChange(wallet => applyWallet(wallet)); state.ready = true; applyWallet(state.ui.wallet); } catch (error) { state.error = error?.message || 'Wallet connection failed to initialize.'; notify(); }
    return state;
  }
  window.gramupWallet = { state, init, mount, connect, disconnect, swapGramToPoints, getStatusHtml, getAddress: () => state.address, isConnected: () => state.connected, isProofVerified: () => state.proofVerified };
  window.initGramupWalletConnect = init;
})();
