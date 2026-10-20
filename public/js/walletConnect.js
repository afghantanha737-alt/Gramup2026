/* GramUp Wallet — TON Connect UI, server-verified ton_proof, and wallet actions. */
(function () {
  'use strict';

  const manifestUrl = `${window.location.origin}/tonconnect-manifest.json`;
  const state = {
    ready: false,
    phase: 'initializing',
    connected: false,
    proofVerified: false,
    proofAddress: '',
    proofNetwork: '',
    address: '',
    network: '',
    walletName: '',
    publicKey: '',
    error: '',
    operation: { kind: '', phase: 'idle' },
    ui: null,
    unsubscribe: null,
    proofPayload: '',
    statusSequence: 0
  };
  let proofVerificationInFlight = '';
  let clearServerInFlight = null;

  function labels() {
    const lang = window.state?.language || 'fa';
    if (lang === 'en') return {
      title: 'TON wallet', connect: 'Connect wallet', reconnect: 'Verify wallet', disconnect: 'Disconnect',
      loading: 'Preparing secure wallet connection…', disconnected: 'No wallet connected.',
      connecting: 'Waiting for wallet approval…', connected: 'Wallet connected', verifying: 'Verifying wallet ownership…',
      verified: 'Wallet verified', disconnecting: 'Disconnecting wallet…', unavailable: 'TON Connect UI is unavailable.',
      proofRequired: 'Reconnect and approve the TON Proof request to use wallet actions.',
      reconnectPrompt: 'This wallet session had no TON Proof. It was disconnected; tap Connect wallet again and approve the proof request.',
      operation: { submitting: 'Sending request to server…', sending: 'Approve the transaction in your wallet…', pending: 'Transaction sent; waiting for network confirmation…', confirmed: 'Transaction confirmed.', error: 'The wallet operation could not be completed.' }
    };
    if (lang === 'ps') return {
      title: 'TON والټ', connect: 'والټ وصل کړئ', reconnect: 'والټ تایید کړئ', disconnect: 'جلا کول',
      loading: 'د خوندي والټ اتصال چمتو کېږي…', disconnected: 'هیڅ والټ نه دی نښلول شوی.',
      connecting: 'د والټ تایید ته انتظار…', connected: 'والټ وصل شو', verifying: 'د والټ مالکیت تاییدېږي…',
      verified: 'والټ تایید شو', disconnecting: 'والټ جلا کېږي…', unavailable: 'TON Connect UI نشته.',
      proofRequired: 'د والټ د عملیاتو لپاره بیا وصل شئ او د TON Proof غوښتنه تایید کړئ.',
      reconnectPrompt: 'په دې اتصال کې TON Proof نه و. والټ جلا شو؛ د Connect تڼۍ بیا کېکاږئ او Proof تایید کړئ.',
      operation: { submitting: 'سرور ته غوښتنه لېږل کېږي…', sending: 'په خپل والټ کې معامله تایید کړئ…', pending: 'معامله ولېږل شوه؛ د شبکې تایید ته انتظار…', confirmed: 'معامله تایید شوه.', error: 'د والټ عملیات بشپړ نه شول.' }
    };
    return {
      title: 'TON Wallet', connect: 'وصل کردن Wallet', reconnect: 'تأیید Wallet', disconnect: 'قطع اتصال',
      loading: 'در حال آماده‌سازی اتصال امن Wallet…', disconnected: 'هیچ Wallet متصل نیست.',
      connecting: 'در انتظار تأیید Wallet…', connected: 'Wallet متصل است', verifying: 'در حال تأیید مالکیت Wallet…',
      verified: 'مالکیت Wallet تأیید شد', disconnecting: 'در حال قطع اتصال Wallet…', unavailable: 'TON Connect UI در دسترس نیست.',
      proofRequired: 'برای استفاده از عملیات Wallet، دوباره متصل شوید و درخواست TON Proof را تأیید کنید.',
      reconnectPrompt: 'اتصال فعلی TON Proof نداشت و قطع شد. حالا دوباره روی «وصل کردن Wallet» بزنید و درخواست اثبات را تأیید کنید.',
      operation: { submitting: 'در حال ارسال درخواست به سرور…', sending: 'تراکنش را در Wallet خود تأیید کنید…', pending: 'تراکنش ارسال شد؛ در انتظار تأیید شبکه…', confirmed: 'تراکنش تأیید شد.', error: 'عملیات Wallet انجام نشد.' }
    };
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  function shortAddress(value) {
    const text = String(value || '');
    return text.length > 18 ? `${text.slice(0, 7)}…${text.slice(-7)}` : text;
  }

  function isCurrentProof() {
    return Boolean(state.connected && state.proofVerified && state.network === '-239' && state.proofAddress === state.address && state.proofNetwork === state.network);
  }

  function notify() {
    const detail = { ...state, operation: { ...state.operation } };
    window.dispatchEvent(new CustomEvent('gramup:wallet-change', { detail }));
    if (typeof window.onGramupWalletChange === 'function') window.onGramupWalletChange(detail);
    if (document.getElementById('tonWalletConnection')) mount('tonWalletConnection');
  }

  function apiClient() {
    if (typeof window.gramupApi !== 'function') throw new Error('Authentication is not ready.');
    return window.gramupApi;
  }

  async function syncServer(wallet) {
    const api = apiClient();
    if (!wallet?.account?.address) throw new Error('Wallet address is missing.');
    return api('/api/points/wallet/connection', {
      method: 'POST',
      body: {
        address: wallet.account.address,
        network: wallet.account.chain || '',
        publicKey: wallet.account.publicKey || '',
        walletApp: wallet.device?.appName || wallet.provider?.name || ''
      }
    });
  }

  async function clearServer() {
    if (clearServerInFlight) return clearServerInFlight;
    clearServerInFlight = (async () => {
      try {
        await apiClient()('/api/points/wallet/connection', { method: 'DELETE' });
      } catch (error) {
        console.warn('Wallet disconnect sync failed:', error);
        throw error;
      } finally {
        clearServerInFlight = null;
      }
    })();
    return clearServerInFlight;
  }

  async function prepareProof(force = false) {
    if (!force && state.proofPayload) {
      state.ui?.setConnectRequestParameters({ state: 'ready', value: { tonProof: state.proofPayload } });
      return state.proofPayload;
    }
    const result = await apiClient()('/api/ton-proof/payload', { method: 'POST' });
    if (!result?.payload) throw new Error('TON Proof challenge could not be created.');
    state.proofPayload = result.payload;
    state.ui?.setConnectRequestParameters({ state: 'ready', value: { tonProof: result.payload } });
    return result.payload;
  }

  function setOperation(kind, phase, error) {
    state.operation = { kind: kind || '', phase: phase || 'idle' };
    if (phase === 'error' && error) state.error = error.message || labels().operation.error;
    else state.error = '';
    notify();
  }

  function operationError(kind, error) {
    state.operation = { kind, phase: 'error' };
    state.error = error?.message || labels().operation.error;
    notify();
  }

  function assertVerifiedWallet() {
    if (!state.ui || !isCurrentProof()) {
      throw Object.assign(new Error(labels().proofRequired), { code: 'WALLET_PROOF_REQUIRED' });
    }
    if (state.network !== '-239') {
      throw Object.assign(new Error('Connect a TON Mainnet wallet.'), { code: 'INVALID_CONNECTED_WALLET' });
    }
  }

  async function verifyAndSync(wallet) {
    const address = wallet?.account?.address || '';
    const network = wallet?.account?.chain || '';
    const proofItem = wallet?.connectItems?.tonProof;
    const flightKey = `${address}:${network}:${proofItem?.proof?.payload || ''}`;
    if (proofVerificationInFlight === flightKey) return false;
    proofVerificationInFlight = flightKey;

    if (!address || !proofItem || !('proof' in proofItem)) {
      state.proofVerified = false;
      state.proofAddress = '';
      state.phase = 'connected';
      state.error = labels().proofRequired;
      notify();
      void prepareProof(true).catch(error => {
        if (state.address !== address) return;
        state.error = error?.message || 'TON Proof challenge could not be prepared.';
        notify();
      });
      proofVerificationInFlight = '';
      return false;
    }

    try {
      const api = apiClient();
      const result = await api('/api/ton-proof/verify', {
        method: 'POST',
        body: {
          proof: proofItem.proof,
          account: {
            address,
            chain: wallet.account.chain || '',
            walletStateInit: wallet.account.walletStateInit || '',
            walletApp: wallet.device?.appName || wallet.provider?.name || ''
          }
        }
      });
      if (!state.connected || state.address !== address || state.network !== network) return false;
      if (result?.verified !== true || !result?.wallet?.address) {
        throw Object.assign(new Error('The server did not confirm this wallet proof.'), { code: 'TON_PROOF_INVALID' });
      }
      await syncServer(wallet);
      if (!state.connected || state.address !== address || state.network !== network) return false;
      state.proofVerified = true;
      state.proofAddress = address;
      state.proofNetwork = network;
      state.phase = 'verified';
      state.error = '';
      state.proofPayload = '';
      notify();
      void prepareProof(true).catch(() => {});
      return true;
    } catch (error) {
      if (!state.connected || state.address !== address || state.network !== network) return false;
      state.proofVerified = false;
      state.proofAddress = '';
      state.proofNetwork = '';
      state.phase = 'connected';
      state.error = error?.message || 'TON Proof verification failed.';
      state.proofPayload = '';
      notify();
      void prepareProof(true).catch(() => {});
      return false;
    } finally {
      if (proofVerificationInFlight === flightKey) proofVerificationInFlight = '';
    }
  }

  function applyWallet(wallet) {
    const account = wallet?.account;
    const previousAddress = state.address;
    state.statusSequence += 1;
    state.connected = Boolean(account?.address);
    state.address = account?.address || '';
    state.network = account?.chain || '';
    state.publicKey = account?.publicKey || '';
    state.walletName = wallet?.device?.appName || wallet?.provider?.name || '';
    state.error = '';

    if (!state.connected) {
      state.proofVerified = false;
      state.proofAddress = '';
      state.proofNetwork = '';
      state.phase = state.ready ? 'disconnected' : 'initializing';
      state.operation = { kind: '', phase: 'idle' };
      notify();
      if (previousAddress) void clearServer().catch(() => {});
      if (state.ready) void prepareProof(true).catch(error => { state.error = error?.message || labels().proofRequired; notify(); });
      return;
    }

    // A proof belongs to one exact address. A changed wallet always needs a new proof.
    if (state.proofAddress !== state.address || state.proofNetwork !== state.network) {
      state.proofVerified = false;
      state.proofAddress = '';
      state.proofNetwork = '';
    }
    if (isCurrentProof()) {
      state.phase = 'verified';
      notify();
      return;
    }
    state.phase = 'verifying';
    notify();
    void verifyAndSync(wallet);
  }

  function getStatusHtml() {
    const text = labels();
    const titleByPhase = {
      initializing: text.loading,
      disconnected: text.disconnected,
      connecting: text.connecting,
      connected: text.connected,
      verifying: text.verifying,
      verified: text.verified,
      disconnecting: text.disconnecting,
      error: state.error || text.unavailable
    };
    const message = state.error || (state.operation.phase !== 'idle' ? text.operation[state.operation.phase] : '');
    const connected = state.connected;
    const busy = ['initializing', 'connecting', 'verifying', 'disconnecting'].includes(state.phase);
    const connectButton = !connected
      ? `<button type="button" class="walletConnectButton" data-wallet-connect ${busy ? 'disabled' : ''}>${escapeHtml(text.connect)}</button>`
      : (!isCurrentProof()
        ? `<button type="button" class="walletConnectButton" data-wallet-connect ${busy ? 'disabled' : ''}>${escapeHtml(text.reconnect)}</button>`
        : '');
    const disconnectButton = connected
      ? `<button type="button" class="walletDisconnectButton" data-wallet-disconnect ${state.phase === 'disconnecting' ? 'disabled' : ''}>${escapeHtml(text.disconnect)}</button>`
      : '';
    const statusDot = connected ? '<span class="walletStatusDot" aria-hidden="true"></span>' : '';
    return `<section class="walletConnectCard" aria-label="${escapeHtml(text.title)}" aria-busy="${busy ? 'true' : 'false'}">
      <div class="walletConnectCopy">
        <div class="walletConnectTitle" role="status">${escapeHtml(titleByPhase[state.phase] || text.disconnected)}</div>
        <div class="walletConnectHint">${statusDot}${connected ? `${escapeHtml(shortAddress(state.address))} · ${escapeHtml(state.walletName || 'TON')}` : escapeHtml(message || (state.phase === 'initializing' ? text.loading : text.disconnected))}</div>
        ${message && connected ? `<div class="walletConnectMessage" role="status">${escapeHtml(message)}</div>` : ''}
      </div>
      <div class="walletConnectActions">${connectButton}${disconnectButton}</div>
    </section>`;
  }

  function mount(rootId) {
    const root = document.getElementById(rootId);
    if (!root) return;
    root.innerHTML = getStatusHtml();
    root.querySelector('[data-wallet-connect]')?.addEventListener('click', connect);
    root.querySelector('[data-wallet-disconnect]')?.addEventListener('click', disconnect);
  }

  function handleConnectionError(error) {
    state.error = error?.message || 'Wallet connection was cancelled.';
    state.phase = state.connected ? (isCurrentProof() ? 'verified' : 'connected') : 'disconnected';
    notify();
  }

  async function connect() {
    if (!state.ui) {
      state.phase = 'error';
      state.error = labels().unavailable;
      notify();
      return;
    }
    if (state.phase === 'connecting' || state.phase === 'disconnecting') return;

    // tonProof is attached to a new ConnectRequest. Re-selecting a wallet in
    // an already-connected, proof-less session does not create that request.
    // Disconnect first, then require a second user tap to open the wallet.
    if (state.connected && !isCurrentProof()) {
      state.phase = 'disconnecting';
      state.error = '';
      notify();
      try {
        await state.ui.disconnect();
        if (state.connected) applyWallet(null);
        state.phase = 'disconnected';
        state.error = labels().reconnectPrompt;
        notify();
      } catch (error) {
        state.phase = 'connected';
        state.error = error?.message || labels().proofRequired;
        notify();
      }
      return;
    }

    state.error = '';
    state.phase = 'connecting';
    notify();
    try {
      // Keep openModal in the click call stack for Telegram mobile WebView user activation.
      if (!state.proofPayload) {
        state.error = 'Wallet security challenge is still loading. Please tap Connect again.';
        state.phase = state.connected ? 'connected' : 'disconnected';
        notify();
        void prepareProof(true).catch(error => { state.error = error?.message || labels().proofRequired; notify(); });
        return;
      }
      state.ui.setConnectRequestParameters({ state: 'ready', value: { tonProof: state.proofPayload } });
      const opened = state.ui.openModal();
      if (opened && typeof opened.then === 'function') {
        opened.then(() => {
          if (state.phase === 'connecting' && !state.connected) {
            state.phase = 'disconnected';
            notify();
          }
        }).catch(handleConnectionError);
      } else {
        setTimeout(() => {
          if (state.phase === 'connecting' && !state.connected) {
            state.phase = 'disconnected';
            notify();
          }
        }, 5000);
      }
    } catch (error) {
      state.phase = state.connected ? (isCurrentProof() ? 'verified' : 'connected') : 'disconnected';
      state.error = error?.message || 'Wallet connection was cancelled.';
      notify();
    }
  }

  async function disconnect() {
    if (!state.ui || state.phase === 'disconnecting') return;
    state.phase = 'disconnecting';
    state.error = '';
    notify();
    try {
      await state.ui.disconnect();
      if (state.connected) applyWallet(null);
      else {
        state.connected = false; state.proofVerified = false;
        state.proofAddress = ''; state.proofNetwork = ''; state.address = ''; state.network = ''; state.walletName = ''; state.publicKey = '';
        state.phase = 'disconnected';
        notify();
      }
      await clearServer();
    } catch (error) {
      state.error = error?.message || 'Wallet disconnect could not be synchronized with the server.';
      state.phase = state.connected ? (isCurrentProof() ? 'verified' : 'connected') : 'disconnected';
      notify();
    }
  }

  async function requestDeposit(amount) {
    assertVerifiedWallet();
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) throw Object.assign(new Error('Invalid deposit amount.'), { code: 'INVALID_AMOUNT' });
    setOperation('deposit', 'submitting');
    let created = null;
    try {
      created = await apiClient()('/api/points/deposits', { method: 'POST', body: { amount: value } });
      if (!created?.deposit?._id || !created?.transaction?.messages?.length) {
        throw Object.assign(new Error('Deposit transaction is unavailable.'), { code: 'DEPOSIT_TRANSACTION_UNAVAILABLE' });
      }
      if (!isCurrentProof()) throw Object.assign(new Error(labels().proofRequired), { code: 'WALLET_PROOF_REQUIRED' });
      setOperation('deposit', 'sending');
      await state.ui.sendTransaction(created.transaction);
      setOperation('deposit', 'pending');
      return created;
    } catch (error) {
      if (created?.deposit) error.deposit = created.deposit;
      operationError('deposit', error);
      throw error;
    }
  }

  async function verifyDeposit(depositId) {
    if (!depositId) throw new Error('Deposit reference is missing.');
    return apiClient()(`/api/points/deposits/${encodeURIComponent(depositId)}/verify`, { method: 'POST', body: {} });
  }

  async function requestWithdrawal(gram, idempotencyKey) {
    assertVerifiedWallet();
    const amount = Number(gram);
    if (!Number.isFinite(amount) || amount <= 0) throw Object.assign(new Error('Invalid withdrawal amount.'), { code: 'INVALID_AMOUNT' });
    setOperation('withdrawal', 'submitting');
    try {
      const result = await apiClient()('/api/points/withdraw', {
        method: 'POST',
        headers: { 'Idempotency-Key': String(idempotencyKey || '') },
        body: { gram: amount, address: state.address }
      });
      setOperation('withdrawal', 'pending');
      return result;
    } catch (error) {
      operationError('withdrawal', error);
      throw error;
    }
  }

  async function swapGramToPoints(amount) {
    assertVerifiedWallet();
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) throw Object.assign(new Error('Invalid swap amount.'), { code: 'INVALID_AMOUNT' });
    setOperation('swap', 'submitting');
    try {
      const api = apiClient();
      const created = await api('/api/points/swap/gram-to-points/intents', { method: 'POST', body: { amount: value } });
      const intent = created?.intent;
      if (!intent?._id || !created.transaction?.messages?.length) throw new Error('Swap intent could not be created.');
      if (!isCurrentProof()) throw Object.assign(new Error(labels().proofRequired), { code: 'WALLET_PROOF_REQUIRED' });
      setOperation('swap', 'sending');
      await state.ui.sendTransaction(created.transaction);
      setOperation('swap', 'pending');
      for (let attempt = 0; attempt < 12; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, attempt === 0 ? 3000 : 5000));
        const verified = await api(`/api/points/swap/gram-to-points/intents/${encodeURIComponent(intent._id)}/verify`, { method: 'POST', body: {} });
        if (verified?.status === 'confirmed') {
          setOperation('swap', 'confirmed');
          return verified;
        }
      }
      const pending = new Error('Transaction sent; blockchain confirmation is still pending.');
      pending.code = 'SWAP_CONFIRMATION_PENDING';
      throw pending;
    } catch (error) {
      operationError('swap', error);
      throw error;
    }
  }

  async function init() {
    if (state.ready) return state;
    if (!window.TON_CONNECT_UI?.TonConnectUI) {
      state.phase = 'error';
      state.error = labels().unavailable;
      notify();
      return state;
    }
    try {
      state.ui = new window.TON_CONNECT_UI.TonConnectUI({ manifestUrl });
      // Pin fresh connections to the same Mainnet accepted by the proof and financial APIs.
      if (!state.ui.connected && typeof state.ui.setConnectionNetwork === 'function') {
        state.ui.setConnectionNetwork('-239');
      }
      state.unsubscribe = state.ui.onStatusChange(wallet => applyWallet(wallet), handleConnectionError);
      state.ready = true;
      state.phase = 'disconnected';
      applyWallet(state.ui.wallet || null);
    } catch (error) {
      state.phase = 'error';
      state.error = error?.message || 'Wallet connection failed to initialize.';
      notify();
    }
    return state;
  }

  window.gramupWallet = {
    state,
    init,
    mount,
    connect,
    disconnect,
    setOperation,
    requestDeposit,
    verifyDeposit,
    requestWithdrawal,
    swapGramToPoints,
    getStatusHtml,
    getAddress: () => state.address,
    isConnected: () => state.connected,
    isProofVerified: isCurrentProof
  };
  window.initGramupWalletConnect = init;
})();
