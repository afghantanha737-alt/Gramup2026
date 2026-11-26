'use strict';
const MAX_COMPLETIONS = 1000000;
const MAX_REWARD_UP = 1000000;
const MAX_PRICE_USDT = 1000;
function calculateAdPricing({ settings, completionsRequested, verificationType, targetLanguage, premiumOnly }) {
  const usdtUsdPrice = Number(settings?.usdtUsdPrice || 0);
  if (!(usdtUsdPrice > 0)) return { error: 'نرخ USD به USDT هنوز در تنظیمات ادمین تعیین نشده است.' };
  const base = Number(settings.adBasePriceUsdPerUser || 0);
  const channel = verificationType === 'telegram' ? Number(settings.adChannelSurchargeUsdPerUser || 0) : 0;
  const language = targetLanguage && targetLanguage !== 'ALL' ? Number(settings.adLanguageSurchargeUsdPerUser || 0) : 0;
  const premium = premiumOnly === true ? Number(settings.adPremiumSurchargeUsdPerUser || 0) : 0;
  const usdPerUser = base + channel + language + premium;
  const priceUsdtPerCompletion = Number((usdPerUser / usdtUsdPrice).toFixed(9));
  const rewardUp = Number(settings.adPlayerRewardUp || 0);
  if (!(usdPerUser > 0) || !(priceUsdtPerCompletion > 0) || !Number.isSafeInteger(rewardUp) || rewardUp < 1) return { error: 'تنظیمات قیمت‌گذاری بازار تبلیغات کامل نیست.' };
  return { priceUsdPerCompletion: usdPerUser, priceUsdtPerCompletion, rewardUp, totalCostUsdt: Number((priceUsdtPerCompletion * completionsRequested).toFixed(9)) };
}
function normalizeAdCampaign(body = {}) {
  const title = String(body.title || '').trim();
  const description = String(body.description || '').trim();
  const destinationUrl = String(body.destinationUrl || body.url || '').trim();
  const telegramChatId = String(body.telegramChatId || body.chatId || '').trim();
  const rewardUp = Number(body.rewardUp || 1);
  const priceUsdtPerCompletion = Number(body.priceUsdtPerCompletion || 0.000000001);
  const completionsRequested = Number(body.completionsRequested);
  const verificationType = ['telegram', 'latest_post'].includes(body.verificationType) ? body.verificationType : 'telegram';
  const targetLanguage = String(body.targetLanguage || 'ALL').trim().toUpperCase();
  const premiumOnly = body.premiumOnly === true;
  if (!title || title.length > 120) return { error: 'عنوان تبلیغاتی الزامی است و باید حداکثر ۱۲۰ کاراکتر باشد.' };
  if (!/^https?:\/\//i.test(destinationUrl)) return { error: 'لینک مقصد باید با http یا https شروع شود.' };
  if (!Number.isSafeInteger(rewardUp) || rewardUp < 1 || rewardUp > MAX_REWARD_UP) return { error: 'پاداش هر کاربر نامعتبر است.' };
  if (!Number.isFinite(priceUsdtPerCompletion) || priceUsdtPerCompletion <= 0 || priceUsdtPerCompletion > MAX_PRICE_USDT) return { error: 'قیمت هر تکمیل نامعتبر است.' };
  if (!Number.isSafeInteger(completionsRequested) || completionsRequested < 1 || completionsRequested > MAX_COMPLETIONS) return { error: 'تعداد تکمیل نامعتبر است.' };
  if (verificationType === 'telegram' && !telegramChatId) return { error: 'برای بررسی عضویت، Telegram Chat ID الزامی است.' };
  return { value: { title, description, destinationUrl, telegramChatId, verificationType, targetLanguage, premiumOnly, requiredReaction: String(body.requiredReaction || '').trim(), rewardUp, priceUsdtPerCompletion: Number(priceUsdtPerCompletion.toFixed(9)), completionsRequested, totalCostUsdt: Number((priceUsdtPerCompletion * completionsRequested).toFixed(9)) } };
}
function publicOrder(order) { return { id: String(order._id), advertiserTelegramId: order.advertiserTelegramId || '', title: order.title, description: order.description, destinationUrl: order.destinationUrl, targetLanguage: order.targetLanguage || 'ALL', premiumOnly: order.premiumOnly === true, rewardUp: order.rewardUp, priceUsdPerCompletion: order.priceUsdPerCompletion, priceUsdtPerCompletion: order.priceUsdtPerCompletion, completionsRequested: order.completionsRequested, completionsApproved: order.completionsApproved, totalCostUsdt: order.totalCostUsdt, paymentMethod: order.paymentMethod, paymentStatus: order.paymentStatus, status: order.status, reviewNote: order.reviewNote || '', createdAt: order.createdAt }; }
module.exports = { normalizeAdCampaign, calculateAdPricing, publicOrder, MAX_COMPLETIONS, MAX_REWARD_UP, MAX_PRICE_USDT };
