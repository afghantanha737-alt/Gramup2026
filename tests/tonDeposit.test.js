'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  TONCENTER_BASE,
  TONCENTER_V2_BASE,
  TONAPI_BASE,
  normalizeTonAddress,
  toTonConnectAddress,
  normalizeTonTxHash,
  amountToNanoGram,
  nanoGramToNumber,
  hasExactReference,
  decodeNativeTextComment,
  findIncomingNativeGramTransferByReference,
  verifyNativeGramTransfer
} = require('../utils/tonNativeDepositVerify');
const { comment } = require('@ton/core');

const mainnetFriendly = 'EQDKbjIcfM6ezt8KjKJJLshZJJSqX7XOA4ff-W72r5gqPrHF';
const mainnetRaw = '0:ca6e321c7cce9ecedf0a8ca2492ec8592494aa5fb5ce0387dff96ef6af982a3e';
const testnetFriendly = 'kQDKbjIcfM6ezt8KjKJJLshZJJSqX7XOA4ff-W72r5gqPgpP';
const destination = '0:2222222222222222222222222222222222222222222222222222222222222222';
const sender = '0:3333333333333333333333333333333333333333333333333333333333333333';
const hash = 'a'.repeat(64);
const senderHash = 'c'.repeat(64);
const messageHash = 'b'.repeat(64);
const reference = 'GRAMUP:ABC123';
const now = 1790964000;

function incomingTransaction({
  txHash = hash,
  inMessageHash = messageHash,
  account = destination,
  target = destination,
  value = '2500000000',
  comment = reference,
  aborted = false,
  mcBlockSeqno = 5000,
  bounced = false
} = {}) {
  return {
    hash: txHash,
    account,
    now,
    mc_block_seqno: mcBlockSeqno,
    description: { aborted, compute_ph: { success: true }, action: { success: true } },
    in_msg: {
      hash: inMessageHash,
      source: sender,
      destination: target,
      value,
      bounced,
      created_at: String(now),
      message_content: { decoded: { '@type': 'text_comment', text: comment } }
    }
  };
}

function mockResponse(payload) {
  return { ok: true, json: async () => payload };
}

