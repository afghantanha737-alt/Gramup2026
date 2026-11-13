'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('public/js/app.js', 'utf8');
const css = fs.readFileSync('public/css/style.css', 'utf8');
const i18n = fs.readFileSync('public/js/i18n.js', 'utf8');
const user = fs.readFileSync('models/User.js', 'utf8');
const auth = fs.readFileSync('routes/auth.js', 'utf8');
const worker = fs.readFileSync('utils/vipMiningCycleNotification.js', 'utf8');

assert.match(app, /profile_settings_title/);
assert.match(app, /setProfileTheme\('dark'\)/);
assert.match(app, /setBotReminder\(true\)/);
assert.match(app, /setSound\(false\)/);
assert.match(app, /\/api\/auth\/settings/);
assert.doesNotMatch(app, /profileThemePicker|themeChoice/);
assert.match(css, /\.profilePreferencesPanel/);
assert.match(css, /\.profileOptionButton\.is-active/);
assert.match(i18n, /profile_settings_title:[\s\S]*profile_settings_saved/);
assert.match(user, /botReminderEnabled: \{ type: Boolean, default: true \}/);
assert.match(auth, /router\.patch\('\/settings'/);
assert.match(auth, /botReminderEnabled/);
assert.match(worker, /botReminderEnabled: \{ \$ne: false \}/);

console.log('PASS — Profile appearance, bot reminder, and sound settings contracts');
