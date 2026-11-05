'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('public/admin.html', 'utf8');
const match = html.match(/function normalizeBroadcastInlineLink\(value\) \{[\s\S]*?\n\}\n\nfunction escapeBroadcastHtmlAttribute\(value\) \{[\s\S]*?\n\}\n\nfunction formatBroadcastMessage\(format\) \{[\s\S]*?\n\}\n\nasync function sendBroadcast/);
assert.ok(match, 'the admin formatting helpers and toolbar handler must exist');
const functionSource = match[0].replace(/\n\nasync function sendBroadcast$/, '');

let textarea = {
  value: 'Hello world',
  selectionStart: 6,
  selectionEnd: 11,
  focus() {},
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
};
const message = { textContent: '' };
const sandbox = {
  URL,
  window: { prompt: () => 'https://example.com/path?q=1&x=2' },
  document: {
    getElementById(id) {
      if (id === 'broadcastText') return textarea;
      if (id === 'broadcastMsg') return message;
      return null;
    }
  }
};
vm.runInNewContext(functionSource, sandbox);

sandbox.formatBroadcastMessage('bold');
assert.equal(textarea.value, 'Hello <b>world</b>', 'Bold wraps exactly the selected text');
assert.equal(textarea.value.slice(textarea.selectionStart, textarea.selectionEnd), 'world');

textarea = {
  value: 'Hi',
  selectionStart: 2,
  selectionEnd: 2,
  focus() {},
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
};
sandbox.formatBroadcastMessage('code');
assert.equal(textarea.value, 'Hi<code>code</code>', 'Code inserts a default placeholder at the caret when nothing is selected');
assert.equal(textarea.value.slice(textarea.selectionStart, textarea.selectionEnd), 'code');

textarea = {
  value: 'Open this now',
  selectionStart: 5,
  selectionEnd: 9,
  focus() {},
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
};
sandbox.formatBroadcastMessage('link');
assert.equal(textarea.value, 'Open <a href="https://example.com/path?q=1&amp;x=2">this</a> now');
assert.equal(textarea.value.slice(textarea.selectionStart, textarea.selectionEnd), 'this');

console.log('PASS — broadcast toolbar wraps selected text, inserts placeholders, and adds escaped inline links');
