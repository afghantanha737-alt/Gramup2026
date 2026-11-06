'use strict';

const SPIN_PRIZES = Object.freeze([
  Object.freeze({ id: 'hashrate_boost_10_1h', kind: 'boost', amount: 10, label: '10% Mining Hashrate Boost', probability: 35 }),
  Object.freeze({ id: 'extra_spins_2', kind: 'spins', amount: 2, label: '2 Extra Spins', probability: 2.5 }),
  Object.freeze({ id: 'up_0', kind: 'points', amount: 0, label: '0 UP', probability: 2.5 }),
  Object.freeze({ id: 'up_50', kind: 'points', amount: 50, label: '+50 UP', probability: 25 }),
  Object.freeze({ id: 'up_100', kind: 'points', amount: 100, label: '+100 UP', probability: 15 }),
  Object.freeze({ id: 'up_250', kind: 'points', amount: 250, label: '+250 UP', probability: 20 })
]);

function defaultSpinPrizes() {
  return SPIN_PRIZES.map(prize => ({ ...prize }));
}

function normalizedSpinPrize(item) {
  return {
    id: String(item?.id ?? '').trim(),
    kind: String(item?.kind ?? ''),
    amount: Number(item?.amount),
    label: String(item?.label ?? '').trim(),
    probability: Number(item?.probability)
  };
}

function isValidSpinPrizePool(rawPrizes) {
  if (!Array.isArray(rawPrizes) || rawPrizes.length !== SPIN_PRIZES.length) return false;
  const prizes = rawPrizes.map(normalizedSpinPrize);
  const totalProbability = prizes.reduce((sum, prize) => sum + prize.probability, 0);
  if (!Number.isFinite(totalProbability) || Math.abs(totalProbability - 100) > 0.000001) return false;

  return prizes.every((prize, index) => {
    const expected = SPIN_PRIZES[index];
    return prize.id === expected.id
      && prize.kind === expected.kind
      && prize.amount === expected.amount
      && prize.label === expected.label
      && Number.isFinite(prize.probability)
      && prize.probability >= 0
      && prize.probability <= 100;
  });
}

function normalizeSpinPrizes(rawPrizes) {
  if (!isValidSpinPrizePool(rawPrizes)) return defaultSpinPrizes();
  return rawPrizes.map(normalizedSpinPrize);
}

module.exports = { SPIN_PRIZES, defaultSpinPrizes, isValidSpinPrizePool, normalizeSpinPrizes };
