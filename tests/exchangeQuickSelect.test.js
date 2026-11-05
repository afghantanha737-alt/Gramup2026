'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const appSource = fs.readFileSync('public/js/app.js', 'utf8');
const sectionStart = appSource.indexOf('let exchangeDirection = "points_to_gram";');
const sectionEnd = appSource.indexOf('/* ---- TON Mainnet Native GRAM deposit ---- */', sectionStart);
assert.ok(sectionStart >= 0 && sectionEnd > sectionStart, 'Exchange logic section must exist');
const exchangeSection = appSource.slice(sectionStart, sectionEnd);

const input = {
  value: '',
  dataset: {},
  setAttribute(name, value) { this[name] = value; },
  focus() {},
  setSelectionRange() {}
};
const preview = { textContent: '' };
const error = { textContent: '' };
const quickButtons = Array.from({ length: 4 }, () => ({ disabled: false }));
const elements = {
  '#exchangePoints': input,
  '#exchangePreview': preview,
  '#exchangeError': error,
  '#exchangeDirPTG': { classList: { toggle() {} } },
  '#exchangeDirGTP': { classList: { toggle() {} } },
  '#exchangeAmountLabel': { dataset: {}, textContent: '' },
  '#exchangeTitle': { dataset: {}, textContent: '' }
};
const state = {
  points: 100.999,
  gramBalance: 40.555555555,
  chainGramBalance: 70.123456789,
  rate: 0.5
};
const window = {
  gramupWallet: {
    isConnected: () => true,
    isProofVerified: () => true
  }
};
const context = vm.createContext({
  state,
  window,
  document: {
    querySelectorAll(selector) {
      return selector === '#exchangeQuickAmounts .exchangeQuickBtn' ? quickButtons : [];
    }
  },
  $: selector => elements[selector] || null,
  t: key => key,
  formatNumber: (value, precision) => Number(value).toFixed(precision),
  formatPoints: value => Number(value).toFixed(3),
  console
});
vm.runInContext(exchangeSection, context);

for (const [percent, expected] of [[25, '25.249'], [50, '50.499'], [75, '75.749'], [100, '100.999']]) {
  vm.runInContext(`setExchangeAmountPercent(${percent})`, context);
  assert.equal(input.value, expected, `${percent}% must use the available UP balance`);
  assert.match(preview.textContent, /GRAM$/, 'UP-to-GRAM selection updates the receive preview');
  assert.equal(error.textContent, '', 'the selected amount stays within the UP balance');
}

vm.runInContext("setExchangeDirection('gram_to_points')", context);
for (const [percent, expected] of [
  [25, '17.530864197'],
  [50, '35.061728394'],
  [75, '52.592592591'],
  [100, '70.123456789']
]) {
  vm.runInContext(`setExchangeAmountPercent(${percent})`, context);
  assert.equal(input.value, expected, `${percent}% must use the verified connected-wallet GRAM balance when it is the larger available source`);
  assert.ok(preview.textContent.startsWith('exchange_result_label_points:'), 'GRAM-to-UP selection updates the receive preview');
  assert.equal(error.textContent, '', 'the selected amount stays within the available GRAM source');
}

assert.equal(vm.runInContext('isExchangeAmountValid(-1)', context), false, 'negative amounts are invalid');
assert.equal(vm.runInContext('isExchangeAmountValid(70.123456790)', context), false, 'amounts above the available GRAM balance are invalid');
assert.equal(vm.runInContext('isExchangeAmountValid(70.123456789)', context), true, 'the exact available GRAM balance is valid');
input.value = '-1';
vm.runInContext('updateExchangePreview()', context);
assert.equal(error.textContent, 'error_generic', 'negative input displays a validation error');
input.value = '70.123456790';
vm.runInContext('updateExchangePreview()', context);
assert.equal(error.textContent, 'error_generic', 'over-balance input displays a validation error');

vm.runInContext('window.gramupWallet.isConnected = () => false; window.gramupWallet.isProofVerified = () => false;', context);
state.chainGramBalance = 70.123456789;
vm.runInContext('setExchangeAmountPercent(100)', context);
assert.equal(input.value, '40.555555555', 'without a verified wallet, MAX uses only the internal GRAM balance');

state.points = 0;
vm.runInContext("setExchangeDirection('points_to_gram')", context);
assert.ok(quickButtons.every(button => button.disabled), 'quick-select buttons disable when the active token balance is zero');

const markup = fs.readFileSync('public/index.html', 'utf8');
for (const label of ['25%', '50%', '75%', 'MAX']) assert.ok(markup.includes(`>${label}</button>`), `the modal includes ${label}`);

console.log('PASS — Exchange percentages/MAX use active-direction balances, refresh preview, and enforce nonnegative balance limits');
