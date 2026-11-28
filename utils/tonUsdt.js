'use strict';

const crypto = require('crypto');
const { beginCell, Address } = require('@ton/core');
const {
  TONCENTER_BASE,
  TONAPI_BASE,
  normalizeTonAddress,
  normalizeTonTxHash,
  collectTextValues
} = require('./tonNativeDepositVerify');

const USDT_MASTER_ADDRESS = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';
const USDT_DECIMALS = 6;
const USDT_BASE_UNIT = 10n ** BigInt(USDT_DECIMALS);
const UP_PER_USDT = 10000;
const TON_MAINNET_CHAIN = '-239';
const JETTON_TRANSFER_OPCODE = 0x0f8a7ea5;
const TONCENTER_REQUEST_TIMEOUT_MS = 12000;

function usdtToBaseUnits(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+(?:\.\d{1,6})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  try {
    const raw = BigInt(whole) * USDT_BASE_UNIT + BigInt(fraction.padEnd(USDT_DECIMALS, '0') || 0);
    return raw > 0n ? raw : null;
  } catch {
    return null;
  }
}

function baseUnitsToUsdt(raw) {
  let value;
  try { value = BigInt(String(raw)); } catch { return null; }
  if (value < 0n) return null;
  const whole = value / USDT_BASE_UNIT;
  const fraction = (value % USDT_BASE_UNIT).toString().padStart(USDT_DECIMALS, '0').replace(/0+$/, '');
  const numeric = Number(fraction ? `${whole}.${fraction}` : whole.toString());
  return Number.isFinite(numeric) ? numeric : null;
}

function upToUsdt(up) {
  const amount = Number(up);
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;
  return amount / UP_PER_USDT;
}

function usdtToUp(usdt) {
  const raw = usdtToBaseUnits(usdt);
  if (raw == null) return null;
  const up = (raw * BigInt(UP_PER_USDT)) / USDT_BASE_UNIT;
  return up <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(up) : null;
}

function normalizeReferenceText(transfer) {
  const values = [transfer?.decoded_forward_payload, transfer?.forward_payload, transfer?.decoded_custom_payload, transfer?.custom_payload];
  return collectTextValues(values).map(value => String(value).trim());
}

function hasReference(transfer, reference) {
  const expected = String(reference || '').trim();
  return Boolean(expected && normalizeReferenceText(transfer).some(text => text === expected || text.includes(expected)));
}

