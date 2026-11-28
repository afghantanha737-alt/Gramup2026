'use strict';

const { normalizeTonAddress, normalizeTonTxHash } = require('./tonNativeDepositVerify');
const { findUsdtTransfer, usdtToBaseUnits } = require('./tonUsdt');
const TONCENTER_API = 'https://toncenter.com/api/v3';
const REQUEST_TIMEOUT_MS = 12000;

async function fetchJson(url, fetchImpl = globalThis.fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    const data = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, data };
  } finally {
    clearTimeout(timer);
  }
}

async function verifyTonTransaction({ txHash, expectedAddress, expectedAmount, token, toleranceRatio = 0.02, fetchImpl = globalThis.fetch }) {
  const hash = String(txHash || '').trim();
  const expectedCanonicalAddress = normalizeTonAddress(expectedAddress);
  if (hash.length < 10) return { ok: false, reason: 'فرمت هش تراکنش نامعتبر است.' };
  if (!expectedCanonicalAddress) return { ok: false, reason: 'آدرس مقصد مورد انتظار نامعتبر است.' };

  if (String(token || '').toUpperCase() === 'USDT') {
    const amountRaw = usdtToBaseUnits(String(expectedAmount));
    if (amountRaw == null) return { ok: false, reason: 'مبلغ USDT مورد انتظار نامعتبر است.' };
    try {
      const verification = await findUsdtTransfer({
        // Preserve a shortened hexadecimal prefix; findUsdtTransfer resolves
        // it against provider events and returns the canonical full hash.
        txHash: hash,
        ownerAddress: expectedCanonicalAddress,
        destinationAddress: expectedCanonicalAddress,
        amountRaw
      }, { fetchImpl });
      if (verification.status !== 'verified') {
        return { ok: false, reason: verification.code === 'TON_TRANSACTION_NOT_FINAL' ? 'تراکنش USDT هنوز نهایی نشده است.' : 'تراکنش USDT با Master، مقصد یا مبلغ مورد انتظار مطابقت ندارد.', raw: verification };
      }
      return { ok: true, reason: 'تراکنش USDT روی TON با Master رسمی و مبلغ دقیق تایید شد.', fromAddress: verification.sourceAddress, raw: verification };
    } catch (error) {
      return { ok: false, reason: error?.message === 'TON_PROVIDER_TIMEOUT' ? 'اتصال به Explorer زمان زیادی طول کشید.' : 'اتصال به Explorer برقرار نشد.' };
    }
  }

  let result;
  try {
    result = await fetchJson(`${TONCENTER_API}/transactions?hash=${encodeURIComponent(hash)}&limit=10`, fetchImpl);
  } catch (error) {
    return { ok: false, reason: error?.name === 'AbortError' ? 'اتصال به Explorer زمان زیادی طول کشید.' : `اتصال به Explorer برقرار نشد: ${error.message}` };
  }
  if (!result.ok) return { ok: false, reason: `Explorer پاسخ نامعتبر داد (کد ${result.status}).` };
  const tx = Array.isArray(result.data?.transactions) ? result.data.transactions[0] : null;
  if (!tx) return { ok: false, reason: 'تراکنشی با این هش روی شبکه پیدا نشد.' };
  if (tx.description?.aborted === true || tx.description?.compute_ph?.success === false || tx.description?.action?.success === false) {
    return { ok: false, reason: 'تراکنش ناموفق است.', raw: tx };
  }
  if (!(Number(tx.mc_block_seqno) > 0) || tx.in_msg?.bounced === true) return { ok: false, reason: 'تراکنش هنوز نهایی نشده است.', raw: tx };
  const matchingMsg = (Array.isArray(tx.out_msgs) ? tx.out_msgs : []).find(message => normalizeTonAddress(message.destination) === expectedCanonicalAddress);
  if (!matchingMsg) return { ok: false, reason: 'آدرس مقصد تراکنش با آدرس کاربر مطابقت ندارد.', raw: tx };
  const sentTon = Number(matchingMsg.value || 0) / 1e9;
  if (expectedAmount && Math.abs(sentTon - expectedAmount) / expectedAmount > toleranceRatio) return { ok: false, reason: `مبلغ تراکنش (${sentTon} TON) با مبلغ درخواست مطابقت ندارد.`, raw: tx };
  return { ok: true, reason: 'تراکنش TON با موفقیت روی زنجیره تایید شد.', fromAddress: normalizeTonAddress(tx.account || tx.in_msg?.source || ''), raw: tx };
}

function legacyTonTxHashMatcher(value) {
  const hash = String(value || '').trim();
  return /^[a-f\d]{64}$/i.test(hash) ? new RegExp(`^${hash}$`, 'i') : hash;
}

module.exports = { verifyTonTransaction, normalizeTonTxHash, legacyTonTxHashMatcher };
