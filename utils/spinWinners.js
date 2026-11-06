'use strict';

const WINNABLE_PRIZE_IDS = new Set([
  'hashrate_boost_10_1h',
  'up_50',
  'up_100',
  'up_250',
  'gram_005'
]);

function anonymizeWinnerName(firstName) {
  const name = String(firstName || '').normalize('NFC').trim();
  const initial = Array.from(name)[0];
  return initial ? `${initial.toLocaleUpperCase()}***` : 'User ***';
}

function toRecentSpinWinner(entry) {
  const description = String(entry?.description || '').trim();
  const separator = description.lastIndexOf(':');
  if (separator < 0 || !entry?.user) return null;

  const prizeId = description.slice(separator + 1).trim();
  const amount = Number(entry.amount);
  if (!WINNABLE_PRIZE_IDS.has(prizeId) || !Number.isFinite(amount) || amount <= 0) return null;

  return {
    name: anonymizeWinnerName(entry.user.firstName),
    prizeId,
    amount
  };
}

module.exports = { anonymizeWinnerName, toRecentSpinWinner };
