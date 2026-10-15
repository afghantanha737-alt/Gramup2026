'use strict';
const express = require('express');
const router = express.Router();
require('../utils/asyncHandler').wrapRouter(router);

/**
 * GET /api/app-info — اطلاعات عمومی و بدون نیاز به احراز هویت، برای صفحات مستقل
 * (public/proof.html و public/landing.html) که خارج از تلگرام باز می‌شوند.
 * چیزی خصوصی یا مربوط به کاربر خاص اینجا برنمی‌گردد.
 */
router.get('/', (req, res) => {
  const botUsername = process.env.BOT_USERNAME || '';
  const shortName = process.env.MINI_APP_SHORT_NAME || '';
  const botLink = botUsername
    ? (shortName ? 'https://t.me/' + botUsername + '/' + shortName : 'https://t.me/' + botUsername)
    : '';

  const payoutChannel = (process.env.PAYOUT_CHANNEL_ID || '@GramUpPayouts').trim();
  const cleanUsername = payoutChannel.replace(/^@/, '');
  const payoutChannelUrl = payoutChannel.startsWith('http')
    ? payoutChannel
    : 'https://t.me/' + cleanUsername;

  res.set('Cache-Control', 'public, max-age=300');
  res.json({
    success: true,
    appName: 'Gramup',
    botLink,
    botConfigured: Boolean(botLink),
    payoutChannelUrl,
    payoutChannelUsername: '@' + cleanUsername
  });
});

module.exports = router;
