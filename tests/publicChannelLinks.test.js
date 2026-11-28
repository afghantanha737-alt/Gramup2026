'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  DEFAULT_PUBLIC_CHANNEL_LINKS,
  getPublicChannelLinks
} = require('../utils/publicChannelLinks');

assert.deepStrictEqual(getPublicChannelLinks({}), {
  communityChannelUrl: 'https://t.me/GramupOfficialChannel',
  paymentChannelUrl: 'https://t.me/GramUpPayouts'
});
assert.deepStrictEqual(getPublicChannelLinks({
  COMMUNITY_CHANNEL_URL: '@GramupCommunity',
  PUBLIC_CHANNEL_URL: 'https://t.me/LegacyCommunity',
  COMMUNITY_CHANNEL_USERNAME: '@OlderCommunity',
  PAYOUT_CHANNEL_URL: '@GramupPayments',
  PAYOUT_CHANNEL_ID: '@OlderPayments'
}), {
  communityChannelUrl: 'https://t.me/GramupCommunity',
  paymentChannelUrl: 'https://t.me/GramupPayments'
});
assert.deepStrictEqual(getPublicChannelLinks({
  COMMUNITY_CHANNEL_URL: 'javascript:alert(1)',
  PAYOUT_CHANNEL_URL: 'https://user:password@t.me/payments'
}), DEFAULT_PUBLIC_CHANNEL_LINKS);

const appInfoRoute = fs.readFileSync(path.join(__dirname, '../routes/appInfo.js'), 'utf8');
const profile = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '../public/css/style.css'), 'utf8');
assert.match(appInfoRoute, /communityChannelUrl:\s*publicChannelLinks\.communityChannelUrl/);
assert.match(appInfoRoute, /paymentChannelUrl:\s*publicChannelLinks\.paymentChannelUrl/);
assert.match(profile, /Community channel/);
assert.match(profile, /Payment channel/);
assert.match(profile, /data-profile-channel="community"/);
assert.match(profile, /data-profile-channel="payment"/);
assert.match(profile, /target="_blank" rel="noopener noreferrer"/);
assert.match(profile, /fetch\("\/api\/app-info"/);
assert.match(styles, /\.profileCommunityPanel/);
assert.match(styles, /\.profileCommunityRow\s*\{[^}]*min-height:\s*44px/s);
assert.match(styles, /\.profileCommunityIcon\s*\{[^}]*width:\s*28px;[^}]*height:\s*28px/s);
assert.match(styles, /\.profileCommunityIcon--payment[^{]*\{[^}]*#67e8f9/s);

console.log('public channel links and profile Community section tests passed');
