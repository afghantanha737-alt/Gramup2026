'use strict';

const express = require('express');
const router = express.Router();
require('../utils/asyncHandler').wrapRouter(router);
const { getMaintenanceState, telegramIdFromInitData, isAllowedTelegramId } = require('../utils/maintenance');

// Public gate endpoint: it must remain available before normal app authentication.
// When maintenance is disabled, the app is always allowed to continue.
router.get('/access', async (req, res) => {
  const state = await getMaintenanceState();
  if (!state.enabled) return res.json({ success: true, maintenance: false, allowed: true });

  const telegramId = telegramIdFromInitData(req.get('X-Telegram-Init-Data'));
  const allowed = isAllowedTelegramId(state, telegramId);

  if (allowed) return res.json({ success: true, maintenance: true, allowed: true });
  return res.status(423).json({ success: false, maintenance: true, allowed: false, message: 'Mini App در حال بروزرسانی است.' });
});

module.exports = router;
