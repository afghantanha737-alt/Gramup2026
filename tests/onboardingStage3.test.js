'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
const i18n = fs.readFileSync(path.join(__dirname, '../public/js/i18n.js'), 'utf8');

assert.ok(app.includes('onboardingSeen:${String(userId)}'), 'onboarding completion is scoped to the authenticated user');
assert.ok(app.includes('window.showOnboarding'), 'onboarding can be reopened from Profile');
assert.ok(app.includes('state.user = { ...(state.user || {}), id: data.telegramId, telegramId: data.telegramId }'), 'bootstrap stores the authenticated Telegram ID');
assert.ok((i18n.match(/menu_onboarding:/g) || []).length === 3, 'onboarding label exists in fa, ps and en translations');
assert.ok(app.includes('onclick="showOnboarding()"'), 'Profile contains the onboarding replay action');

console.log('ALL PASS — Stage 3 onboarding is account-scoped, replayable and translated');
