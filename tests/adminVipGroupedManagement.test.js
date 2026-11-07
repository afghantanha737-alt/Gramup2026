'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const routes = fs.readFileSync(path.join(root, 'routes/admin.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'public/admin.html'), 'utf8');

assert.match(routes, /router\.get\('\/vip\/users'/, 'grouped VIP user endpoint must exist');
assert.match(routes, /totalVipsPurchased/);
assert.match(routes, /users\.sort\(\(a, b\) => b\.totalVipsPurchased - a\.totalVipsPurchased/);
assert.match(routes, /requestedStatus === 'active'/);
assert.match(routes, /requestedStatus === 'expired'/);
assert.match(routes, /router\.get\('\/vip\/users\/:userId'/, 'user detail endpoint must exist');
assert.match(routes, /active: records\.filter\(item => item\.status === 'active'\)/);
assert.match(routes, /expired: records\.filter\(item => item\.status !== 'active'\)/);
assert.match(routes, /router\.delete\('\/vip\/users\/:userId'/, 'VIP reset endpoint must exist');
assert.match(routes, /VipSubscription\.deleteMany\(\{ user: user\._id \}\)/);
assert.match(routes, /action: 'vip_user_reset'/);
assert.match(routes, /future purchases remain allowed/);

assert.match(ui, /data-vip-user-tab="active"/);
assert.match(ui, /data-vip-user-tab="expired"/);
assert.match(ui, /function setVipUserStatus\(status\)/);
assert.match(ui, /\/api\/admin\/vip\/users\?/);
assert.match(ui, /function openVipUserDetails\(userId\)/);
assert.match(ui, /renderVipDetailRows\(active\)/);
assert.match(ui, /renderVipDetailRows\(expired\)/);
assert.match(ui, /Remaining expected/);
assert.match(ui, /deleteAllUserVips\(userId\)/);
assert.match(ui, /method: 'DELETE'/);
assert.match(ui, /حذف کامل تمام وی‌آی‌پی‌های این کاربر/);

console.log('PASS — grouped VIP users, active/expired tabs, detailed metrics, and logged reset contracts');