async function run() {
  assert.strictEqual(normalizeTonAddress(mainnetFriendly), mainnetRaw, 'mainnet friendly address normalizes to raw');
  assert.strictEqual(normalizeTonAddress(mainnetFriendly.replace(/-/g, '+').replace(/_/g, '/')), mainnetRaw, 'standard Base64 friendly address is accepted');
  assert.strictEqual(normalizeTonAddress(testnetFriendly), null, 'testnet-only friendly address is rejected');
  assert.strictEqual(normalizeTonAddress(mainnetRaw.toUpperCase()), mainnetRaw, 'raw address is normalized');
  assert.strictEqual(toTonConnectAddress(mainnetRaw), mainnetFriendly, 'raw Mainnet address is formatted for TON Connect messages');
  assert.strictEqual(normalizeTonAddress(`${mainnetFriendly.slice(0, -1)}A`), null, 'bad address checksum fails');
  assert.strictEqual(normalizeTonTxHash(`0x${hash.toUpperCase()}`), hash, 'hex transaction hash is normalized');
  assert.strictEqual(normalizeTonTxHash(Buffer.from(hash, 'hex').toString('base64url')), hash, 'Base64url transaction hash is normalized');
  assert.strictEqual(normalizeTonTxHash('not-a-hash'), null, 'invalid transaction hash is rejected');

  assert.strictEqual(amountToNanoGram(1.25), 1250000000n);
  assert.strictEqual(amountToNanoGram(1e-9), 1n, 'scientific notation for one nanogram is handled exactly');
  assert.strictEqual(amountToNanoGram(0.12345678901), null, 'values beyond 9 decimals are not rounded into a different amount');
  assert.strictEqual(nanoGramToNumber('1250000000'), 1.25);
  assert.strictEqual(nanoGramToNumber('9007199254740992'), null, 'unsafe JavaScript numeric balances fail closed');

  assert.strictEqual(hasExactReference({ message_content: { decoded: { text_comment: { text: reference } } } }, reference), true);
  assert.strictEqual(hasExactReference({ message_content: { decoded: { comment: `${reference}-other` } } }, reference), false, 'invoice comment must match exactly');
  assert.strictEqual(hasExactReference({ message_content: { decoded: { comment: reference } } }, ''), false, 'empty invoice IDs never match');

  const directRequests = [];
  const direct = await findIncomingNativeGramTransferByReference({ txHash: hash, depositAddress: destination, reference }, {
    apiKey: 'test-key',
    fetchImpl: async (url, init) => {
      directRequests.push({ url: String(url), headers: init.headers });
      assert.ok(String(url).startsWith(`${TONCENTER_BASE}/transactions?`), 'direct hash is resolved through TON Mainnet transactions API');
      return mockResponse({ transactions: [incomingTransaction()] });
    }
  });
  assert.strictEqual(directRequests.length, 1, 'a destination transaction needs one provider lookup');
  assert.strictEqual(directRequests[0].headers['X-API-Key'], 'test-key');
  assert.strictEqual(direct.status, 'verified');
  assert.strictEqual(direct.txHash, hash, 'receiving-wallet transaction hash is canonical');
  assert.strictEqual(direct.amountRaw, '2500000000', 'native in_msg.value is kept exactly in nanotons');
  assert.strictEqual(direct.amount, 2.5, 'nanotons convert to GRAM');
  assert.strictEqual(direct.sourceAddress, sender);
  assert.ok(direct.confirmedAt instanceof Date);
  assert.ok(!directRequests.some(item => item.url.toLowerCase().includes('jetton')));

  const commentBoc = comment(reference).toBoc().toString('base64');
  assert.strictEqual(decodeNativeTextComment(commentBoc), reference, 'native TON comment BOC decodes to the exact GRAMUP reference');
  const fallbackRequests = [];
  const fallback = await findIncomingNativeGramTransferByReference({ depositAddress: destination, reference }, {
    apiKey: 'test-key',
    fetchImpl: async (url) => {
      fallbackRequests.push(String(url));
      if (String(url).startsWith(`${TONCENTER_BASE}/transactions?`)) return { ok: false, status: 403, json: async () => ({}) };
      assert.ok(String(url).startsWith(`${TONCENTER_V2_BASE}/getTransactions?`), 'v2 fallback is used only after v3 account lookup is rejected');
      return mockResponse({ ok: true, result: [{
        account: destination,
        utime: now,
        transaction_id: { hash: Buffer.from(hash, 'hex').toString('base64') },
        in_msg: { source: sender, destination, value: '2500000000', created_at: String(now), msg_data: { body: commentBoc } }
      }] });
    }
  });
  assert.strictEqual(fallback.status, 'verified', 'v2 fallback verifies a committed native GRAM transfer');
  assert.strictEqual(fallback.amountRaw, '2500000000');
  assert.strictEqual(fallback.sourceAddress, sender);
  assert.strictEqual(fallbackRequests.length, 2);

  const tonApiFallback = await findIncomingNativeGramTransferByReference({ depositAddress: destination, reference }, {
    apiKey: 'test-key',
    fetchImpl: async (url) => {
      if (String(url).startsWith(`${TONCENTER_BASE}/transactions?`)) return { ok: false, status: 403, json: async () => ({}) };
      if (String(url).startsWith(`${TONCENTER_V2_BASE}/getTransactions?`)) return { ok: false, status: 403, json: async () => ({}) };
      assert.ok(String(url).startsWith(`${TONAPI_BASE}/blockchain/accounts/`), 'TONAPI is the final read-only account fallback');
      return mockResponse({ transactions: [{
        hash,
        account: { address: destination },
        utime: now,
        aborted: false,
        in_msg: { source: { address: sender }, destination: { address: destination }, value: 2500000000, bounced: false, raw_body: commentBoc }
      }] });
    }
  });
  assert.strictEqual(tonApiFallback.status, 'verified', 'TONAPI fallback verifies the same native GRAM comment transaction');

  const senderRequests = [];
  const senderTransaction = {
    hash: senderHash,
    account: sender,
    description: { aborted: false },
    out_msgs: [{ hash: messageHash, destination, value: '2500000000', bounced: false }]
  };
  const resolvedFromSender = await verifyNativeGramTransfer({ txHash: senderHash, depositAddress: destination, reference }, {
    apiKey: 'test-key',
    fetchImpl: async url => {
      senderRequests.push(String(url));
      if (String(url).includes('/transactions?')) return mockResponse({ transactions: [senderTransaction] });
      assert.ok(String(url).includes('/transactionsByMessage?'));
      assert.ok(String(url).includes(`msg_hash=${messageHash}`));
      assert.ok(String(url).includes('direction=in'));
      return mockResponse({ transactions: [incomingTransaction({ inMessageHash: messageHash })] });
    }
  });
  assert.strictEqual(senderRequests.length, 2, 'a sender transaction is followed to the receiving wallet transaction');
  assert.strictEqual(resolvedFromSender.status, 'verified');
  assert.strictEqual(resolvedFromSender.txHash, hash, 'canonical hash is receiver-side, not the user-supplied sender hash');
  assert.strictEqual(resolvedFromSender.submittedTxHash, senderHash);

  const messageHashOnly = await verifyNativeGramTransfer({ txHash: messageHash, depositAddress: destination, reference }, {
    apiKey: 'test-key',
    fetchImpl: async url => String(url).includes('/transactions?')
      ? mockResponse({ transactions: [] })
      : mockResponse({ transactions: [incomingTransaction({ inMessageHash: messageHash })] })
  });
  assert.strictEqual(messageHashOnly.status, 'verified', 'internal message hashes can resolve to a real incoming native transaction');

  const notIndexed = await verifyNativeGramTransfer({ txHash: hash, depositAddress: destination, reference }, {
    apiKey: 'test-key',
    fetchImpl: async url => String(url).includes('/transactions?')
      ? mockResponse({ transactions: [] })
      : mockResponse({ transactions: [] })
  });
  assert.deepStrictEqual(notIndexed, { status: 'pending', code: 'TON_TRANSACTION_NOT_INDEXED' });

  const notFinal = await verifyNativeGramTransfer({ txHash: hash, depositAddress: destination, reference }, {
    apiKey: 'test-key',
    fetchImpl: async () => mockResponse({ transactions: [incomingTransaction({ mcBlockSeqno: 0 })] })
  });
  assert.deepStrictEqual(notFinal, { status: 'pending', code: 'TON_TRANSACTION_NOT_FINAL' }, 'no credit before masterchain inclusion');

  const aborted = await verifyNativeGramTransfer({ txHash: hash, depositAddress: destination, reference }, {
    apiKey: 'test-key',
    fetchImpl: async () => mockResponse({ transactions: [incomingTransaction({ aborted: true })] })
  });
  assert.deepStrictEqual(aborted, { status: 'mismatch', code: 'TON_TRANSACTION_FAILED' }, 'aborted transactions fail closed');

  const bounced = await verifyNativeGramTransfer({ txHash: hash, depositAddress: destination, reference }, {
    apiKey: 'test-key',
    fetchImpl: async () => mockResponse({ transactions: [incomingTransaction({ bounced: true })] })
  });
  assert.deepStrictEqual(bounced, { status: 'mismatch', code: 'TON_TRANSACTION_FAILED' }, 'bounced incoming messages are never credited');

  const wrongDestination = await verifyNativeGramTransfer({ txHash: hash, depositAddress: destination, reference }, {
    apiKey: 'test-key',
    fetchImpl: async () => mockResponse({ transactions: [incomingTransaction({ target: sender, account: sender })] })
  });
  assert.deepStrictEqual(wrongDestination, { status: 'pending', code: 'TON_TRANSACTION_NOT_INDEXED' }, 'a transaction for another account cannot satisfy this invoice');

  const wrongReference = await verifyNativeGramTransfer({ txHash: hash, depositAddress: destination, reference }, {
    apiKey: 'test-key',
    fetchImpl: async () => mockResponse({ transactions: [incomingTransaction({ comment: 'GRAMUP:OTHER' })] })
  });
  assert.deepStrictEqual(wrongReference, { status: 'mismatch', code: 'DEPOSIT_REFERENCE_MISMATCH' }, 'another user invoice reference cannot be credited');

  const project = path.resolve(__dirname, '..');
  const route = fs.readFileSync(path.join(project, 'routes/points.js'), 'utf8');
  const model = fs.readFileSync(path.join(project, 'models/Deposit.js'), 'utf8');
  const settings = fs.readFileSync(path.join(project, 'models/Settings.js'), 'utf8');
  const adminRoute = fs.readFileSync(path.join(project, 'routes/admin.js'), 'utf8');
  const adminUi = fs.readFileSync(path.join(project, 'public/admin.html'), 'utf8');
  const miniAppUi = fs.readFileSync(path.join(project, 'public/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(project, 'public/js/app.js'), 'utf8');
  const walletConnect = fs.readFileSync(path.join(project, 'public/js/walletConnect.js'), 'utf8');
  const styles = fs.readFileSync(path.join(project, 'public/css/style.css'), 'utf8');
  const i18n = fs.readFileSync(path.join(project, 'public/js/i18n.js'), 'utf8');
  assert.ok(route.includes("router.post('/deposits/:id/verify'"));
  assert.ok(route.includes("router.post('/deposits/:id/cancel'"));
  assert.ok(route.includes("router.post('/deposits'"));
  assert.ok(route.includes('hasRecentWalletProof(req.dbUser)'));
  assert.ok(route.includes('requestedAmountRaw'));
  assert.ok(route.includes("DEPOSIT_SOURCE_WALLET_MISMATCH"));
  assert.ok(route.includes('findUsdtTransfer'));
  assert.ok(route.includes('await findUsdtTransfer('));
  assert.ok(route.includes('findIncomingNativeGramTransferByReference') && route.includes('verifyNativeGramTransfer'), 'native GRAM deposits use on-chain verification');
  assert.ok(route.includes('toTonConnectAddress(senderJettonWallet)') && route.includes('toTonConnectAddress(recipientAddress)'), 'Wallet transaction messages use TON Connect user-friendly addresses');
  assert.ok(route.includes("submittedHash\n        ? await verifyNativeGramTransfer") && route.includes("await findIncomingNativeGramTransferByReference({ depositAddress: deposit.depositAddressSnapshot, reference: deposit.reference })"), 'GRAM verification falls back to address/reference lookup when Wallet returns only a BOC');
  assert.ok(route.includes("asset.token === 'GRAM' ? 'تراکنش Native GRAM' : 'تراکنش TON USDT Jetton'"), 'verification errors identify the selected asset');
  assert.ok(route.includes("comment(reference).toBoc().toString('base64')"), 'native GRAM transaction comments use TON Connect Base64 payloads');
  assert.ok(route.includes('await withMongoTransaction(async session =>'));
  assert.ok(route.includes('txHashNormalized: verification.txHash'), 'canonical receiving transaction hash is uniquely claimed');
  assert.ok(route.includes('sourceId: `deposit:${verification.txHash}`'), 'ledger source uses canonical transaction hash');
  assert.ok(route.includes("type: 'deposit'"));
  assert.ok(route.includes("assetType: 'jetton_usdt'"));
  assert.ok(model.includes("name: 'active_deposit_per_user'"), 'active deposit index has a stable non-legacy name');
  assert.ok(model.includes("unique: true") && model.includes("partialFilterExpression: { status: { $in: ['pending', 'verifying'] } }"), 'only one active native deposit intent per user');
  assert.ok(model.includes("'cancelled'"), 'cancelled deposit status is persisted');
  assert.ok(model.includes("partialFilterExpression: { txHashNormalized: { $type: 'string' } }"));
  assert.ok(model.includes("enum: ['native_gram', 'jetton_usdt']"));
  assert.ok(!model.includes('jettonMasterSnapshot'));
  assert.ok(settings.includes("depositEnabled: { type: Boolean, default: false }"), 'deposits default off');
  assert.ok(settings.includes("minimumDepositUsdt: { type: Number, default: 0.1, min: 0 }"), 'USDT minimum deposit defaults to 0.1');
  assert.ok(settings.includes("depositWalletAddressGram: { type: String, default: '' }") && settings.includes("minimumDepositGram: { type: Number, default: 0.1, min: 0 }"), 'GRAM deposit settings persist independently');
  assert.ok(route.includes('readyGram') && route.includes('readyUsdt') && route.includes('forAsset'), 'deposit readiness is asset-specific');
  assert.ok(adminRoute.includes('depositWalletAddressGram') && adminRoute.includes('minimumDepositGram'), 'admin settings accept GRAM deposit configuration');
  assert.ok(adminUi.includes('setDepositWalletAddressGram') && adminUi.includes('setMinimumDepositGram'), 'admin UI exposes GRAM deposit configuration');
  assert.ok(!settings.includes('gramJettonMasterAddress'));
  assert.ok(adminRoute.includes("deposit.token === 'GRAM'") && adminRoute.includes('verifyNativeGramTransfer'));
  assert.ok(adminRoute.includes("submittedHash\n        ? await verifyNativeGramTransfer") && adminRoute.includes("await findIncomingNativeGramTransferByReference({ depositAddress: deposit.depositAddressSnapshot, reference: deposit.reference })"), 'admin GRAM approval finds the receiving native transaction by destination and Reference when no hash is supplied');
  assert.ok(adminRoute.includes('findIncomingNativeGramTransferByReference'), 'admin GRAM approval uses the native verifier, not a Jetton verifier');
  assert.ok(!adminUi.includes('setGramJettonMasterAddress'));
  assert.ok(miniAppUi.includes('USDT JETTON'));
  assert.ok(app.includes('submitUsdtDeposit'));
  assert.ok(miniAppUi.includes('data-copy-target="depositWalletAddress"'));
  assert.ok(miniAppUi.includes('data-copy-target="depositReference"'));
  assert.ok(miniAppUi.includes('<details class="depositManualDetails">'), 'manual deposit address and reference are collapsed by default');
  assert.ok(miniAppUi.includes('data-i18n="deposit_auto_send_hint"'));
  assert.ok(app.includes('const historyPromise = refreshDepositHistory().catch(() => null)'), 'deposit history loads concurrently and cannot block configuration rendering');
  assert.ok(i18n.includes('deposit_manual_details') && i18n.includes('deposit_auto_send_hint'));
  assert.ok(miniAppUi.includes('class="depositMemoCode"') && !miniAppUi.includes('copyAddress('));
  assert.ok(app.includes('reference.textContent = currentDeposit?.reference || t("deposit_reference_auto")'));
  assert.ok(app.includes('window.gramupWallet.requestDeposit(amount, state.selectedDepositAsset || "GRAM")'));
  assert.ok(app.includes('window.gramupWallet.verifyDeposit(currentDeposit._id, { boc: created.boc })'));
  assert.ok(app.includes('error.code === "TON_PROVIDER_UNAVAILABLE"') && app.includes('error.code === "TON_PROVIDER_TIMEOUT"'), 'provider outages remain retryable after a signed deposit');
  assert.ok(app.includes('deposit_status_verifying'));
  assert.ok(walletConnect.includes('sendTransaction(created.transaction)'));
  assert.ok(walletConnect.includes('/api/points/deposits/${encodeURIComponent(created.deposit._id)}/cancel'));
  assert.ok(miniAppUi.includes('id="depositAmount"'));
  assert.ok(app.includes('async function copyDepositValue(targetId)'));
  assert.ok(app.includes('navigator.clipboard?.writeText)') && app.includes('await navigator.clipboard.writeText(value)'));
  assert.ok(app.includes('document.execCommand("copy")'));
  assert.ok(app.includes('document.addEventListener("click", handleDepositCopyClick)'));
  assert.ok(styles.includes('.depositMemoCode') && styles.includes('border: 1px dashed'));
  assert.ok(i18n.includes('deposit_memo_not_address') && i18n.includes('deposit_copy_success'));
  assert.ok(route.includes('transactionAt: linkedDeposit?.verifiedAt || item.createdAt'), 'history includes on-chain transfer time');

  console.log('TON USDT Deposit verifier tests passed (mocked read-only provider; no live transfers).');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
