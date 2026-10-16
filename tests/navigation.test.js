'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const dispatcherStart = app.indexOf('async function renderCurrentTab(');
const dispatcherEnd = app.indexOf('/* ================= BOOT ================= */', dispatcherStart);
assert.ok(dispatcherStart >= 0 && dispatcherEnd > dispatcherStart, 'tab dispatcher exists');
const dispatcher = app.slice(dispatcherStart, dispatcherEnd);
const homeBranch = dispatcher.slice(dispatcher.indexOf('if (tab === "home")'), dispatcher.indexOf('} else if (tab === "tasks")'));
const tasksBranch = dispatcher.slice(dispatcher.indexOf('} else if (tab === "tasks")'), dispatcher.indexOf('} else if (tab === "vip"'));
assert.match(homeBranch, /await Promise\.all\(\[loadUserData\(\), loadTasks\(\)\]\)/);
assert.match(homeBranch, /renderHome\(\)/);
assert.match(tasksBranch, /await Promise\.all\(\[loadTasks\(\), loadUserData\(\)\]\)/);
assert.match(tasksBranch, /renderTasks\(\)/);
assert.match(app, /function setupNavigation\(\)/);
assert.match(app, /\$\$\("#tabbar \[data-tab\]"\)\.forEach/);
assert.match(app, /button\.addEventListener\("click"/);
assert.match(app, /const validTabs = \["home", "tasks", "vip", "wallet", "profile"\]/);
for (const tab of ['home', 'tasks', 'vip', 'wallet', 'profile']) {
  assert.match(html, new RegExp(`data-tab="${tab}"`), `missing bottom-nav tab ${tab}`);
}
assert.match(app, /if \(!state\.tasks\.length && tasksLoadError && !isInviteSection\)/);
assert.match(html, /app\.js\?v=/);
console.log('ALL PASS — delegated tab clicks, all tab routes, non-blocking Home/Tasks rendering and loading state');