async function tonCenterGet(path, params = {}, { fetchImpl = globalThis.fetch, apiKey = process.env.TONCENTER_API_KEY } = {}) {
  const url = new URL(`${TONCENTER_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TONCENTER_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { headers: { accept: 'application/json', ...(apiKey ? { 'X-API-Key': apiKey } : {}) }, signal: controller.signal });
    if (!response.ok) {
      if (path === '/jetton/wallets' && params?.owner_address && [401, 403, 429].includes(response.status)) {
        const fallbackUrl = new URL(`${TONAPI_BASE}/accounts/${encodeURIComponent(String(params.owner_address))}/jettons`);
        const fallback = await fetchImpl(fallbackUrl, { headers: { accept: 'application/json' }, signal: controller.signal });
        if (!fallback.ok) throw new Error('TON_PROVIDER_UNAVAILABLE');
        const payload = await fallback.json();
        if (!Array.isArray(payload?.balances)) throw new Error('TON_PROVIDER_UNAVAILABLE');
        return {
          jetton_wallets: payload.balances.map(item => ({
            address: item?.wallet_address?.address || '',
            owner: params.owner_address,
            jetton: item?.jetton?.address || '',
            balance: item?.balance
          }))
        };
      }
      throw new Error('TON_PROVIDER_UNAVAILABLE');
    }
    return response.json();
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('TON_PROVIDER_TIMEOUT');
    if (error?.message === 'TON_PROVIDER_UNAVAILABLE') throw error;
    throw new Error('TON_PROVIDER_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
  }
}

async function getUsdtJettonWallet(ownerAddress, options = {}) {
  const owner = normalizeTonAddress(ownerAddress);
  if (!owner) return null;
  const data = await tonCenterGet('/jetton/wallets', { owner_address: owner, jetton_address: USDT_MASTER_ADDRESS, limit: 10 }, options);
  const wallets = Array.isArray(data?.jetton_wallets) ? data.jetton_wallets : Array.isArray(data?.jetton_wallets?.items) ? data.jetton_wallets.items : [];
  const match = wallets.find(wallet => normalizeTonAddress(wallet?.owner) === owner && normalizeTonAddress(wallet?.jetton || wallet?.jetton_master) === normalizeTonAddress(USDT_MASTER_ADDRESS));
  return match ? normalizeTonAddress(match.address) : null;
}

async function getUsdtBalance(ownerAddress, options = {}) {
  const walletAddress = await getUsdtJettonWallet(ownerAddress, options);
  if (!walletAddress) return { status: 'ok', address: normalizeTonAddress(ownerAddress), jettonWallet: null, balanceRaw: '0', balance: 0 };
  const data = await tonCenterGet('/jetton/wallets', { address: walletAddress, limit: 1 }, options);
  const wallet = Array.isArray(data?.jetton_wallets) ? data.jetton_wallets[0] : null;
  const raw = String(wallet?.balance ?? '0');
  const balance = baseUnitsToUsdt(raw);
  if (balance == null) return { status: 'mismatch', code: 'USDT_BALANCE_INVALID' };
  return { status: 'ok', address: normalizeTonAddress(ownerAddress), jettonWallet: walletAddress, balanceRaw: raw, balance };
}

function buildUsdtTransferBody({ destination, amountRaw, queryId = 0n, responseDestination, forwardPayload }) {
  const destinationAddress = Address.parse(destination);
  const responseAddress = Address.parse(responseDestination || destination);
  let builder = beginCell()
    .storeUint(JETTON_TRANSFER_OPCODE, 32)
    .storeUint(BigInt(queryId), 64)
    .storeCoins(BigInt(amountRaw))
    .storeAddress(destinationAddress)
    .storeAddress(responseAddress)
    .storeBit(0)
    .storeCoins(1_000_000n);
  if (forwardPayload) {
    builder = builder.storeBit(1).storeRef(Buffer.isBuffer(forwardPayload) ? beginCell().storeBuffer(forwardPayload).endCell() : forwardPayload);
  } else {
    builder = builder.storeBit(0);
  }
  return builder.endCell().toBoc().toString('base64');
}

function isFinalTransaction(transaction) {
  return Number.isInteger(Number(transaction?.mc_block_seqno)) && Number(transaction.mc_block_seqno) > 0
    && transaction?.description?.aborted !== true
    && transaction?.description?.compute_ph?.success !== false
    && transaction?.description?.action?.success !== false;
}

async function transactionIsFinal(txHash, options = {}) {
  const normalized = normalizeTonTxHash(txHash);
  if (!normalized) return false;
  const data = await tonCenterGet('/transactions', { hash: normalized, limit: 10 }, options);
  const transactions = Array.isArray(data?.transactions) ? data.transactions : [];
  return transactions.some(item => normalizeTonTxHash(item?.hash) === normalized && isFinalTransaction(item) && item?.in_msg?.bounced !== true);
}

async function findUsdtTransfer({ txHash, ownerAddress, sourceAddress, destinationAddress, amountRaw, reference }, options = {}) {
  const owner = normalizeTonAddress(ownerAddress);
  const expectedSource = sourceAddress ? normalizeTonAddress(sourceAddress) : null;
  const expectedDestination = destinationAddress ? normalizeTonAddress(destinationAddress) : owner;
  const expectedAmount = BigInt(String(amountRaw));
  if (!owner || !expectedDestination || !Number.isInteger(Number(expectedAmount)) || expectedAmount <= 0n) return { status: 'mismatch', code: 'INVALID_USDT_DETAILS' };

  const data = await tonCenterGet('/jetton/transfers', {
    owner_address: owner,
    jetton_master: USDT_MASTER_ADDRESS,
    direction: 'in',
    limit: 100,
    sort: 'desc'
  }, options);
  const transfers = Array.isArray(data?.jetton_transfers) ? data.jetton_transfers : [];
  const normalizedHash = txHash ? normalizeTonTxHash(txHash) : null;
  const candidates = transfers.filter(item => !normalizedHash || normalizeTonTxHash(item?.transaction_hash) === normalizedHash);
  const candidate = candidates.find(item => {
    if (normalizeTonAddress(item?.jetton_master) !== normalizeTonAddress(USDT_MASTER_ADDRESS)) return false;
    if (normalizeTonAddress(item?.destination) !== expectedDestination) return false;
    if (expectedSource && normalizeTonAddress(item?.source) !== expectedSource) return false;
    if (BigInt(String(item?.amount || 0)) !== expectedAmount) return false;
    if (reference && !hasReference(item, reference)) return false;
    return item?.transaction_aborted !== true;
  });
  if (!candidate) return { status: candidates.length ? 'mismatch' : 'pending', code: candidates.length ? 'USDT_TRANSFER_MISMATCH' : 'TON_TRANSACTION_NOT_INDEXED' };
  if (!(await transactionIsFinal(candidate.transaction_hash, options))) return { status: 'pending', code: 'TON_TRANSACTION_NOT_FINAL' };
  return {
    status: 'verified',
    txHash: normalizeTonTxHash(candidate.transaction_hash),
    amountRaw: String(candidate.amount),
    amount: baseUnitsToUsdt(candidate.amount),
    sourceAddress: normalizeTonAddress(candidate.source) || '',
    destinationAddress: normalizeTonAddress(candidate.destination) || '',
    jettonMaster: normalizeTonAddress(candidate.jetton_master),
    confirmedAt: new Date((Number(candidate.transaction_now) || Math.floor(Date.now() / 1000)) * 1000)
  };
}

function createUsdtReference(prefix = 'GRAMUP') {
  return `${prefix}:USDT:${crypto.randomBytes(20).toString('hex').toUpperCase()}`;
}

module.exports = {
  USDT_MASTER_ADDRESS,
  USDT_DECIMALS,
  USDT_BASE_UNIT,
  UP_PER_USDT,
  TONAPI_BASE,
  TON_MAINNET_CHAIN,
  JETTON_TRANSFER_OPCODE,
  usdtToBaseUnits,
  baseUnitsToUsdt,
  upToUsdt,
  usdtToUp,
  tonCenterGet,
  getUsdtJettonWallet,
  getUsdtBalance,
  buildUsdtTransferBody,
  findUsdtTransfer,
  transactionIsFinal,
  createUsdtReference,
  hasReference
};
