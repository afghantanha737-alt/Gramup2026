'use strict';
const assert = require('assert');
const crypto = require('crypto');
const {
  WalletContractV4,
  beginCell,
  storeStateInit
} = require('@ton/ton');
const { verifyTonProof, proofDigest, SUPPORTED_NETWORK } = require('../utils/tonProof');
const pointsRoute = require('fs').readFileSync(require.resolve('../routes/points'), 'utf8');
const serverSource = require('fs').readFileSync(require.resolve('../server'), 'utf8');

const { publicKey: publicKeyObject, privateKey } = crypto.generateKeyPairSync('ed25519');
const publicKey = publicKeyObject.export({ type: 'spki', format: 'der' }).subarray(-32);
const wallet = WalletContractV4.create({ workchain: 0, publicKey, walletId: 698983191 });
const stateInit = beginCell().store(storeStateInit(wallet.init)).endCell().toBoc().toString('base64');
const address = wallet.address.toString({ urlSafe: true, bounceable: true });
const payload = 'stage2-proof-test-nonce';
const domain = 'telegram-mini-app12345.onrender.com';
const timestamp = Math.floor(Date.now() / 1000);
const proof = {
  timestamp,
  domain: { lengthBytes: Buffer.byteLength(domain), value: domain },
  payload,
  signature: crypto.sign(null, proofDigest(wallet.address, {
    timestamp,
    domain: { lengthBytes: Buffer.byteLength(domain), value: domain },
    payload
  }), privateKey).toString('base64')
};

const verified = verifyTonProof({ address, network: SUPPORTED_NETWORK, walletStateInit: stateInit, proof, expectedDomain: domain, expectedPayload: payload });
assert.strictEqual(verified.address, address);
assert.strictEqual(Buffer.from(verified.publicKey, 'base64').toString('hex'), publicKey.toString('hex'));
assert.throws(() => verifyTonProof({ address, network: '-3', walletStateInit: stateInit, proof, expectedDomain: domain, expectedPayload: payload }), /TON_PROOF_NETWORK_NOT_ALLOWED/);
assert.throws(() => verifyTonProof({ address, network: SUPPORTED_NETWORK, walletStateInit: stateInit, proof: { ...proof, payload: 'wrong' }, expectedDomain: domain, expectedPayload: payload }), /TON_PROOF_PAYLOAD_MISMATCH/);
assert.match(pointsRoute, /swap\/gram-to-points\/intents/);
assert.match(pointsRoute, /txHashNormalized/);
assert.match(serverSource, /models\/TonProofChallenge/);
assert.match(serverSource, /models\/GramSwapIntent/);
assert.match(serverSource, /app\.use\('\/api\/ton-proof'/);
console.log('TON Proof cryptographic verification and Stage 2 contracts: PASS');
