'use strict';

const crypto = require('crypto');
const {
  Address,
  Cell,
  contractAddress,
  domainSignVerify,
  loadStateInit,
  WalletContractV3R1,
  WalletContractV3R2,
  WalletContractV4
} = require('@ton/ton');

const PROOF_PREFIX = Buffer.from('ton-proof-item-v2/', 'utf8');
const CONNECT_PREFIX = Buffer.from('ton-connect', 'utf8');
const PROOF_MAX_AGE_SEC = 15 * 60;
const SUPPORTED_NETWORK = '-239';
const DEFAULT_WALLET_ID = 698983191;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest();
}

function walletCodeHashes() {
  const publicKey = Buffer.alloc(32);
  const result = new Map();
  for (const [name, Contract] of [
    ['v3r1', WalletContractV3R1],
    ['v3r2', WalletContractV3R2],
    ['v4r2', WalletContractV4]
  ]) {
    const wallet = Contract.create({ workchain: 0, publicKey, walletId: DEFAULT_WALLET_ID });
    result.set(wallet.init.code.hash().toString('hex'), name);
  }
  return result;
}

const KNOWN_WALLET_CODE_HASHES = walletCodeHashes();

function proofDigest(address, proof) {
  const domainBytes = Buffer.from(String(proof.domain.value), 'utf8');
  if (proof.domain.lengthBytes !== domainBytes.length) throw new Error('TON_PROOF_DOMAIN_LENGTH_MISMATCH');
  const workchain = Buffer.alloc(4);
  workchain.writeInt32BE(address.workChain, 0);
  const domainLength = Buffer.alloc(4);
  domainLength.writeUInt32LE(domainBytes.length, 0);
  const timestamp = Buffer.alloc(8);
  timestamp.writeBigUInt64LE(BigInt(proof.timestamp), 0);
  const message = Buffer.concat([
    PROOF_PREFIX,
    workchain,
    Buffer.from(address.hash),
    domainLength,
    domainBytes,
    timestamp,
    Buffer.from(String(proof.payload), 'utf8')
  ]);
  return sha256(Buffer.concat([
    Buffer.from([0xff, 0xff]),
    CONNECT_PREFIX,
    sha256(message)
  ]));
}

function extractKnownWalletPublicKey(stateInit) {
  const codeHash = stateInit.code.hash().toString('hex');
  if (!KNOWN_WALLET_CODE_HASHES.has(codeHash)) return null;
  const data = stateInit.data.beginParse();
  data.loadUint(32); // seqno
  data.loadUint(32); // wallet_id
  return data.loadBuffer(32);
}

function verifyTonProof({ address: addressText, network, walletStateInit, proof, expectedDomain, expectedPayload }) {
  if (String(network) !== SUPPORTED_NETWORK) throw new Error('TON_PROOF_NETWORK_NOT_ALLOWED');
  if (!proof || typeof proof !== 'object') throw new Error('TON_PROOF_MISSING');
  if (String(proof.domain?.value || '') !== String(expectedDomain)) throw new Error('TON_PROOF_DOMAIN_MISMATCH');
  if (String(proof.payload || '') !== String(expectedPayload)) throw new Error('TON_PROOF_PAYLOAD_MISMATCH');
  if (!Number.isInteger(Number(proof.timestamp))) throw new Error('TON_PROOF_TIMESTAMP_INVALID');
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(proof.timestamp)) > PROOF_MAX_AGE_SEC) {
    throw new Error('TON_PROOF_EXPIRED');
  }
  if (typeof walletStateInit !== 'string' || walletStateInit.length < 20 || walletStateInit.length > 20000) {
    throw new Error('TON_PROOF_STATE_INIT_MISSING');
  }
  let address;
  let stateInit;
  try {
    address = Address.parse(String(addressText));
    stateInit = loadStateInit(Cell.fromBase64(walletStateInit).beginParse());
  } catch {
    throw new Error('TON_PROOF_ADDRESS_OR_STATE_INIT_INVALID');
  }
  const derived = contractAddress(address.workChain, stateInit);
  if (!derived.equals(address)) throw new Error('TON_PROOF_STATE_INIT_ADDRESS_MISMATCH');
  const publicKey = extractKnownWalletPublicKey(stateInit);
  if (!publicKey) throw new Error('TON_PROOF_WALLET_VERSION_NOT_SUPPORTED');
  const signature = Buffer.from(String(proof.signature || ''), 'base64');
  if (signature.length !== 64) throw new Error('TON_PROOF_SIGNATURE_INVALID');
  const valid = domainSignVerify({
    data: proofDigest(address, proof),
    signature,
    publicKey,
    domain: { type: 'empty' }
  });
  if (!valid) throw new Error('TON_PROOF_SIGNATURE_INVALID');
  return { address: address.toString({ urlSafe: true, bounceable: true }), publicKey: publicKey.toString('base64') };
}

function createProofPayload() {
  return crypto.randomBytes(32).toString('base64url');
}

module.exports = {
  PROOF_MAX_AGE_SEC,
  SUPPORTED_NETWORK,
  createProofPayload,
  verifyTonProof,
  proofDigest
};
