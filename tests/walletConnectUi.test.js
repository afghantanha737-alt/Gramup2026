'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

async function run() {
  const source = fs.readFileSync('public/js/walletConnect.js', 'utf8');
  const calls = [];
  let walletStatusListener;
  let transactionSent = null;
  let modalOpenCount = 0;
  let requestedNetwork = null;
  let persistedVerifiedAddress = '';
  const walletAddress = 'EQExampleWalletAddressForTest';
  const wallet = {
    account: {
      address: walletAddress,
      chain: '-239',
      publicKey: 'test-public-key',
      walletStateInit: 'test-state-init'
    },
    device: { appName: 'MockWallet' },
    connectItems: { tonProof: { proof: { payload: 'challenge-1', signature: 'mock-signature' } } }
  };

  class MockTonConnectUI {
    constructor(options) {
      this.options = options;
      this.wallet = null;
    }
    onStatusChange(listener) {
      walletStatusListener = listener;
      return () => {};
    }
    setConnectRequestParameters(parameters) { this.connectParameters = parameters; }
    setConnectionNetwork(network) { requestedNetwork = network; }
    openModal() { modalOpenCount += 1; return Promise.resolve(); }
    async disconnect() {
      this.wallet = null;
      walletStatusListener?.(null);
    }
    async sendTransaction(transaction) { transactionSent = transaction; return { boc: 'mock-boc' }; }
  }

  const windowObject = {
    location: { origin: 'https://gramup.example' },
    state: { language: 'en' },
    TON_CONNECT_UI: { TonConnectUI: MockTonConnectUI },
    dispatchEvent() {},
    async gramupApi(url, options = {}) {
      calls.push({ url, options });
      if (url === '/api/ton-proof/payload') return { success: true, payload: `challenge-${calls.filter(c => c.url === url).length}`, expiresAt: new Date(Date.now() + 900000).toISOString() };
      if (url === '/api/ton-proof/verify') { persistedVerifiedAddress = options.body.account.address; return { success: true, verified: true, wallet: { address: persistedVerifiedAddress } }; }
      if (url === '/api/points/wallet/connection/restore') return {
        success: true,
        verified: options.body.address === persistedVerifiedAddress && options.body.network === '-239',
        wallet: options.body.address === persistedVerifiedAddress ? { address: persistedVerifiedAddress, proofVerifiedAt: new Date().toISOString() } : null
      };
      if (url === '/api/points/wallet/connection' && options.method === 'DELETE') { persistedVerifiedAddress = ''; return { success: true }; }
      if (url === '/api/points/wallet/connection') return { success: true };
      if (url === '/api/points/deposits') return {
        success: true,
        deposit: { _id: 'deposit-123' },
        transaction: { validUntil: 1900000000, messages: [{ address: 'EQDepositTarget', amount: '1000000000' }] }
      };
      if (url.endsWith('/verify')) return { success: true, status: 'confirmed', gramBalance: 5 };
      if (url === '/api/points/withdraw') return { success: true, gramBalance: 4, withdrawalId: 'withdrawal-123' };
      throw new Error(`Unexpected API call: ${url}`);
    }
  };
  class MockCustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } }
  const context = {
    window: windowObject,
    document: { getElementById: () => null },
    CustomEvent: MockCustomEvent,
    console,
    setTimeout,
    clearTimeout,
    Promise,
    encodeURIComponent
  };
  vm.runInNewContext(source, context, { filename: 'walletConnect.js' });
  const walletApi = windowObject.gramupWallet;
  assert(walletApi, 'wallet API is installed');

  await walletApi.init();
  assert.strictEqual(walletApi.state.phase, 'disconnected');
  assert.strictEqual(requestedNetwork, '-239', 'fresh wallet connections are pinned to TON Mainnet');
  assert(calls.some(call => call.url === '/api/ton-proof/payload'), 'proof challenge is prefetched');
  walletApi.connect();
  assert.strictEqual(walletApi.state.phase, 'connecting');
  assert.strictEqual(walletApi.state.ui.connectParameters.state, 'ready');

  // A wallet without a signed proof must not be accepted for financial actions.
  walletStatusListener({ account: wallet.account, device: wallet.device });
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(walletApi.state.phase, 'connected');
  await assert.rejects(() => walletApi.requestWithdrawal(1, 'key-test'), error => error.code === 'WALLET_PROOF_REQUIRED');

  // Verify on an old proof-less session must disconnect; the next tap creates a fresh ConnectRequest.
  const firstModalOpenCount = modalOpenCount;
  await walletApi.connect();
  assert.strictEqual(walletApi.state.connected, false);
  assert.strictEqual(walletApi.state.phase, 'disconnected');
  assert.strictEqual(modalOpenCount, firstModalOpenCount, 'disconnect and opening the wallet picker require separate taps');
  assert(walletApi.state.error.includes('tap Connect wallet again'));
  await new Promise(resolve => setImmediate(resolve));
  walletApi.connect();
  assert.strictEqual(modalOpenCount, firstModalOpenCount + 1, 'second tap opens the wallet picker');

  // Signed proof is submitted to the server, and successful verification is bound to this address.
  walletStatusListener(wallet);
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(walletApi.state.phase, 'verified');
  assert.strictEqual(walletApi.isProofVerified(), true);
  assert.strictEqual(walletApi.state.proofAddress, walletAddress);

  // Closing/reopening the Mini App may restore a TonConnect account without
  // its original proof item. The server's persistent address binding restores
  // verified state without requiring another signature or disconnect.
  walletStatusListener(null);
  walletStatusListener({ account: wallet.account, device: wallet.device });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(walletApi.state.phase, 'verified');
  assert.strictEqual(walletApi.isProofVerified(), true, 'same persisted Mainnet wallet proof restores without prompting reconnect');
  assert.strictEqual(walletApi.state.connected, true);

  const withdrawal = await walletApi.requestWithdrawal(1, 'withdraw-key-1');
  assert.strictEqual(withdrawal.withdrawalId, 'withdrawal-123');
  const withdrawalCall = calls.find(call => call.url === '/api/points/withdraw');
  assert.strictEqual(withdrawalCall.options.body.address, walletAddress);
  assert.strictEqual(withdrawalCall.options.headers['Idempotency-Key'], 'withdraw-key-1');

  const deposit = await walletApi.requestDeposit(2.5);
  assert.strictEqual(deposit.deposit._id, 'deposit-123');
  assert(transactionSent?.messages?.length, 'TON Connect sends the server-prepared deposit transaction');
  assert.strictEqual(walletApi.state.operation.phase, 'pending');
  const verification = await walletApi.verifyDeposit(deposit.deposit._id);
  assert.strictEqual(verification.status, 'confirmed');

  await walletApi.disconnect();
  assert.strictEqual(walletApi.state.phase, 'disconnected');
  assert.strictEqual(walletApi.isProofVerified(), false);
  assert(calls.some(call => call.url === '/api/points/wallet/connection' && call.options.method === 'DELETE'), 'disconnect clears the server-side wallet association');
  assert.strictEqual(persistedVerifiedAddress, '', 'only explicit Disconnect removes the persisted verified wallet');
  console.log('PASS — mocked TON Connect UI state, proof gate, deposit and withdrawal server interactions');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
