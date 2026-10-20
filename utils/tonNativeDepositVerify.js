'use strict';

const crypto = require('crypto');

// TON Mainnet v3 only. Native GRAM is the chain's native coin, not a Jetton.
const TONCENTER_BASE = 'https://toncenter.com/api/v3';
const NANO_GRAM = 1000000000n;
const MAX_EXACT_GRAM_AMOUNT = Number.MAX_SAFE_INTEGER / 1e9;
const REQUEST_TIMEOUT_MS = 12000;
const PUBLIC_API_MIN_INTERVAL_MS = 1100;
let lastPublicRequestAt = 0;
let publicRequestTail = Promise.resolve();

function crc16Xmodem(buffer) {
  let crc = 0;
  for (const byte of buffer) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function normalizeTonAddress(value) {
  const text = String(value || '').trim();
  const raw = text.match(/^(-?\d+):([a-f\d]{64})$/i);
  if (raw) {
    const workchain = Number(raw[1]);
    if (!Number.isInteger(workchain) || workchain < -1 || workchain > 0) return null;
    return `${workchain}:${raw[2].toLowerCase()}`;
  }

  if (!/^[a-z\d+/_-]{48}$/i.test(text)) return null;
  const encoded = text.replace(/-/g, '+').replace(/_/g, '/');
  let bytes;
  try { bytes = Buffer.from(encoded, 'base64'); } catch { return null; }
  if (bytes.length !== 36) return null;
  const tag = bytes[0] & 0x7f;
  const testOnly = (bytes[0] & 0x80) !== 0;
  if ((tag !== 0x11 && tag !== 0x51) || testOnly) return null;
  const expectedChecksum = crc16Xmodem(bytes.subarray(0, 34));
  const actualChecksum = (bytes[34] << 8) | bytes[35];
  if (expectedChecksum !== actualChecksum) return null;
  const workchain = bytes.readInt8(1);
  if (workchain < -1 || workchain > 0) return null;
  return `${workchain}:${bytes.subarray(2, 34).toString('hex')}`;
}

function normalizeTonTxHash(value) {
  const text = String(value || '').trim().replace(/^0x/i, '');
  if (/^[a-f\d]{64}$/i.test(text)) return text.toLowerCase();
  if (!/^[a-z\d+/_-]{43,44}={0,2}$/i.test(text)) return null;
  try {
    const bytes = Buffer.from(text.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    return bytes.length === 32 ? bytes.toString('hex') : null;
  } catch {
    return null;
  }
}

function amountToNanoGram(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_EXACT_GRAM_AMOUNT) return null;
  let text = String(amount).toLowerCase();
  if (text.includes('e')) {
    const [mantissa, exponentText] = text.split('e');
    const exponent = Number(exponentText);
    if (!Number.isInteger(exponent)) return null;
    const [integerPart, fractionalPart = ''] = mantissa.split('.');
    const digits = `${integerPart}${fractionalPart}`;
    const decimalPosition = integerPart.length + exponent;
    if (decimalPosition <= 0) text = `0.${'0'.repeat(-decimalPosition)}${digits}`;
    else if (decimalPosition >= digits.length) text = `${digits}${'0'.repeat(decimalPosition - digits.length)}`;
    else text = `${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`;
  }
  const match = text.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  const whole = match[1];
  const fraction = match[2] || '';
  if (fraction.length > 9 && /[1-9]/.test(fraction.slice(9))) return null;
  try {
    const raw = BigInt(`${whole}${fraction.slice(0, 9).padEnd(9, '0')}`);
    return raw > 0n ? raw : null;
  } catch {
    return null;
  }
}

function nanoGramToNumber(value) {
  let raw;
  try { raw = BigInt(String(value)); } catch { return null; }
  if (raw <= 0n || raw > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  const whole = raw / NANO_GRAM;
  const remainder = raw % NANO_GRAM;
  const fraction = remainder.toString().padStart(9, '0').replace(/0+$/, '');
  const amount = Number(fraction ? `${whole}.${fraction}` : String(whole));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function collectTextValues(value, out = [], depth = 0) {
  if (depth > 8 || value == null) return out;
  if (typeof value === 'string') {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectTextValues(item, out, depth + 1));
    return out;
  }
  if (typeof value === 'object') {
    for (const child of Object.values(value)) collectTextValues(child, out, depth + 1);
  }
  return out;
}

function hasExactReference(inMessage, reference) {
  const expected = String(reference || '').trim();
  if (!expected) return false;
  const decoded = inMessage?.message_content?.decoded;
  return collectTextValues(decoded).some(text => text.trim() === expected);
}

async function sleep(ms) {
  if (ms > 0) await new Promise(resolve => setTimeout(resolve, ms));
}

async function withPublicRateLimit(work) {
  const previous = publicRequestTail;
  let release;
  publicRequestTail = new Promise(resolve => { release = resolve; });
  await previous;
  try {
    await sleep(PUBLIC_API_MIN_INTERVAL_MS - (Date.now() - lastPublicRequestAt));
    return await work();
  } finally {
    lastPublicRequestAt = Date.now();
    release();
  }
}

async function tonCenterGet(path, params, { fetchImpl = globalThis.fetch, apiKey = process.env.TONCENTER_API_KEY } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('TON_PROVIDER_UNAVAILABLE');
  const url = new URL(`${TONCENTER_BASE}${path}`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const headers = { accept: 'application/json' };
  if (apiKey) headers['X-API-Key'] = apiKey;
  const request = async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetchImpl(url.toString(), { method: 'GET', headers, signal: controller.signal });
      if (!response.ok) throw new Error('TON_PROVIDER_UNAVAILABLE');
      return await response.json();
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('TON_PROVIDER_TIMEOUT');
      if (error?.message === 'TON_PROVIDER_UNAVAILABLE') throw error;
      throw new Error('TON_PROVIDER_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
    }
  };
  return apiKey ? request() : withPublicRateLimit(request);
}

function parseTimestamp(value) {
  const timestamp = Number(value);
  return Number.isInteger(timestamp) && timestamp > 0 ? timestamp : null;
}

function isFailedTransaction(transaction) {
  const description = transaction?.description || {};
  return description.aborted === true
    || description.compute_ph?.success === false
    || description.action?.success === false;
}

function hasMasterchainFinality(transaction) {
  const seqno = Number(transaction?.mc_block_seqno);
  return Number.isInteger(seqno) && seqno > 0;
}

function isIncomingTo(transaction, normalizedDepositAddress) {
  const message = transaction?.in_msg;
  return normalizeTonAddress(transaction?.account) === normalizedDepositAddress
    && normalizeTonAddress(message?.destination) === normalizedDepositAddress;
}

function parseNativeAmount(inMessage) {
  try {
    const raw = BigInt(String(inMessage?.value));
    if (raw <= 0n) return null;
    const amount = nanoGramToNumber(raw);
    return amount == null ? null : { raw, amount };
  } catch {
    return null;
  }
}

function hasPositiveNanoGram(value) {
  try { return BigInt(String(value)) > 0n; } catch { return false; }
}

function verifyIncomingTransaction(transaction, { txHash, depositAddress, reference }) {
  const incoming = transaction?.in_msg;
  if (!isIncomingTo(transaction, depositAddress)) {
    return { status: 'mismatch', code: 'DEPOSIT_DESTINATION_MISMATCH' };
  }
  if (isFailedTransaction(transaction) || incoming?.bounced === true) {
    return { status: 'mismatch', code: 'TON_TRANSACTION_FAILED' };
  }
  if (transaction?.description?.aborted !== false || !hasMasterchainFinality(transaction)) {
    return { status: 'pending', code: 'TON_TRANSACTION_NOT_FINAL' };
  }
  if (!hasExactReference(incoming, reference)) {
    return { status: 'mismatch', code: 'DEPOSIT_REFERENCE_MISMATCH' };
  }

  const nativeAmount = parseNativeAmount(incoming);
  if (!nativeAmount) return { status: 'mismatch', code: 'INVALID_NATIVE_GRAM_AMOUNT' };

  const canonicalHash = normalizeTonTxHash(transaction?.hash);
  if (!canonicalHash) return { status: 'pending', code: 'TON_TRANSACTION_NOT_INDEXED' };
  const timestamp = parseTimestamp(transaction?.now) || parseTimestamp(incoming?.created_at) || Math.floor(Date.now() / 1000);

  return {
    status: 'verified',
    txHash: canonicalHash,
    submittedTxHash: txHash,
    messageHash: normalizeTonTxHash(incoming?.hash_norm || incoming?.hash) || '',
    amountRaw: nativeAmount.raw.toString(),
    amount: nativeAmount.amount,
    sourceAddress: normalizeTonAddress(incoming?.source) || '',
    confirmedAt: new Date(timestamp * 1000)
  };
}

async function transactionsByHash(txHash, options) {
  const result = await tonCenterGet('/transactions', { hash: txHash, limit: 10 }, options);
  return Array.isArray(result?.transactions) ? result.transactions : [];
}

async function transactionsByMessageHash(messageHash, options) {
  const result = await tonCenterGet('/transactionsByMessage', {
    msg_hash: messageHash,
    direction: 'in',
    limit: 10
  }, options);
  return Array.isArray(result?.transactions) ? result.transactions : [];
}

async function transactionsByAccount(account, options) {
  const result = await tonCenterGet('/transactions', { account, limit: 50 }, options);
  return Array.isArray(result?.transactions) ? result.transactions : [];
}

async function getNativeGramBalance(address, options = {}) {
  const normalizedAddress = normalizeTonAddress(address);
  if (!normalizedAddress) return { status: 'mismatch', code: 'INVALID_WALLET_ADDRESS' };
  const result = await tonCenterGet('/accountStates', { address: normalizedAddress, include_boc: false }, options);
  const account = Array.isArray(result?.accounts)
    ? result.accounts.find(item => normalizeTonAddress(item?.address) === normalizedAddress) || result.accounts[0]
    : null;
  if (!account || account.balance === undefined || account.balance === null) {
    return { status: 'mismatch', code: 'TON_ACCOUNT_NOT_FOUND' };
  }
  let raw;
  try {
    raw = BigInt(String(account.balance));
  } catch {
    return { status: 'mismatch', code: 'TON_BALANCE_INVALID' };
  }
  if (raw < 0n || raw > BigInt(Number.MAX_SAFE_INTEGER)) {
    return { status: 'mismatch', code: 'TON_BALANCE_UNSAFE' };
  }
  const amount = Number(raw) / Number(NANO_GRAM);
  return { status: 'ok', address: normalizedAddress, balanceRaw: raw.toString(), balance: amount };
}

async function findIncomingNativeGramTransferByReference({ depositAddress, reference }, options = {}) {
  const normalizedDeposit = normalizeTonAddress(depositAddress);
  if (!normalizedDeposit || !String(reference || '').trim()) {
    return { status: 'mismatch', code: 'INVALID_DEPOSIT_DETAILS' };
  }
  const transactions = await transactionsByAccount(normalizedDeposit, options);
  const candidate = transactions.find(transaction => isIncomingTo(transaction, normalizedDeposit)
    && hasExactReference(transaction?.in_msg, reference));
  if (!candidate) return { status: 'pending', code: 'TON_TRANSACTION_NOT_INDEXED' };
  const txHash = normalizeTonTxHash(candidate?.hash);
  if (!txHash) return { status: 'pending', code: 'TON_TRANSACTION_NOT_INDEXED' };
  return verifyIncomingTransaction(candidate, { txHash, depositAddress: normalizedDeposit, reference });
}

async function verifyNativeGramTransfer({ txHash, depositAddress, reference }, options = {}) {
  const normalizedHash = normalizeTonTxHash(txHash);
  const normalizedDeposit = normalizeTonAddress(depositAddress);
  if (!normalizedHash || !normalizedDeposit || !String(reference || '').trim()) {
    return { status: 'mismatch', code: 'INVALID_DEPOSIT_DETAILS' };
  }

  const transactions = await transactionsByHash(normalizedHash, options);
  const matchingTransactions = transactions.filter(item => normalizeTonTxHash(item?.hash) === normalizedHash);

  // Most explorers expose the receiving-wallet transaction hash directly.
  const directIncoming = matchingTransactions.find(item => isIncomingTo(item, normalizedDeposit));
  if (directIncoming) {
    return verifyIncomingTransaction(directIncoming, {
      txHash: normalizedHash,
      depositAddress: normalizedDeposit,
      reference
    });
  }

  // If the user supplies the sender transaction hash, resolve its outgoing internal
  // message to the actual transaction recorded by the receiving project wallet.
  const candidateMessageHashes = new Set();
  for (const transaction of matchingTransactions) {
    if (isFailedTransaction(transaction)) return { status: 'mismatch', code: 'TON_TRANSACTION_FAILED' };
    for (const message of Array.isArray(transaction?.out_msgs) ? transaction.out_msgs : []) {
      if (normalizeTonAddress(message?.destination) !== normalizedDeposit || message?.bounced === true) continue;
      const valueIsPositive = hasPositiveNanoGram(message?.value);
      const messageHash = normalizeTonTxHash(message?.hash_norm || message?.hash);
      if (valueIsPositive && messageHash) candidateMessageHashes.add(messageHash);
    }
  }

  // A 64-hex value may also be the internal message hash itself. This lookup is
  // read-only and the resulting transaction is still checked against the wallet,
  // native value, comment reference, success and masterchain inclusion.
  if (!matchingTransactions.length) candidateMessageHashes.add(normalizedHash);

  const incomingCandidates = [];
  for (const messageHash of candidateMessageHashes) {
    const related = await transactionsByMessageHash(messageHash, options);
    for (const transaction of related) {
      const incomingHash = normalizeTonTxHash(transaction?.in_msg?.hash_norm || transaction?.in_msg?.hash);
      if (incomingHash && incomingHash !== messageHash) continue;
      if (isIncomingTo(transaction, normalizedDeposit)) incomingCandidates.push(transaction);
    }
  }

  if (!incomingCandidates.length) {
    return { status: 'pending', code: 'TON_TRANSACTION_NOT_INDEXED' };
  }

  const exactReferenceCandidate = incomingCandidates.find(item => hasExactReference(item?.in_msg, reference));
  const chosen = exactReferenceCandidate || incomingCandidates[0];
  return verifyIncomingTransaction(chosen, {
    txHash: normalizedHash,
    depositAddress: normalizedDeposit,
    reference
  });
}

function createDepositReference() {
  return `GRAMUP:${crypto.randomBytes(20).toString('hex').toUpperCase()}`;
}

module.exports = {
  TONCENTER_BASE,
  NANO_GRAM,
  MAX_EXACT_GRAM_AMOUNT,
  normalizeTonAddress,
  normalizeTonTxHash,
  amountToNanoGram,
  nanoGramToNumber,
  collectTextValues,
  hasExactReference,
  hasMasterchainFinality,
  verifyNativeGramTransfer,
  findIncomingNativeGramTransferByReference,
  getNativeGramBalance,
  createDepositReference
};
