const fs = require('fs');
const assert = require('assert');

const app = fs.readFileSync('public/js/app.js', 'utf8');
const css = fs.readFileSync('public/css/style.css', 'utf8');

const inviteStart = app.indexOf('function renderTasks()');
const inviteEnd = app.indexOf('function taskIconMarkup', inviteStart);
const inviteSource = app.slice(inviteStart, inviteEnd);
assert.ok(!inviteSource.includes('squadsHtml'), 'Invite Friends no longer injects the Groups section');
assert.match(app, /setProfileView\('groups'\)/, 'Profile exposes a Groups navigation action');
assert.match(app, /function renderProfileGroups\(\)/, 'Profile has a Groups view');
assert.match(app, /view === "groups".*loadSquads/s, 'Groups data loads when the Profile Groups view opens');
assert.match(app, /referralTaskItem \$\{action \? "has-action" : "no-action"\}/, 'Milestone cards expose action layout state');
assert.match(css, /referralTaskItem\.has-action[^\n]*grid-column: 3/, 'Milestone actions occupy a dedicated column');
assert.match(css, /rf-network-row \{ display: grid; grid-template-columns: minmax\(0, 1fr\) minmax\(72px, auto\) minmax\(78px, auto\)/, 'Commission network stats use stable columns');

console.log('PASS — Invite Friends Groups removal, Profile Groups navigation, and referral card alignment');
