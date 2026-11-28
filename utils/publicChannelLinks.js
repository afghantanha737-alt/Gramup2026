'use strict';

const DEFAULT_PUBLIC_CHANNEL_LINKS = Object.freeze({
  communityChannelUrl: 'https://t.me/GramupOfficialChannel',
  paymentChannelUrl: 'https://t.me/GramUpPayouts'
});

function normalizePublicUrl(value, fallback = '') {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  if (/^@?[A-Za-z0-9_]{5,32}$/.test(raw)) {
    return `https://t.me/${raw.replace(/^@/, '')}`;
  }
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return fallback;
    return url.toString();
  } catch {
    return fallback;
  }
}

function getPublicChannelLinks(env = process.env) {
  return {
    communityChannelUrl: normalizePublicUrl(
      env.COMMUNITY_CHANNEL_URL || env.PUBLIC_CHANNEL_URL || env.COMMUNITY_CHANNEL_USERNAME,
      DEFAULT_PUBLIC_CHANNEL_LINKS.communityChannelUrl
    ),
    paymentChannelUrl: normalizePublicUrl(
      env.PAYOUT_CHANNEL_URL || env.PAYOUT_CHANNEL_ID,
      DEFAULT_PUBLIC_CHANNEL_LINKS.paymentChannelUrl
    )
  };
}

module.exports = {
  DEFAULT_PUBLIC_CHANNEL_LINKS,
  getPublicChannelLinks,
  normalizePublicUrl
};
