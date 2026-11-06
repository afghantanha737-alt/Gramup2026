/* =========================================================
   POINTS REWARDS — PREMIUM TELEGRAM MINI APP
   File: public/js/app.js
   (نیازمند i18n.js — باید قبل از این فایل لود شود)
========================================================= */
"use strict";

/* ================= TELEGRAM WEB APP ================= */
const tg = window.Telegram?.WebApp || null;

if (tg) {
  try {
    tg.ready();
    tg.expand();
    if (typeof tg.disableVerticalSwipes === "function") tg.disableVerticalSwipes();
    document.body.classList.add("telegram-mobile");
    if (tg.setHeaderColor) tg.setHeaderColor("#050609");
    if (tg.setBackgroundColor) tg.setBackgroundColor("#050609");
  } catch (error) {
    console.warn("Telegram WebApp initialization failed:", error);
  }
}

/* ================= GLOBAL STATE ================= */
const state = {
  activeTab: "home",
  language: "fa",
  user: null,
  referralMessageConsent: "unset",
  points: 0,
  gramBalance: 0,
  chainGramBalance: null,
  rate: 0,
  streak: 0,
  canCheckIn: false,
  totalCheckins: 0,
  minWithdrawGram: 0,
  nextResetAt: 0,
  spinLastClaimAt: null,
  tickets: 0,
  spinBusy: false,
  spinEnabled: true,
  spinRequiredStreak: 7,
  spinPrizes: [],
  streakMissed: false,
  streakMissedDays: 0,
  streakFreezeCost: 20,
  missedStreakPrompted: false,
  spinModalOpen: false,
  miningBoostUntil: null,
  referralCode: "",
  shareLink: "",
  referralTelegramId: "",
  referralMiniAppConfigured: false,
  referralLevelRates: [],
  referralStats: null,
  squadsLoaded: false,
  squadsLoading: false,
  squads: [],
  mySquad: null,
  squadsError: "",
  referralTeam: [],
  referralLoading: false,
  referralDataLoaded: false,
  referralError: "",
  referralFilter: "all",
  invitedCount: 0,
  activeInvitedCount: 0,
  referralInitialRewardPoints: 0,
  gateActive: false,
  totalEarnedPoints: 0,
  level: null,
  withdrawalProgress: 0,
  withdrawalRemainingGram: 0,
  gramUsdPrice: 0,
  invited: [],
  referralMinTasks: 2,
  referralTasks: [],
  taskSection: "daily",
  tasks: [],
  completions: [],
  tasksServerOffsetMs: 0,
  userDataLoadedAt: 0,
  tasksLoadedAt: 0,
  leaderboard: [],
  myRank: null,
  weeklyLeaderboard: [],
  weeklyMyRank: null,
  weeklyMyPoints: 0,
  weeklyLeaderboardMeta: null,
  weeklyServerOffsetMs: 0,
  vipPlans: [],
  vipSubscriptions: [],
  vipDataLoaded: false,
  vipLoading: false,
  vipError: "",
  vipServerOffsetMs: 0,
  vipServerNowMs: 0,
  mining: null,
  miningLoading: false,
  captchaA: 0,
  captchaB: 0,
  initialized: false,
  readModelCacheHydrated: false,
  readModelStale: false,
  readModelProfileConfirmed: false,
  readModelTasksConfirmed: false,
  financialDataConfirmed: false,
  membershipDataConfirmed: false,
  verifiedSessionUserId: ""
};
window.state = state;
const latestPostOpenedTaskIds = new Set();
const latestPostOpenedAt = new Map();
const latestPostOpeningTaskIds = new Set();
let dailyCheckinTimer = null;

// The browser bundle exports an already-created cache instance (the CommonJS
// factory is only for tests). Optional cache failure must never stop boot.
const readModelCache = window.GramupReadModelCache
  && ["read", "write", "activate", "deactivate"].every(method => typeof window.GramupReadModelCache[method] === "function")
  ? window.GramupReadModelCache
  : null;
window.gramupReadModelCache = readModelCache;

function updateReadModelFreshness() {
  state.readModelStale = !(state.readModelProfileConfirmed && state.readModelTasksConfirmed);
  document.body.classList.toggle("read-model-stale", state.readModelStale);
  document.body.dataset.readModelState = state.readModelStale ? "stale" : "fresh";
  const content = document.querySelector("#content");
  if (content) {
    content.dataset.readModelState = state.readModelStale ? "stale" : "fresh";
    content.setAttribute("aria-busy", state.readModelStale ? "true" : "false");
  }
  const protectedSelectors = [
    "#checkinBtn", "#submitWithdraw", "#submitExchange", "#depositVerifyButton",
    "[data-verify]", "[data-latest-post-open]", "[data-latest-post-check]",
    "[data-upload-screenshot]", "[data-referral-claim]", "[data-vip-claim]", "[data-vip-claim-all]", ".vipClaimAll"
  ].join(",");
  document.querySelectorAll(protectedSelectors).forEach(element => {
    if (state.readModelStale || !state.financialDataConfirmed || !state.membershipDataConfirmed) {
      element.disabled = true;
      element.setAttribute("aria-disabled", "true");
      element.dataset.readModelDisabled = "true";
    } else if (element.dataset.readModelDisabled === "true") {
      element.disabled = false;
      element.removeAttribute("aria-disabled");
      delete element.dataset.readModelDisabled;
    }
  });
}

function invalidateReadModelCache() {
  try { readModelCache?.deactivate(); } catch (error) { console.warn("Read-model cache invalidation failed:", error); }
  state.readModelCacheHydrated = false;
  state.readModelProfileConfirmed = false;
  state.readModelTasksConfirmed = false;
  state.financialDataConfirmed = false;
  state.membershipDataConfirmed = false;
  state.verifiedSessionUserId = "";
  updateReadModelFreshness();
}
window.clearReadModelCacheOnLogout = invalidateReadModelCache;

function readModelActionAllowed() {
  if (!state.readModelStale && state.financialDataConfirmed && state.membershipDataConfirmed) return true;
  toast(t("read_model_refreshing"), "warning");
  updateReadModelFreshness();
  return false;
}
function guardReadModelAction(event) {
  if (!state.readModelStale && state.financialDataConfirmed && state.membershipDataConfirmed) return;
  const target = event.target?.closest?.(
    "#checkinBtn,#submitWithdraw,#submitExchange,#depositVerifyButton,[data-verify],[data-latest-post-open],[data-latest-post-check],[data-upload-screenshot],[data-referral-claim],[data-vip-claim],[data-vip-claim-all],.vipClaimAll"
  );
  if (!target) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  toast(t("read_model_refreshing"), "warning");
}
document.addEventListener("click", guardReadModelAction, true);

/* ================= DOM HELPERS ================= */
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
function findByData(selector, key, value) {
  const expected = String(value ?? "");
  return $$(selector).find(element => element.dataset[key] === expected) || null;
}

/* ================= TELEGRAM INIT DATA ================= */
function getInitData() {
  return tg?.initData || "";
}
function getTelegramUser() {
  return tg?.initDataUnsafe?.user || null;
}

/* ================= LOCAL STORAGE / THEME ================= */
const THEME_KEY = "miniAppTheme";

/*
 * Theme registry: add future themes here first. The renderer, persistence,
 * Telegram chrome color and Profile picker all derive from this single list.
 * Palette-specific CSS remains in css/theme-selector.css.
 */
const THEME_REGISTRY = Object.freeze({
  midnight: Object.freeze({ labelKey: "theme_midnight", icon: "🌙", chrome: "#050609", cssTheme: "midnight" }),
  aurora: Object.freeze({ labelKey: "theme_aurora", icon: "🌌", chrome: "#06151b", cssTheme: "aurora" }),
  pearl: Object.freeze({ labelKey: "theme_pearl", icon: "☀️", chrome: "#f8fafc", cssTheme: "light" })
});
const VALID_THEMES = Object.freeze(Object.keys(THEME_REGISTRY));
function getTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  return VALID_THEMES.includes(saved) ? saved : "midnight";
}
function applyTheme(theme) {
  const selected = VALID_THEMES.includes(theme) ? theme : "midnight";
  const definition = THEME_REGISTRY[selected];
  // Keep the existing light selectors compatible with Pearl Light.
  document.documentElement.dataset.theme = definition.cssTheme;
  document.documentElement.dataset.themeName = selected;
  localStorage.setItem(THEME_KEY, selected);
  try {
    if (tg && tg.setHeaderColor) tg.setHeaderColor(definition.chrome);
    if (tg && tg.setBackgroundColor) tg.setBackgroundColor(definition.chrome);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", definition.chrome);
  } catch (e) { /* ignore */ }
  updateThemeUI();
}
function selectTheme(theme) {
  if (!VALID_THEMES.includes(theme)) return;
  applyTheme(theme);
  haptic("selection");
  if (state.activeTab === "profile" && profileView === "menu") renderProfile();
}
function toggleTheme() {
  const current = getTheme();
  selectTheme(current === "midnight" ? "pearl" : "midnight");
}
function updateThemeUI() {
  const icon = $("#themeIcon");
  const label = $("#themeLabel");
  const toggle = $("#themeToggle");
  const theme = getTheme();
  const definition = THEME_REGISTRY[theme];
  if (icon) icon.textContent = definition.icon;
  if (label) label.textContent = t(definition.labelKey);
  if (toggle) toggle.setAttribute("aria-checked", theme === "pearl" ? "true" : "false");
  $$("[data-theme-choice]").forEach(button => {
    const active = button.dataset.themeChoice === theme;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-checked", active ? "true" : "false");
  });
}
applyTheme(getTheme());
window.toggleTheme = toggleTheme;
window.selectTheme = selectTheme;

/* ================= HAPTIC ================= */
function haptic(type = "light") {
  try {
    if (!tg?.HapticFeedback) return;
    if (type === "success") return tg.HapticFeedback.notificationOccurred("success");
    if (type === "error") return tg.HapticFeedback.notificationOccurred("error");
    if (type === "warning") return tg.HapticFeedback.notificationOccurred("warning");
    if (type === "selection") return tg.HapticFeedback.selectionChanged();
    tg.HapticFeedback.impactOccurred(type);
  } catch { /* ignore unsupported haptics */ }
}

/* ================= TOAST ================= */
let toastTimer = null;
function toast(message, type = "normal") {
  const el = $("#toast");
  if (!el) return;
  clearTimeout(toastTimer);
  el.textContent = message;
  el.classList.remove("show", "success", "error", "warning");
  if (type !== "normal") el.classList.add(type);
  requestAnimationFrame(() => el.classList.add("show"));
  toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}

/* ================= SAFE HTML ================= */
function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* ================= FORMATTERS ================= */
function formatPoints(value) {
  const amount = Number(value) || 0;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number(amount.toFixed(2)));
}
function tokenIconMarkup() {
  return '<img class="upTokenIcon" src="img/gramup-logo-new.png" alt="" aria-hidden="true">';
}
function tokenAmount(value, decimals = 2) {
  const amount = Number(value) || 0;
  return `<span class="upTokenAmount"><span>${new Intl.NumberFormat("en-US", { maximumFractionDigits: decimals }).format(Number(amount.toFixed(decimals)))}</span>${tokenIconMarkup()}<span>UP</span></span>`;
}
function formatNumber(value, decimals = 4) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: decimals }).format(Number(value) || 0);
}
function formatFixed(value, decimals = 3) {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(Number(value) || 0);
}
function truncateMiddle(str, head = 6, tail = 6) {
  const s = String(str || "");
  if (s.length <= head + tail + 3) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}
function getInitials(user) {
  const first = user?.first_name || user?.firstName || "";
  const last = user?.last_name || user?.lastName || "";
  const text = `${first} ${last}`.trim();
  if (!text) return "A";
  return text.split(/\s+/).map(item => item.charAt(0)).join("").slice(0, 2).toUpperCase();
}
function timeAgo(dateString) {
  const date = new Date(dateString);
  const diffSeconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSeconds < 60) return "•";
  const minutes = Math.floor(diffSeconds / 60);
  if (minutes < 60) return `${formatPoints(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${formatPoints(hours)}h`;
  const days = Math.floor(hours / 24);
  return `${formatPoints(days)}d`;
}
function pad2(n) { return String(n).padStart(2, "0"); }

/* ================= API ================= */
const pendingIdempotencyKeys = new Map();
function getPendingIdempotencyKey(scope) {
  const storageKey = `gramup:idempotency:${scope}`;
  try {
    let key = sessionStorage.getItem(storageKey);
    if (!key) {
      key = crypto.randomUUID();
      sessionStorage.setItem(storageKey, key);
    }
    return key;
  } catch {
    let key = pendingIdempotencyKeys.get(scope);
    if (!key) {
      key = crypto.randomUUID();
      pendingIdempotencyKeys.set(scope, key);
    }
    return key;
  }
}
function clearPendingIdempotencyKey(scope) {
  pendingIdempotencyKeys.delete(scope);
  try { sessionStorage.removeItem(`gramup:idempotency:${scope}`); } catch { /* storage may be unavailable */ }
}
function clearDefinitiveIdempotencyFailure(scope, error) {
  if (error?.status >= 400 && error.status < 500 && error.code !== "IDEMPOTENCY_DUPLICATE") {
    clearPendingIdempotencyKey(scope);
  }
}

async function api(url, options = {}) {
  const config = { ...options, headers: { ...(options.headers || {}) } };

  if (config.body && typeof config.body !== "string" && !(typeof FormData !== "undefined" && config.body instanceof FormData)) {
    config.headers["Content-Type"] = "application/json";
    config.body = JSON.stringify(config.body);
  }

  const initData = getInitData();
  if (initData) config.headers['X-Telegram-Init-Data'] = initData;

  // اگر سرور بیش از حد کند شد، درخواست قطع می‌شود تا صفحه برای همیشه خالی نماند.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);
  config.signal = controller.signal;

  let response;
  try {
    response = await fetch(url, config);
  } catch (error) {
    const requestError = new Error(error.name === "AbortError" ? t("error_generic") : t("error_generic"));
    requestError.code = error.name === "AbortError" ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR';
    requestError.status = 0;
    throw requestError;
  } finally {
    clearTimeout(timeoutId);
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    // هر endpoint محافظت‌شده اگر عضویت اجباری را رد کند، صفحه‌ی عضویت اجباری باز می‌شود
    // (مثلاً وقتی کاربر وسط استفاده از یک کانال خارج شده باشد)
    if (data?.code === "MEMBERSHIP_REQUIRED" || data?.code === "MEMBERSHIP_UNAVAILABLE") {
      showMembershipGate({
        required: true,
        verified: false,
        unavailable: data.code === "MEMBERSHIP_UNAVAILABLE",
        channels: Array.isArray(data.channels) ? data.channels : []
      });
    }
    const authFailure = response.status === 401 || response.status === 403;
    if (authFailure) invalidateReadModelCache();
    const err = new Error(response.status === 401 ? t('auth_error') : response.status === 403 ? t('auth_forbidden') : (data?.message || t("error_generic")));
    err.code = data?.code || (response.status === 401 ? 'AUTH_REQUIRED' : response.status === 403 ? 'AUTH_FORBIDDEN' : null);
    err.status = response.status;
    err.authFailure = authFailure;
    err.response = { data, status: response.status };
    throw err;
  }
  return data;
}
window.gramupApi = api;

/** Multipart upload helper with header-based Telegram authentication and cancellation timeout. */
async function apiUpload(url, formData) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  const initData = getInitData();
  const headers = initData ? { 'X-Telegram-Init-Data': initData } : {};
  let response;
  try {
    response = await fetch(url, { method: 'POST', body: formData, headers, signal: controller.signal });
  } catch (error) {
    const requestError = new Error(t('error_generic'));
    requestError.code = error.name === 'AbortError' ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR';
    requestError.status = 0;
    throw requestError;
  } finally { clearTimeout(timeoutId); }
  let data = null;
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) {
    const err = new Error(response.status === 401 ? t('auth_error') : response.status === 403 ? t('auth_forbidden') : (data?.message || t('error_generic')));
    err.code = data?.code || (response.status === 401 ? 'AUTH_REQUIRED' : response.status === 403 ? 'AUTH_FORBIDDEN' : null);
    err.status = response.status;
    throw err;
  }
  return data;
}
/* ================= LOADING SKELETON ================= */
function showLoading() {
  const content = $("#content");
  if (!content) return;
  content.innerHTML = `
    <div class="loading" style="height:190px;margin-bottom:13px"></div>
    <div class="loading" style="height:95px;margin-bottom:13px"></div>
    <div class="loading" style="height:95px"></div>
  `;
}

/* ================= HEADER + STATIC TEXT ================= */
function updateHeader() {
  const telegramUser = getTelegramUser();
  const user = state.user || telegramUser || {};
  const firstName = user.first_name || user.firstName || "";

  const avatar = $("#avatar");
  const idLine = $("#userIdLine");

  if (avatar) {
    avatar.textContent = getInitials(user);
    if (user.photo_url) avatar.innerHTML = `<img src="${escapeHTML(user.photo_url)}" alt="">`;
  }
  const uid = user.id || user.telegramId || "";
  if (idLine) idLine.textContent = uid ? `ID ${uid}` : "";
  updateSpinControls();
}

function applyDirection() {
  const isLtr = state.language === "en";
  document.documentElement.dir = isLtr ? "ltr" : "rtl";
  document.documentElement.lang = state.language;
}

function applyStaticTranslations() {
  applyDirection();
  $$("#tabbar [data-tab]").forEach(button => {
    const label = button.querySelector(".tabLabel");
    if (label) label.textContent = t(`nav_${button.dataset.tab}`);
  });

  // متن‌های ثابت داخل index.html (راهنما، قوانین، حریم خصوصی، کپچا، مودال‌ها) با data-i18n ترجمه می‌شوند
  $$("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });
  $$("[data-i18n-html]").forEach(el => { el.innerHTML = t(el.dataset.i18nHtml); }); // فقط رشته‌های داخلی خودمان (i18n.js)
  $$("[data-i18n-ph]").forEach(el => { el.setAttribute("placeholder", t(el.dataset.i18nPh)); });
  $$("[data-i18n-aria]").forEach(el => { el.setAttribute("aria-label", t(el.dataset.i18nAria)); });
  const exchangeOverlay = $("#exchangeOverlay");
  if (exchangeOverlay && exchangeOverlay.style.display !== "none") updateExchangePreview();
  renderOnboardingStep();
  updateThemeUI();
  updateHeader();
}

/* ================= NAVIGATION ================= */
let countdownInterval = null;
let navigationListenersInstalled = false;

function setupNavigation() {
  if (navigationListenersInstalled) return;
  $$("#tabbar [data-tab]").forEach(button => {
    button.addEventListener("click", () => {
      const tab = button.dataset.tab;
      if (!tab) return;
      haptic("light");
      navigate(tab);
    });
  });
  navigationListenersInstalled = true;
  setupReferralTelegramBackButton();
}
function updateNavigation() {
  $$("#tabbar [data-tab]").forEach(button => {
    button.classList.toggle("active", button.dataset.tab === state.activeTab);
  });
}
let navigationSequence = 0;
async function navigate(tab) {
  const requestId = ++navigationSequence;
  if (tab !== "profile") profileRenderSequence += 1;
  const validTabs = ["home", "tasks", "vip", "wallet", "profile"];
  if (!validTabs.includes(tab)) tab = "home";
  clearInterval(countdownInterval);
  state.activeTab = tab;
  syncReferralTelegramBackButton();
  updateNavigation();
  window.scrollTo({ top: 0, behavior: "smooth" });
  await renderCurrentTab(requestId);
  if (requestId !== navigationSequence || state.activeTab !== tab) return;
  syncReferralTelegramBackButton();
}
window.navigate = navigate;


/* ================= MANDATORY CHANNEL MEMBERSHIP GATE =================
   وضعیت عضویت هرگز در کلاینت ذخیره یا باور نمی‌شود؛ هر بار از سرور (که از خود تلگرام
   می‌پرسد) گرفته می‌شود. سرور علاوه بر این، همه‌ی APIهای محافظت‌شده را هم بلاک می‌کند. */
let gateData = null;
let gateBusy = false;
let lastGateCheckAt = 0;

function gateSafeUrl(url) {
  return /^https:\/\/(t|telegram)\.me\//i.test(String(url || "")) ? String(url) : "";
}

function gateOpenLink(url) {
  const safe = gateSafeUrl(url);
  if (!safe) return;
  try {
    if (tg && typeof tg.openTelegramLink === "function") { tg.openTelegramLink(safe); return; }
  } catch (e) { /* fallback below */ }
  window.open(safe, "_blank", "noopener");
}

const GATE_PLANE = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.5 4.4 2.9 11.6c-.9.35-.9 1 0 1.3l4.7 1.5 1.8 5.5c.2.6.4.8.9.8s.6-.2.9-.5l2.3-2.2 4.6 3.4c.9.5 1.5.2 1.7-.8L23 5.8c.3-1.2-.4-1.8-1.5-1.4zM8.8 13.5l9.5-6c.4-.3.8-.1.5.2l-7.8 7.1-.3 3.3-1.9-4.6z"/></svg>';

function ensureGateElement() {
  let el = document.getElementById("membershipGate");
  if (!el) {
    el = document.createElement("div");
    el.id = "membershipGate";
    el.className = "gateOverlay";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    document.body.appendChild(el);
  }
  return el;
}

function gateMessage(data) {
  const channels = data.channels || [];
  const anyNotJoined = channels.some(c => c.state === "not_joined");
  const anyError = channels.some(c => c.state === "error");
  if (data.verified) return { type: "ok", text: t("gate_all_ok") };
  if (anyNotJoined) return { type: "warn", text: t("gate_missing") };
  if (data.unavailable || anyError) return { type: "error", text: anyError ? t("gate_config_error") : t("gate_unavailable") };
  return { type: "warn", text: t("gate_missing") };
}

function renderMembershipGate(override) {
  const el = ensureGateElement();
  const data = gateData || { channels: [] };
  const msg = override || gateMessage(data);
  const channels = data.channels || [];

  const cards = channels.map((c, i) => {
    const joined = c.state === "joined";
    const errored = c.state === "error";
    const pill = joined
      ? `<span class="gatePill gateOk">✓ ${t("gate_joined")}</span>`
      : errored
        ? `<span class="gatePill gateWarnPill">! ${t("gate_error")}</span>`
        : `<span class="gatePill gateBad">✕ ${t("gate_not_joined")}</span>`;
    const handle = c.username ? `@${escapeHTML(c.username)}` : "";
    const canJoin = !joined && gateSafeUrl(c.url);
    return `
      <div class="gateCard">
        <div class="gateCardTop">
          <div class="gateChIcon">${GATE_PLANE}</div>
          <div class="gateChInfo">
            <div class="gateChName">${escapeHTML(c.name)}</div>
            ${handle ? `<div class="gateChUser">${handle}</div>` : ""}
          </div>
          ${pill}
        </div>
        ${canJoin ? `<button type="button" class="gateJoinBtn" data-join="${i}">${GATE_PLANE}<span>${t("gate_join")}</span></button>` : ""}
      </div>`;
  }).join("");

  el.innerHTML = `
    <div class="gateInner">
      <div class="gateBrand">
        <img src="img/gramup-logo-new.jpg" alt="Gramup">
        <div class="brandName">Gram<span>up</span></div>
      </div>
      <div class="gateHero">${GATE_PLANE}</div>
      <h1 class="gateTitle">${t("gate_title")}</h1>
      <p class="gateDesc">${t("gate_desc")}</p>
      <div class="gateList">${cards}</div>
      <div id="gateMsg" class="gateMsg gate-${msg.type}" role="status">${escapeHTML(msg.text)}</div>
      <button type="button" id="gateCheckBtn" class="gateCheckBtn">${gateBusy ? t("gate_checking") : (data.fetchFailed || data.unavailable ? t("gate_retry") : t("gate_check"))}</button>
    </div>`;

  el.querySelectorAll("[data-join]").forEach(btn => {
    btn.addEventListener("click", () => {
      haptic("selection");
      const channel = channels[Number(btn.dataset.join)];
      if (channel) gateOpenLink(channel.url); // فقط لینک را باز می‌کند؛ عضو حساب نمی‌شود
    });
  });
  const check = el.querySelector("#gateCheckBtn");
  if (check) {
    check.disabled = gateBusy;
    check.addEventListener("click", gateCheck);
  }
}

function showMembershipGate(data) {
  gateData = data;
  state.gateActive = true;
  document.body.classList.add("is-gated");
  try { if (tg && tg.BackButton && tg.BackButton.hide) tg.BackButton.hide(); } catch (e) { /* ignore */ }
  renderMembershipGate();
}

function hideMembershipGate() {
  state.gateActive = false;
  gateData = null;
  document.body.classList.remove("is-gated");
  const el = document.getElementById("membershipGate");
  if (el) el.remove();
}

function fetchMembership(fresh) {
  return fresh
    ? api("/api/required-channels/check-membership", { method: "POST", body: {} })
    : api("/api/required-channels");
}

/** true = اجازه‌ی ورود؛ false = صفحه‌ی عضویت اجباری نمایش داده شد */
async function enforceMembership() {
  lastGateCheckAt = Date.now();
  try {
    const data = await fetchMembership(false);
    if (data.verified) {
      state.membershipDataConfirmed = true;
      updateReadModelFreshness();
      if (state.gateActive) hideMembershipGate();
      return true;
    }
    state.membershipDataConfirmed = false;
    updateReadModelFreshness();
    showMembershipGate(data);
    return false;
  } catch (error) {
    // اگر نتوانستیم عضویت را بررسی کنیم، اجازه‌ی ورود نمی‌دهیم
    state.membershipDataConfirmed = false;
    updateReadModelFreshness();
    if (!state.gateActive) {
      showMembershipGate({ required: true, verified: false, unavailable: true, fetchFailed: true, channels: [] });
    }
    return false;
  }
}

async function gateCheck() {
  if (gateBusy) return;
  gateBusy = true;
  const btn = document.getElementById("gateCheckBtn");
  if (btn) { btn.disabled = true; btn.textContent = t("gate_checking"); }
  haptic("selection");

  try {
    const data = await fetchMembership(true);
    gateData = data;
    if (data.verified) {
      gateBusy = false;
      renderMembershipGate({ type: "ok", text: t("gate_all_ok") });
      const done = document.getElementById("gateCheckBtn");
      if (done) done.disabled = true;
      haptic("success");
      await new Promise(resolve => setTimeout(resolve, 700));
      hideMembershipGate();
      state.initialized = true;
      await navigate(state.activeTab || "home");
      return;
    }
    gateBusy = false;
    renderMembershipGate();
  } catch (error) {
    gateBusy = false;
    gateData = { ...(gateData || {}), channels: (gateData && gateData.channels) || [], unavailable: true, verified: false, fetchFailed: !(gateData && gateData.channels && gateData.channels.length) };
    renderMembershipGate({ type: "error", text: t("gate_unavailable") });
  } finally {
    gateBusy = false;
  }
}

// کاربر وقتی به برنامه برمی‌گردد (مثلاً بعد از رفتن به کانال یا بازگشت از پس‌زمینه) دوباره بررسی می‌شود
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !state.initialized || state.gateActive) return;
  if (Date.now() - lastGateCheckAt < 15000) return;
  enforceMembership();
  void refreshUserDataOnReturn();
});

/* ================= TERMS ================= */
function termsAccepted() {
  return localStorage.getItem("termsAccepted") === "1";
}
function showTerms() {
  const overlay = $("#termsOverlay");
  haptic("light");
  if (overlay) overlay.style.display = "flex";
}
function hideTerms() {
  const overlay = $("#termsOverlay");
  if (overlay) overlay.style.display = "none";
  localStorage.setItem("termsAccepted", "1");
  maybeShowOnboarding();
}
window.hideTerms = hideTerms;
window.showTerms = showTerms;

/* ================= PRIVACY POLICY ================= */
function showPrivacy() {
  const overlay = $("#privacyOverlay");
  haptic("light");
  if (overlay) overlay.style.display = "flex";
}
function hidePrivacy() {
  const overlay = $("#privacyOverlay");
  if (overlay) overlay.style.display = "none";
}
window.showPrivacy = showPrivacy;
window.hidePrivacy = hidePrivacy;

/* ================= ONBOARDING ================= */
const ONBOARDING_STEP_COUNT = 3;
let onboardingStep = 0;

function onboardingSeen() {
  const userId = state.user?.telegramId || state.user?.id || getTelegramUser()?.id;
  const key = userId ? `onboardingSeen:${String(userId)}` : "onboardingSeen";
  return localStorage.getItem(key) === "1";
}

function maybeShowOnboarding() {
  if (onboardingSeen()) return;
  onboardingStep = 0;
  const overlay = $("#onboardingOverlay");
  haptic("light");
  if (overlay) overlay.style.display = "flex";
  renderOnboardingStep();
}

function renderOnboardingStep() {
  for (let i = 0; i < ONBOARDING_STEP_COUNT; i++) {
    const step = $(`#onboardingStep${i}`);
    const dot = $(`#onboardingDot${i}`);
    if (step) step.style.display = i === onboardingStep ? "block" : "none";
    if (dot) dot.classList.toggle("active", i === onboardingStep);
  }
  const nextBtn = $("#onboardingNextBtn");
  if (nextBtn) nextBtn.textContent = onboardingStep === ONBOARDING_STEP_COUNT - 1 ? t("ob_start") : t("ob_next");
}

function onboardingNext() {
  if (onboardingStep >= ONBOARDING_STEP_COUNT - 1) {
    finishOnboarding();
    return;
  }
  onboardingStep += 1;
  renderOnboardingStep();
}
window.onboardingNext = onboardingNext;

function finishOnboarding() {
  const overlay = $("#onboardingOverlay");
  if (overlay) overlay.style.display = "none";
  const userId = state.user?.telegramId || state.user?.id || getTelegramUser()?.id;
  const key = userId ? `onboardingSeen:${String(userId)}` : "onboardingSeen";
  localStorage.setItem(key, "1");
}

function skipOnboarding() {
  finishOnboarding();
}
window.skipOnboarding = skipOnboarding;
window.showOnboarding = () => {
  onboardingStep = 0;
  const overlay = $("#onboardingOverlay");
  haptic("light");
  if (overlay) overlay.style.display = "flex";
  renderOnboardingStep();
};

/* ================= CAPTCHA ================= */
function captchaPassed() {
  return localStorage.getItem("captchaPassed") === "1";
}
function createCaptcha() {
  state.captchaA = Math.floor(Math.random() * 8) + 2;
  state.captchaB = Math.floor(Math.random() * 8) + 1;
  const question = $("#captchaQuestion");
  const answer = $("#captchaAnswer");
  const error = $("#captchaError");
  if (question) question.textContent = `${state.captchaA} + ${state.captchaB} = ?`;
  if (answer) { answer.value = ""; answer.focus(); }
  if (error) error.textContent = "";
}
function showCaptcha() {
  const overlay = $("#captchaOverlay");
  if (!overlay) return;
  createCaptcha();
  haptic("light");
  overlay.style.display = "flex";
}
function hideCaptcha() {
  const overlay = $("#captchaOverlay");
  if (overlay) overlay.style.display = "none";
}
async function submitCaptcha() {
  const answer = $("#captchaAnswer");
  const error = $("#captchaError");
  if (!answer) return;
  const value = Number(answer.value);

  if (value !== state.captchaA + state.captchaB) {
    haptic("error");
    createCaptcha(); // سوال جدید می‌سازد و پیام خطا را پاک می‌کند؛ پس پیام باید بعد از آن نوشته شود
    if (error) error.textContent = t("captcha_wrong");
    return;
  }

  localStorage.setItem("captchaPassed", "1");
  hideCaptcha();
  haptic("success");
  await boot();
}
window.submitCaptcha = submitCaptcha;

/* ================= LANGUAGE ================= */
function showLanguageOverlay() {
  const overlay = $("#languageOverlay");
  haptic("light");
  if (overlay) overlay.style.display = "flex";
}
window.showLanguageOverlay = showLanguageOverlay;

function hideLanguageOverlay() {
  const overlay = $("#languageOverlay");
  if (overlay) overlay.style.display = "none";
}
window.hideLanguageOverlay = hideLanguageOverlay;

let languageSelectionSequence = 0;
let languageSelectionQueue = Promise.resolve();
async function selectLanguage(lang) {
  if (!["fa", "ps", "en"].includes(lang)) return;
  if (lang === state.language) { hideLanguageOverlay(); return; }
  const selectionId = ++languageSelectionSequence;

  const saveRequest = languageSelectionQueue.catch(() => {}).then(() =>
    api("/api/auth/language", { method: "PATCH", body: { language: lang } })
  );
  languageSelectionQueue = saveRequest.catch(() => {});
  try {
    await saveRequest;
  } catch (error) {
    console.warn("Failed to persist language:", error);
  }
  if (selectionId !== languageSelectionSequence) return;

  state.language = lang;
  localStorage.setItem("appLanguage", lang);
  hideLanguageOverlay();
  applyStaticTranslations();
  await renderCurrentTab();
}
window.selectLanguage = selectLanguage;

function showReferralMessageConsent(required = false) {
  const overlay = $("#referralMessageConsentOverlay");
  if (!overlay) return;
  overlay.dataset.required = required ? "true" : "false";
  const closeButton = $("#referralMessageConsentClose");
  if (closeButton) closeButton.style.display = required ? "none" : "";
  const status = $("#referralMessageConsentStatus");
  const stateKey = ["granted", "denied", "unset"].includes(state.referralMessageConsent)
    ? `referral_message_consent_${state.referralMessageConsent}` : "referral_message_consent_unset";
  if (status) status.textContent = t("referral_message_consent_status", { status: t(stateKey) });
  const feedback = $("#referralMessageConsentFeedback");
  if (feedback) feedback.textContent = "";
  haptic("light");
  overlay.style.display = "flex";
}
window.showReferralMessageConsent = showReferralMessageConsent;

function closeReferralMessageConsent() {
  const overlay = $("#referralMessageConsentOverlay");
  if (overlay?.dataset.required === "true") return;
  if (overlay) overlay.style.display = "none";
}
window.closeReferralMessageConsent = closeReferralMessageConsent;

async function setReferralMessageConsent(consent) {
  if (!["granted", "denied"].includes(consent)) return;
  const buttons = $$("#referralMessageConsentOverlay .referralConsentActions button");
  buttons.forEach(button => { button.disabled = true; });
  try {
    const data = await api("/api/auth/referral-message-consent", {
      method: "PATCH",
      body: { consent }
    });
    state.referralMessageConsent = data.consent;
    const overlay = $("#referralMessageConsentOverlay");
    if (overlay) overlay.style.display = "none";
  } catch (error) {
    const feedback = $("#referralMessageConsentFeedback");
    if (feedback) feedback.textContent = t("referral_message_consent_error");
  } finally {
    buttons.forEach(button => { button.disabled = false; });
  }
}
window.setReferralMessageConsent = setReferralMessageConsent;

/* ================= DATA LOADERS ================= */
function applyCachedReadModel(entry) {
  if (!entry || !state.verifiedSessionUserId || entry.userId !== state.verifiedSessionUserId) return false;
  const profile = entry.profile || {};
  state.points = Number(profile.points) || 0;
  state.gramBalance = Number(profile.gramBalance) || 0;
  state.rate = Number(profile.rate) || 0;
  state.streak = Number(profile.streak) || 0;
  state.canCheckIn = Boolean(profile.canCheckIn);
  state.totalCheckins = Number(profile.totalCheckins) || 0;
  state.minWithdrawGram = Number(profile.minWithdrawGram) || 0;
  state.nextResetAt = Number(profile.nextResetAt) || 0;
  state.spinLastClaimAt = profile.spinLastClaimAt || null;
  state.tickets = Number(profile.tickets) || 0;
  state.spinEnabled = profile.spinEnabled !== false;
  state.spinRequiredStreak = Number(profile.spinRequiredStreak) || 7;
  state.spinPrizes = Array.isArray(profile.spinPrizes) ? profile.spinPrizes : [];
  state.streakMissed = Boolean(profile.streakMissed);
  state.streakMissedDays = Number(profile.streakMissedDays) || 0;
  state.streakFreezeCost = Number(profile.streakFreezeCost) || 20;
  state.miningBoostUntil = profile.miningBoostUntil || null;
  state.totalEarnedPoints = Number(profile.totalEarnedPoints) || 0;
  state.level = profile.level || null;
  state.withdrawalProgress = Number(profile.withdrawalProgress) || 0;
  state.withdrawalRemainingGram = Number(profile.withdrawalRemainingGram) || 0;
  state.gramUsdPrice = Number(profile.gramUsdPrice) || 0;
  if (profile.firstName) state.user = { ...(state.user || {}), first_name: profile.firstName };
  const tasks = entry.tasks || {};
  state.tasks = Array.isArray(tasks.tasks) ? tasks.tasks : [];
  state.completions = Array.isArray(tasks.completions) ? tasks.completions : [];
  latestPostOpenedTaskIds.clear();
  latestPostOpenedAt.clear();
  (Array.isArray(tasks.latestPostStates) ? tasks.latestPostStates : []).forEach(item => {
    if (item?.task && item.openedAt) {
      latestPostOpenedTaskIds.add(String(item.task));
      const openedAt = new Date(item.openedAt).getTime();
      if (Number.isFinite(openedAt)) latestPostOpenedAt.set(String(item.task), openedAt);
    }
  });
  const serverNow = Number(tasks.serverNow);
  state.tasksServerOffsetMs = Number.isFinite(serverNow) && serverNow > 0 ? serverNow - Date.now() : 0;
  state.readModelCacheHydrated = true;
  state.readModelStale = true;
  state.readModelProfileConfirmed = false;
  state.readModelTasksConfirmed = false;
  state.financialDataConfirmed = false;
  updateHeader();
  updateReadModelFreshness();
  return true;
}

function persistReadModelCache() {
  if (!readModelCache || !state.verifiedSessionUserId) return;
  readModelCache.write(state.verifiedSessionUserId, {
    profile: {
      points: state.points, gramBalance: state.gramBalance, rate: state.rate, streak: state.streak,
      canCheckIn: state.canCheckIn, totalCheckins: state.totalCheckins, minWithdrawGram: state.minWithdrawGram,
      nextResetAt: state.nextResetAt, totalEarnedPoints: state.totalEarnedPoints, level: state.level,
      spinLastClaimAt: state.spinLastClaimAt, tickets: state.tickets, spinEnabled: state.spinEnabled, spinRequiredStreak: state.spinRequiredStreak, miningBoostUntil: state.miningBoostUntil,
      withdrawalProgress: state.withdrawalProgress, withdrawalRemainingGram: state.withdrawalRemainingGram,
      gramUsdPrice: state.gramUsdPrice, firstName: state.user?.first_name || ""
    },
    tasks: {
      tasks: state.tasks, completions: state.completions,
      latestPostStates: Array.from(latestPostOpenedTaskIds).map(task => ({ task, openedAt: new Date(latestPostOpenedAt.get(task) || Date.now()).toISOString() })),
      serverNow: Date.now() + Number(state.tasksServerOffsetMs || 0)
    }
  });
}

async function hydrateReadModelAfterAuth() {
  const userId = String(state.user?.telegramId || state.user?.id || "").trim();
  if (!readModelCache || !userId) return false;
  if (state.verifiedSessionUserId && state.verifiedSessionUserId !== userId) invalidateReadModelCache();
  state.verifiedSessionUserId = userId;
  readModelCache.activate(userId);
  const entry = readModelCache.read(userId);
  return applyCachedReadModel(entry);
}

let readModelRefreshPromise = null;
async function refreshReadModelInBackground() {
  if (!state.verifiedSessionUserId || readModelRefreshPromise) return readModelRefreshPromise;
  readModelRefreshPromise = Promise.all([
    loadUserData({ force: true }),
    loadTasks({ force: true })
  ]).then(() => {
    persistReadModelCache();
    updateReadModelFreshness();
    rerenderActiveUserDataView();
  }).catch(error => {
    console.warn("Background read-model refresh failed:", error);
    updateReadModelFreshness();
  }).finally(() => { readModelRefreshPromise = null; });
  return readModelRefreshPromise;
}
window.refreshReadModelInBackground = refreshReadModelInBackground;

async function bootstrapAuth() {
  const params = new URLSearchParams(location.search);
  const ref = params.get("ref") || "";
  const url = ref ? `/api/auth/me?ref=${encodeURIComponent(ref)}` : "/api/auth/me";

  try {
    const data = await api(url);
    state.language = localStorage.getItem("appLanguage") || data.language || "fa";
    state.referralMessageConsent = ["granted", "denied", "unset"].includes(data.referralMessageConsent)
      ? data.referralMessageConsent : "unset";
    state.user = { ...(state.user || {}), id: data.telegramId, telegramId: data.telegramId };
    if (data.firstName) state.user.first_name = data.firstName;
    if (!data.telegramId) throw Object.assign(new Error("Verified identity missing"), { authFailure: true, status: 401 });
    await hydrateReadModelAfterAuth();
  } catch (error) {
    console.warn("Bootstrap auth failed:", error);
    if (error?.authFailure || error?.status === 401 || error?.status === 403) invalidateReadModelCache();
    state.language = localStorage.getItem("appLanguage") || "fa";
  }
}

const CLIENT_DATA_TTL_MS = 15000;
let userDataRequestSequence = 0;
async function loadUserData({ force = false } = {}) {
  const requestId = ++userDataRequestSequence;
  if (!force && !state.readModelStale && state.userDataLoadedAt && Date.now() - state.userDataLoadedAt < CLIENT_DATA_TTL_MS) return;
  const data = await api("/api/points/me");
  if (requestId !== userDataRequestSequence) return;
  state.points = Number(data?.points) || 0;
  state.gramBalance = Number(data?.gramBalance) || 0;
  state.rate = Number(data?.rate) || 0;
  state.streak = Number(data?.streak) || 0;
  state.canCheckIn = Boolean(data?.canCheckIn);
  state.totalCheckins = Number(data?.totalCheckins) || 0;
  state.minWithdrawGram = Number(data?.minWithdrawGram) || 0;
  state.nextResetAt = Number(data?.nextResetAt) || 0;
  state.spinLastClaimAt = data?.spinLastClaimAt || null;
  state.tickets = Number(data?.tickets) || 0;
  state.spinEnabled = data?.spinEnabled !== false;
  state.spinRequiredStreak = Number(data?.spinRequiredStreak) || 7;
  state.spinPrizes = Array.isArray(data?.spinPrizes) ? data.spinPrizes : [];
  state.streakMissed = Boolean(data?.streakMissed);
  state.streakMissedDays = Number(data?.streakMissedDays) || 0;
  state.streakFreezeCost = Number(data?.streakFreezeCost) || 20;
  state.miningBoostUntil = data?.miningBoostUntil || null;
  state.totalEarnedPoints = Number(data?.totalEarnedPoints) || 0;
  state.level = data?.level || null;
  state.withdrawalProgress = Number(data?.withdrawalProgress) || 0;
  state.withdrawalRemainingGram = Number(data?.withdrawalRemainingGram) || 0;
  state.gramUsdPrice = Number(data?.gramUsdPrice) || 0;
  state.userDataLoadedAt = Date.now();
  state.readModelProfileConfirmed = true;
  state.financialDataConfirmed = true;
  updateReadModelFreshness();
  if (data?.firstName) state.user = { ...(state.user || {}), first_name: data.firstName };
  persistReadModelCache();
  updateHeader();
}

function rerenderActiveUserDataView() {
  if (state.activeTab === "home") renderHome();
  else if (state.activeTab === "tasks") renderTasks();
  else if (state.activeTab === "wallet") renderWallet();
  else if (state.activeTab === "vip") {
    const content = $("#content");
    if (content) content.innerHTML = state.vipError
      ? `<div class="card"><div class="emptyDesc">${escapeHTML(state.vipError)}</div><button type="button" class="secondaryBtn" onclick="retryVipPlans()">${t("vip_retry")}</button></div>`
      : renderProfileVip();
    startVipCountdown();
  } else if (state.activeTab === "profile") {
    void renderProfile();
  }
}

let lastUserDataReturnRefreshAt = 0;
let userDataReturnRefreshPromise = null;
async function refreshUserDataOnReturn() {
  if (document.visibilityState !== "visible" || !state.initialized || state.gateActive) return;
  const now = Date.now();
  if (now - lastUserDataReturnRefreshAt < CLIENT_DATA_TTL_MS) return;
  if (userDataReturnRefreshPromise) return userDataReturnRefreshPromise;
  lastUserDataReturnRefreshAt = now;
  userDataReturnRefreshPromise = (async () => {
    try {
      await loadUserData({ force: true });
      rerenderActiveUserDataView();
    } catch (error) {
      // This is a read-only return refresh; keep the current view on network failure.
      console.warn("User data refresh on return failed:", error);
    } finally {
      userDataReturnRefreshPromise = null;
    }
  })();
  return userDataReturnRefreshPromise;
}
window.refreshUserDataOnReturn = refreshUserDataOnReturn;
window.addEventListener("focus", () => { void refreshUserDataOnReturn(); });
window.addEventListener("pageshow", () => { void refreshUserDataOnReturn(); });

let referralDataRequestSequence = 0;
async function loadReferralData({ force = false } = {}) {
  const requestId = ++referralDataRequestSequence;
  if (!force && state.referralDataLoaded) return;
  state.referralLoading = !state.referralDataLoaded;
  state.referralError = "";
  try {
    const data = await api("/api/referral/me");
    if (requestId !== referralDataRequestSequence) return;
    state.referralCode = data?.referralCode || "";
    state.shareLink = data?.shareLink || "";
    state.referralTelegramId = "";
    state.referralMiniAppConfigured = Boolean(data?.miniAppConfigured);
    state.referralLevelRates = Array.isArray(data?.referralLevelRates) ? data.referralLevelRates.map(Number).filter(Number.isFinite) : [];
    state.referralStats = data?.referralStats && typeof data.referralStats === "object" ? data.referralStats : null;
    state.referralHistory = Array.isArray(data?.referralHistory) ? data.referralHistory : [];
    state.referralNetworkLevels = Array.isArray(data?.networkLevels) ? data.networkLevels : [];
    state.referralTeam = Array.isArray(data?.team) ? data.team : [];
    const directInviteCount = Number(data?.referralStats?.totalReferrals ?? data?.invitedCount);
    state.invitedCount = Number.isFinite(directInviteCount) && directInviteCount >= 0 ? directInviteCount : 0;
    state.activeInvitedCount = Number(data?.activeInvitedCount) || 0;
    state.invited = Array.isArray(data?.invited) ? data.invited : [];
    state.referralMinTasks = Number(data?.referralMinTasks) || 2;
    state.referralInitialRewardPoints = Number(data?.referralInitialRewardPoints ?? data?.referralBonusPoints) || 0;
    state.referralTasks = Array.isArray(data?.referralTasks) ? data.referralTasks : [];
    state.referralDataLoaded = true;
  } catch (error) {
    console.warn("Referral data failed:", error);
    if (requestId !== referralDataRequestSequence) return;
    if (!state.referralDataLoaded) state.referralError = error?.message || t("referral_load_error");
  } finally {
    if (requestId !== referralDataRequestSequence) return;
    state.referralLoading = false;
    if (state.activeTab === "profile" && (profileView === "referral" || profileView === "menu")) renderProfile();
    else if (state.activeTab === "home") renderHome();
    else if (state.activeTab === "tasks") renderTasks();
  }
}

async function claimReferralTask(taskId) {
  if (!readModelActionAllowed()) return;
  const task = state.referralTasks.find(item => item.id === taskId);
  if (!task || task.status !== "claimable") return;

  const button = findByData("[data-referral-claim]", "referralClaim", taskId);
  if (button) {
    button.disabled = true;
    button.textContent = t("referral_claiming");
  }

  try {
    const data = await api("/api/referral/claim", { method: "POST", body: { taskId } });
    state.points = Number(data?.points) || state.points;
    state.invitedCount = Number(data?.invitedCount) || state.invitedCount;
    state.activeInvitedCount = Number(data?.activeInvitedCount) || state.activeInvitedCount;
    state.referralTasks = Array.isArray(data?.referralTasks) ? data.referralTasks : state.referralTasks;
    await loadReferralData({ force: true });
    haptic("success");
    toast(t("referral_claim_success", { n: formatPoints(task.rewardPoints) }), "success");
    if (state.activeTab === "tasks") renderTasks();
    else renderProfile();
  } catch (error) {
    if (button) {
      button.disabled = false;
      button.textContent = t("referral_claim_button");
    }
    haptic("error");
    toast(error.message || t("error_generic"), "error");
  }
}
window.claimReferralTask = claimReferralTask;

function setTaskSection(section) {
  const next = ["daily", "vip", "invite"].includes(String(section)) ? String(section) : "daily";
  state.taskSection = next;
  if (next === "invite" && !state.referralDataLoaded && !state.referralLoading) void loadReferralData();
  renderTasks();
}
window.setTaskSection = setTaskSection;
async function loadSquads({ force = false } = {}) {
  if (state.squadsLoading || (!force && state.squadsLoaded)) return;
  state.squadsLoading = true;
  state.squadsError = "";
  try {
    const data = await api("/api/squads");
    state.squads = Array.isArray(data?.leaderboard) ? data.leaderboard : [];
    state.mySquad = data?.squad || null;
    state.squadsLoaded = true;
  } catch (error) {
    state.squadsError = error?.message || t("squad_load_error");
  } finally {
    state.squadsLoading = false;
    if (state.activeTab === "tasks" && state.taskSection === "invite") renderTasks();
    if (state.activeTab === "profile" && profileView === "groups") renderProfile();
  }
}
function renderSquadsCard() {
  const leaderboard = state.squads.map(row => `<li class="squadRankRow"><span>#${formatPoints(row.rank)}</span><strong>${escapeHTML(row.title)}</strong><a href="${escapeHTML(row.url)}" target="_blank" rel="noopener">@${escapeHTML(row.username)}</a><b>${tokenAmount(Number(row.score) || 0)} UP</b><small>${formatPoints(row.membersCount)} ${t("squad_members")}</small></li>`).join("");
  const mySquad = state.mySquad ? `<div class="squadCurrent"><strong>${escapeHTML(state.mySquad.title)}</strong><a href="${escapeHTML(state.mySquad.url)}" target="_blank" rel="noopener">@${escapeHTML(state.mySquad.username)}</a><button type="button" class="secondaryBtn" onclick="leaveSquad()">${t("squad_leave")}</button></div>` : "";
  return `<section class="card squadPanel"><div class="cardHeader"><div class="cardTitle">${t("squad_title")}</div><button type="button" class="secondaryBtn" onclick="loadSquads({force:true})">${t("squad_refresh")}</button></div><p class="cardSubtitle">${t("squad_desc")}</p>${state.squadsError ? `<p class="errorText">${escapeHTML(state.squadsError)}</p>` : ""}${mySquad}<div class="squadForm"><input id="squadTelegramLink" type="text" maxlength="200" placeholder="${escapeHTML(t("squad_link_placeholder"))}" autocomplete="off"><input id="squadTitleInput" type="text" maxlength="64" placeholder="${escapeHTML(t("squad_name_placeholder"))}" autocomplete="off"><div class="squadActions"><button type="button" class="primaryBtn" onclick="createSquad()" ${state.mySquad ? "disabled" : ""}>${t("squad_create")}</button><button type="button" class="secondaryBtn" onclick="joinSquad()" ${state.mySquad ? "disabled" : ""}>${t("squad_join")}</button></div></div><h3>${t("squad_top20")}</h3>${leaderboard ? `<ol class="squadLeaderboard">${leaderboard}</ol>` : `<p class="emptyDesc">${state.squadsLoading ? t("history_loading") : t("squad_empty")}</p>`}</section>`;
}
function renderReferralTierSummary() {
  const stats = state.referralStats || {};
  const numberOrDash = value => state.referralDataLoaded ? formatNumber(Number(value) || 0) : "—";
  const amountOrDash = value => state.referralDataLoaded ? tokenAmount(Number(value) || 0) : "—";
  return `<section class="card referralTierSummary"><div class="cardHeader"><div class="cardTitle">${t("referral_team_commission_title")}</div></div><div class="squadCurrent"><span><strong>${t("referral_tier1_members")}</strong><small> · 10% · ${numberOrDash(stats.tier1Members)} ${t("referral_members_label")}</small></span><b>${amountOrDash(stats.miningCommissionByTier?.["1"])} UP</b></div><div class="squadCurrent" style="margin-top:8px"><span><strong>${t("referral_tier2_members")}</strong><small> · 2.5% · ${numberOrDash(stats.tier2Members)} ${t("referral_members_label")}</small></span><b>${amountOrDash(stats.miningCommissionByTier?.["2"])} UP</b></div></section>`;
}
async function createSquad() {
  const telegramLink = document.getElementById("squadTelegramLink")?.value.trim();
  const title = document.getElementById("squadTitleInput")?.value.trim();
  try { await api("/api/squads", { method: "POST", body: JSON.stringify({ telegramLink, title }) }); toast(t("squad_created"), "success"); await loadSquads({ force: true }); }
  catch (error) { toast(error.message || t("error_generic"), "error"); }
}
async function joinSquad() {
  const telegramLink = document.getElementById("squadTelegramLink")?.value.trim();
  try { await api("/api/squads/join", { method: "POST", body: JSON.stringify({ telegramLink }) }); toast(t("squad_joined"), "success"); await loadSquads({ force: true }); }
  catch (error) { toast(error.message || t("error_generic"), "error"); }
}
async function leaveSquad() {
  if (!confirm(t("squad_leave_confirm"))) return;
  try { await api("/api/squads/me", { method: "DELETE" }); toast(t("squad_left"), "success"); await loadSquads({ force: true }); }
  catch (error) { toast(error.message || t("error_generic"), "error"); }
}
window.loadSquads = loadSquads;
window.createSquad = createSquad;
window.joinSquad = joinSquad;
window.leaveSquad = leaveSquad;
let tasksRequestSequence = 0;
let tasksLoadError = null;
async function loadTasks({ force = false } = {}) {
  const requestId = ++tasksRequestSequence;
  if (!force && !state.readModelStale && state.tasksLoadedAt && Date.now() - state.tasksLoadedAt < CLIENT_DATA_TTL_MS) return state.tasks;
  try {
    const data = await api("/api/tasks");
    if (requestId !== tasksRequestSequence) return state.tasks;
    tasksLoadError = null;
    state.tasks = Array.isArray(data?.tasks) ? data.tasks : [];
    state.completions = Array.isArray(data?.completions) ? data.completions : [];
    latestPostOpenedTaskIds.clear();
    latestPostOpenedAt.clear();
    (Array.isArray(data?.latestPostStates) ? data.latestPostStates : []).forEach(item => {
      if (item?.task && item.openedAt) { latestPostOpenedTaskIds.add(String(item.task)); latestPostOpenedAt.set(String(item.task), Date.parse(item.openedAt)); }
    });
    const serverNow = Number(data?.serverNow);
    state.tasksServerOffsetMs = Number.isFinite(serverNow) ? serverNow - Date.now() : 0;
    state.tasksLoadedAt = Date.now();
    state.readModelTasksConfirmed = true;
    updateReadModelFreshness();
    persistReadModelCache();
    return state.tasks;
  } catch (error) {
    console.warn("Tasks failed:", error);
    if (requestId === tasksRequestSequence) tasksLoadError = error;
    return state.tasks;
  }
}

/* ================= TRANSACTION HISTORY (LEDGER) ================= */
let historyList = [];
let historyHasMore = false;
let historyLoading = false;
let historyCursor = "";
let historyLoadError = null;
let historyRequestSequence = 0;

const LEDGER_TYPE_UI = {
  task: { icon: "✅" },
  checkin: { icon: "📅" },
  spin: { icon: "🎡" },
  spin_paid: { icon: "🎡" },
  referral_bonus: { icon: "👥" },
  referral_initial: { icon: "🎁" },
  referral_commission: { icon: "💸" },
  leaderboard_reward: { icon: "🏆" },
  exchange_out: { icon: "⇄" },
  exchange_in: { icon: "⇄" },
  withdraw: { icon: "➤" },
  deposit: { icon: "💎" },
  vip_purchase: { icon: "💎" },
  vip_daily_reward: { icon: "🎁" },
  vip_principal_return: { icon: "↩️" },
  admin_adjust: { icon: "🛠️" }
};

async function loadHistory(reset = true) {
  if (historyLoading && !reset) return false;
  const requestId = ++historyRequestSequence;
  historyLoading = true;
  const cursor = reset ? "" : historyCursor;
  try {
    const suffix = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    const data = await api(`/api/points/history?limit=30${suffix}`);
    if (requestId !== historyRequestSequence) return false;
    const items = Array.isArray(data?.history) ? data.history : [];
    historyList = reset ? items : historyList.concat(items);
    historyHasMore = Boolean(data?.hasMore);
    historyCursor = String(data?.nextCursor || "");
    historyLoadError = null;
    return true;
  } catch (error) {
    console.warn("History failed:", error);
    if (requestId === historyRequestSequence) historyLoadError = error;
    return false;
  } finally {
    if (requestId === historyRequestSequence) historyLoading = false;
  }
}

async function loadMoreHistory() {
  const btn = $("#historyLoadMoreBtn");
  if (btn) { btn.disabled = true; btn.textContent = t("history_loading"); }
  await loadHistory(false);
  renderProfile();
}
window.loadMoreHistory = loadMoreHistory;

let leaderboardLoadError = null;
let leaderboardRequestSequence = 0;
async function loadLeaderboard() {
  const requestId = ++leaderboardRequestSequence;
  try {
    const data = await api("/api/leaderboard/top");
    if (requestId !== leaderboardRequestSequence) return state.leaderboard;
    if (!Array.isArray(data?.top)) throw new Error("Invalid leaderboard response");
    leaderboardLoadError = null;
    state.leaderboard = Array.isArray(data?.top) ? data.top : [];
    state.myRank = data?.myRank ?? null;
    return state.leaderboard;
  } catch (error) {
    console.warn("Leaderboard failed:", error);
    if (requestId === leaderboardRequestSequence) leaderboardLoadError = error;
    return state.leaderboard;
  }
}

let weeklyLeaderboardLoadError = null;
let weeklyLeaderboardRequestSequence = 0;
async function loadWeeklyLeaderboard() {
  const requestId = ++weeklyLeaderboardRequestSequence;
  try {
    const data = await api("/api/leaderboard/weekly");
    if (requestId !== weeklyLeaderboardRequestSequence) return state.weeklyLeaderboard;
    if (!Array.isArray(data?.top)) throw new Error("Invalid weekly leaderboard response");
    weeklyLeaderboardLoadError = null;
    state.weeklyLeaderboard = Array.isArray(data?.top) ? data.top : [];
    state.weeklyMyRank = data?.myRank ?? null;
    state.weeklyMyPoints = Number(data?.myPoints) || 0;
    state.weeklyLeaderboardMeta = data || null;
    const serverNow = Number(data?.serverNow);
    state.weeklyServerOffsetMs = Number.isFinite(serverNow) ? serverNow - Date.now() : 0;
    return state.weeklyLeaderboard;
  } catch (error) {
    console.warn("Weekly leaderboard failed:", error);
    if (requestId === weeklyLeaderboardRequestSequence) weeklyLeaderboardLoadError = error;
    return state.weeklyLeaderboard;
  }
}

/* ================= HOME ================= */
function updateSpinHeaderStats() {
  const enabled = state.spinEnabled;
  const tickets = document.querySelector('[data-spin-tickets]');
  const balance = document.querySelector('[data-spin-balance]');
  const status = document.querySelector('[data-spin-status]');
  const paidButton = document.querySelector('[data-paid-spin]');
  const paymentNotice = document.querySelector('[data-spin-payment-notice]');
  if (tickets) tickets.textContent = formatNumber(Number(state.tickets) || 0);
  if (balance) balance.innerHTML = `<span class="spinBalanceAmount">${escapeHTML(formatPoints(state.points))}</span>${tokenIconMarkup()}<span class="spinBalanceUnit">UP</span>`;
  if (paidButton) paidButton.disabled = !enabled || state.spinBusy || Number(state.points) < 50;
  if (paymentNotice) {
    paymentNotice.hidden = Number(state.points) >= 50;
    paymentNotice.textContent = paymentNotice.hidden ? '' : t('spin_insufficient_balance', {}, 'You need at least 50 UP to spin.');
  }
  if (status) { status.textContent = enabled ? t('spin_ready', {}, 'READY') : t('spin_disabled', {}, 'OFF'); status.className = `spinHeaderStatValue ${enabled ? 'is-ready' : ''}`; }
}
function spinPrizeLabel(prizeId, amount) {
  if (["up_50", "up_100", "up_250"].includes(prizeId)) return t("spin_prize_up", { n: formatPoints(amount) });
  if (prizeId === "hashrate_boost_10_1h") return t("spin_prize_boost_10");
  if (prizeId === "gram_005") return t("spin_prize_gram", { n: formatNumber(amount, 2) });
  return t("spin_prize_try_again");
}
function spinSliceText(prize, index) {
  const fallback = [["10%", "Mining"], ["+50", "UP"], ["+100", "UP"], ["+250", "UP"], ["0", "UP"], ["2 Extra", "Spins"]][index] || ["", ""];
  const label = String(prize?.label || '').trim();
  if (!label) return fallback;
  const match = label.match(/^(\S+)\s+(.+)$/);
  return match ? [match[1], match[2]] : [label, ''];
}
function updateSpinControls() {
  updateSpinHeaderStats();
  const label = document.querySelector("[data-spin-availability]");
  const button = document.querySelector("#spinButton");
  if (!label || !button) return;
  const tickets = Number(state.tickets) || 0;
  if (!state.spinEnabled) {
    label.textContent = t('spin_disabled', {}, 'Lucky Spin is currently unavailable');
    button.disabled = true;
    button.classList.add('is-locked');
    button.textContent = t('spin_spin_now', {}, 'SPIN NOW');
    return;
  }
  label.textContent = tickets > 0
    ? t('spin_ticket_ready', { count: tickets }, `${tickets} free spin ticket${tickets === 1 ? '' : 's'} ready`)
    : t('spin_ticket_after_streak', { days: state.spinRequiredStreak }, `Complete a ${state.spinRequiredStreak}-day streak to get 1 free spin`);
  button.classList.toggle('is-locked', tickets < 1);
  button.disabled = state.spinBusy || tickets < 1;
  button.textContent = state.spinBusy ? t("spin_spinning") : t('spin_spin_now', {}, 'SPIN NOW');
}
function renderLuckySpin() {
  const enabled = state.spinEnabled;
  const tickets = Number(state.tickets) || 0;
  const prizes = [
    { label: "10% Mining", kind: "boost" }, { label: "2 Extra Spins", kind: "none" }, { label: "0 UP", kind: "points", amount: 0 },
    { label: "+50 UP", kind: "points", amount: 50 }, { label: "+100 UP", kind: "points", amount: 100 }, { label: "+250 UP", kind: "points", amount: 250 }
  ];
  const buttonLocked = !enabled || tickets < 1;
  const buttonLabel = t('spin_spin_now', {}, 'SPIN NOW');
  const rewardIcon = (_prize, index) => {
    if (index === 1) return `<svg class="spinRewardIcon spinRewardIcon--extra" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 7v5h-5"/><path d="M4.9 9a8 8 0 0 1 13.2-2L20 12M4 17v-5h5"/><path d="M19.1 15a8 8 0 0 1-13.2 2L4 12"/></svg>`;
    if (index === 0) return `<svg class="spinRewardIcon spinRewardIcon--boost" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.2 8.2c5.1-5.1 12.9-5.1 18 0l-3.7 3.7c-3-3-7.6-3-10.6 0L3.2 8.2Z"/><path d="m8.5 13.5 10 10M5.5 16.5l-3 3"/></svg>`;
    return `<img class="spinRewardIcon spinRewardIcon--up" src="/img/gramup-logo-cube-transparent.png" alt="" aria-hidden="true">`;
  };
  return `<section class="spinCard ${enabled ? '' : 'is-locked'}" aria-label="${t("spin_aria")}">
    <div class="spinWinnersMarquee" data-spin-winners hidden role="region" aria-label="${escapeHTML(t('spin_winners_latest', {}, 'Recent winners:'))}"><strong class="spinWinnersLabel">${escapeHTML(t('spin_winners_latest', {}, 'Recent winners:'))}</strong><div class="spinWinnersViewport"><div class="spinWinnersTrack" data-spin-winners-track></div></div></div>
    <div class="spinStage"><div class="spinPointer" aria-hidden="true"><i></i><b></b></div><div id="spinWheel" class="spinWheel" role="img" aria-label="${t("spin_aria")}"><div class="spinRimGeometry" aria-hidden="true">${Array.from({ length: 12 }, (_, i) => `<i style="--r:${i * 30}deg"></i>`).join("")}</div><div class="spinRivets" aria-hidden="true">${Array.from({ length: 12 }, (_, i) => `<i style="--r:${i * 30}deg"></i>`).join("")}</div>${prizes.map((prize, index) => { const [top, bottom] = spinSliceText(prize, index); return `<span class="spinSliceLabel" style="--i:${index}">${rewardIcon(prize, index)}<b>${escapeHTML(top)}</b><small>${escapeHTML(bottom)}</small></span>`; }).join("")}<div class="spinWheelHub" aria-hidden="true"><img class="spinHubLogo" src="/img/gramup-logo-cube-transparent.png" alt=""></div></div></div>
    <div class="spinFooter"><span class="spinAvailability" data-spin-availability>${tickets > 0 ? t('spin_ticket_ready', { count: tickets }, `${tickets} free spin ticket${tickets === 1 ? '' : 's'} ready`) : t('spin_ticket_after_streak', { days: state.spinRequiredStreak }, `Complete a ${state.spinRequiredStreak}-day streak to get 1 free spin`)}</span><button id="spinButton" class="primaryBtn spinButton ${buttonLocked ? 'is-locked' : ''}" type="button" onclick="doSpin()" ${buttonLocked ? "disabled" : ""}>${buttonLabel}</button><button type="button" class="spinPaidButton" data-paid-spin onclick="paySpinAlternative()" ${!enabled || state.spinBusy || state.points < 50 ? "disabled" : ""}>${t('spin_pay_50', {}, 'Pay 50 UP to Spin')}</button><small class="spinBalanceNotice" data-spin-payment-notice role="alert" hidden></small></div>
    <div id="spinResult" class="spinResult" role="status" aria-live="polite"></div>
  </section>`;
}
function renderLuckySpinBanner() {
  const enabled = state.spinEnabled;
  const tickets = Number(state.tickets) || 0;
  const subtitle = !enabled
    ? t('spin_disabled', {}, 'Lucky Spin is currently unavailable')
    : tickets > 0
      ? t('spin_ticket_ready', { count: tickets }, `${tickets} free spin ticket${tickets === 1 ? '' : 's'} ready`)
      : t('spin_ticket_after_streak', { days: state.spinRequiredStreak }, `Complete a ${state.spinRequiredStreak}-day streak to get 1 free spin`);
  const status = enabled
    ? `<span class="spinLaunchStatus is-ready">${t('spin_ready', {}, 'Ready')}</span>`
    : `<span class="spinLaunchStatus">${t('spin_disabled', {}, 'Unavailable')}</span>`;
  const lock = '';
  const canOpen = state.spinEnabled;
  return `<section class="spinLaunchCard ${enabled ? 'is-ready' : 'is-locked'}" aria-labelledby="spinLaunchTitle">
    <div class="spinLaunchIcon" aria-hidden="true"><span class="spinLaunchWheel"><i></i><i></i><i></i><i></i><i></i><i></i><b>✦</b></span></div>
    <div class="spinLaunchCopy"><strong id="spinLaunchTitle">${t('spin_title')}</strong><small>${subtitle}</small></div>
    <div class="spinLaunchAction">${status}<button class="spinLaunchButton" type="button" onclick="${canOpen ? 'openLuckySpin()' : ''}" ${canOpen ? '' : 'disabled'}>${lock}${t('spin_spin_button', {}, 'Open')}</button></div>
  </section>`;
}
function closeLuckySpin() { const overlay = document.querySelector('#luckySpinOverlay'); if (overlay) overlay.remove(); document.body.classList.remove('luckySpinOpen'); state.spinModalOpen = false; }
function openLuckySpin() {
  if (!state.spinEnabled) return;
  haptic("light");
  closeLuckySpin();
  const overlay = document.createElement('div'); overlay.id = 'luckySpinOverlay'; overlay.className = 'luckySpinScreen';
  overlay.innerHTML = `<main class="luckySpinPage" aria-label="Lucky Spin"><header class="luckySpinPageHeader"><div class="spinBrand"><img src="/img/gramup-logo-cube-transparent.png" alt="Gramup"><div class="spinBrandCopy"><strong>Gramup Spinner</strong><small>Collect tickets, spin the wheel!</small></div></div><button class="luckySpinClose" type="button" onclick="closeLuckySpin()" aria-label="Close">×</button></header><div class="spinHeaderStats" aria-label="Lucky Spin status"><div class="spinHeaderStat"><span>STATUS</span><strong data-spin-status>READY</strong></div><div class="spinHeaderStat"><span>${t('spin_balance_label', {}, 'UP BALANCE')}</span><strong class="spinHeaderBalance" data-spin-balance></strong></div><div class="spinHeaderStat"><span>TICKETS</span><strong data-spin-tickets>0</strong></div></div><div class="luckySpinPageBody">${renderLuckySpin()}</div></main>`;
  document.body.appendChild(overlay); document.body.classList.add('luckySpinOpen'); state.spinModalOpen = true; updateSpinControls(); loadSpinWinners();
}
window.openLuckySpin = openLuckySpin; window.closeLuckySpin = closeLuckySpin;
function prepareSpinAudio() {
  try { window.GramupGamification?.prepareAudio?.(); } catch { /* optional audio must not block a spin */ }
}
function populateSpinWinners(winners) {
  const marquee = document.querySelector('[data-spin-winners]');
  const track = marquee?.querySelector('[data-spin-winners-track]');
  if (!marquee || !track) return;
  track.replaceChildren();
  if (!Array.isArray(winners) || winners.length === 0) { marquee.hidden = true; return; }
  const group = document.createElement('div');
  group.className = 'spinWinnersGroup';
  for (const winner of winners) {
    const item = document.createElement('span');
    item.className = 'spinWinnerItem';
    const name = document.createElement('strong');
    name.textContent = String(winner?.name || 'User ***');
    const won = document.createElement('span');
    won.textContent = t('spin_winner_won', {}, 'won:');
    const prize = document.createElement('b');
    prize.textContent = spinPrizeLabel(String(winner?.prizeId || ''), Number(winner?.amount) || 0);
    item.append(name, won, prize);
    group.appendChild(item);
  }
  track.append(group, group.cloneNode(true));
  track.lastElementChild?.setAttribute('aria-hidden', 'true');
  marquee.hidden = group.childElementCount === 0;
}
async function loadSpinWinners() {
  try {
    const result = await api('/api/points/spin/recent-winners');
    populateSpinWinners(result?.winners);
  } catch {
    populateSpinWinners([]);
  }
}
function spinTickFeedback() {
  const feedback = window.GramupGamification;
  if (!feedback) return;
  try { feedback.playTickSound?.(); feedback.triggerHaptic?.('tick'); } catch { /* optional feedback */ }
}
function spinWinFeedback() {
  const feedback = window.GramupGamification;
  if (!feedback) { haptic('success'); return; }
  try { feedback.playWinSound?.(); feedback.triggerHaptic?.('win'); } catch { haptic('success'); }
}
function spinWheelRotationDegrees(wheel) {
  const transform = getComputedStyle(wheel).transform;
  if (!transform || transform === 'none') return 0;
  const values = transform.slice(transform.indexOf('(') + 1, -1).split(',').map(Number);
  if (values.length < 2 || !Number.isFinite(values[0]) || !Number.isFinite(values[1])) return 0;
  return Math.atan2(values[1], values[0]) * 180 / Math.PI;
}
function requestSpinFrame(callback) {
  if (typeof window.requestAnimationFrame === 'function') return { animationFrame: true, id: window.requestAnimationFrame(callback) };
  return { animationFrame: false, id: setTimeout(callback, 16) };
}
function cancelSpinFrame(frame) {
  if (!frame) return;
  if (frame.animationFrame) window.cancelAnimationFrame?.(frame.id);
  else clearTimeout(frame.id);
}
function runSpinWheelAnimation(wheel) {
  if (!wheel) return Promise.resolve();
  wheel.classList.remove('spinWheelRun');
  void wheel.offsetWidth;
  const transitionMs = getComputedStyle(wheel).transitionDuration.split(',').reduce((max, duration) => {
    const value = duration.trim();
    const ms = Number.parseFloat(value) * (value.endsWith('ms') ? 1 : 1000);
    return Number.isFinite(ms) ? Math.max(max, ms) : max;
  }, 0);
  return new Promise(resolve => {
    let settled = false;
    let fallbackTimer;
    let frame = null;
    let previousAngle = spinWheelRotationDegrees(wheel);
    let rotatedDegrees = 0;
    let nextTickDegrees = 60;
    const emitCrossedTicks = () => {
      const angle = spinWheelRotationDegrees(wheel);
      const delta = ((angle - previousAngle + 540) % 360) - 180;
      if (delta > 0) rotatedDegrees += delta;
      previousAngle = angle;
      while (rotatedDegrees + 0.01 >= nextTickDegrees && nextTickDegrees <= 1440) {
        spinTickFeedback();
        nextTickDegrees += 60;
      }
    };
    const pollRotation = () => {
      if (settled) return;
      emitCrossedTicks();
      frame = requestSpinFrame(pollRotation);
    };
    const finish = () => {
      if (settled) return;
      emitCrossedTicks();
      settled = true;
      clearTimeout(fallbackTimer);
      cancelSpinFrame(frame);
      wheel.removeEventListener('transitionend', onTransitionEnd);
      resolve();
    };
    const onTransitionEnd = event => {
      if (event.target === wheel && event.propertyName === 'transform') finish();
    };
    wheel.addEventListener('transitionend', onTransitionEnd);
    wheel.classList.add('spinWheelRun');
    fallbackTimer = setTimeout(finish, Math.max(transitionMs + 150, 150));
    if (transitionMs === 0) finish();
    else frame = requestSpinFrame(pollRotation);
  });
}
function presentSpinResult(result, resultBox) {
  const prize = result.prize && typeof result.prize === 'object' ? result.prize : {};
  const amount = Number(result.amount ?? prize.amount) || 0;
  const prizeId = String(result.prizeId ?? prize.id ?? '');
  const prizeLabel = String(result.prizeLabel || prize.label || spinPrizeLabel(prizeId, amount));
  const celebration = window.GramupSpinCelebration;
  if (!celebration?.show) {
    if (resultBox) resultBox.textContent = t('spin_result', { label: prizeLabel });
    toast(prizeLabel, 'success');
    return;
  }
  if (resultBox) resultBox.textContent = '';
  celebration.show({
    title: amount > 0 ? t('spin_win_title', {}, 'You won!') : t('spin_win_empty_title', {}, 'Spin result'),
    subtitle: amount > 0
      ? t('spin_win_subtitle', {}, 'Your reward has been added to your balance.')
      : t('spin_win_try_again', {}, 'No reward this time. Spin again!'),
    prizeId,
    amount,
    prizeLabel,
    claimLabel: t('spin_win_claim', {}, 'Claim prize'),
    shareLabel: t('spin_win_share', {}, 'Share result'),
    shareText: t('spin_win_share_text', { prize: prizeLabel }, `I won ${prizeLabel} on Gramup Spinner!`),
    appUrl: `${window.location.origin}${window.location.pathname}`
  });
}
async function doSpin() {
  if (!readModelActionAllowed() || !state.spinEnabled || Number(state.tickets) < 1 || state.spinBusy) return;
  prepareSpinAudio();
  state.spinBusy = true;
  updateSpinControls();
  haptic("light");
  const button = document.querySelector("#spinButton");
  const wheel = document.querySelector("#spinWheel");
  const resultBox = document.querySelector("#spinResult");
  if (button) { button.disabled = true; button.textContent = t("spin_spinning"); }
  try {
    const result = await api("/api/points/spin", { method: "POST", headers: { "Idempotency-Key": getPendingIdempotencyKey("spin") } });
    await runSpinWheelAnimation(wheel);
    clearPendingIdempotencyKey("spin");
    const updatedBalance = Number(result.newBalance ?? result.upBalance ?? result.points);
    if (Number.isFinite(updatedBalance)) state.points = updatedBalance;
    state.tickets = Number(result.tickets) || 0;
    const updatedGramBalance = Number(result.gramBalance);
    if (Number.isFinite(updatedGramBalance)) state.gramBalance = updatedGramBalance;
    state.spinLastClaimAt = new Date().toISOString();
    state.miningBoostUntil = result.boostUntil || state.miningBoostUntil;
    spinWinFeedback();
    presentSpinResult(result, resultBox);
    updateHeader();
    loadSpinWinners();
  } catch (error) {
    clearDefinitiveIdempotencyFailure("spin", error);
    haptic("error");
    if (resultBox) resultBox.textContent = translateServerMessage(error.code, error.message);
    toast(translateServerMessage(error.code, error.message), "error");
  } finally { state.spinBusy = false; updateSpinControls(); }
}
window.doSpin = doSpin;
async function paySpinAlternative() {
  if (!readModelActionAllowed() || !state.spinEnabled || state.spinBusy) return;
  if (Number(state.points) < 50) { toast(t('spin_insufficient_balance', {}, 'You need at least 50 UP to spin.'), 'error'); return; }
  prepareSpinAudio();
  state.spinBusy = true; haptic('medium');
  const button = document.querySelector('[data-paid-spin]'); const wheel = document.querySelector('#spinWheel'); const resultBox = document.querySelector('#spinResult');
  if (button) { button.disabled = true; button.textContent = t('spin_paying', {}, 'Processing 50 UP...'); }
  updateSpinControls();
  try {
    const result = await api('/api/points/spin/paid', { method: 'POST', headers: { 'Idempotency-Key': getPendingIdempotencyKey('spin_paid') } });
    await runSpinWheelAnimation(wheel);
    clearPendingIdempotencyKey('spin_paid');
    const updatedBalance = Number(result.newBalance ?? result.upBalance ?? result.points);
    if (Number.isFinite(updatedBalance)) state.points = updatedBalance;
    state.tickets = Number(result.tickets) || 0;
    const updatedGramBalance = Number(result.gramBalance);
    if (Number.isFinite(updatedGramBalance)) state.gramBalance = updatedGramBalance;
    state.miningBoostUntil = result.boostUntil || state.miningBoostUntil;
    spinWinFeedback();
    presentSpinResult(result, resultBox);
    updateHeader();
    loadSpinWinners();
  } catch (error) {
    console.error('[Lucky Spin] Paid spin request failed', {
      status: error?.response?.status ?? error?.status ?? 0,
      response: error?.response?.data ?? null,
      code: error?.code ?? null,
      message: error?.message || String(error)
    });
    clearDefinitiveIdempotencyFailure('spin_paid', error);
    haptic('error');
    if (resultBox) resultBox.textContent = translateServerMessage(error.code, error.message);
    toast(translateServerMessage(error.code, error.message), 'error');
  }
  finally {
    state.spinBusy = false;
    if (button) button.textContent = t('spin_pay_50', {}, 'Pay 50 UP to Spin');
    updateSpinControls();
  }
}
window.paySpinAlternative = paySpinAlternative;

function completionStatus(taskId) {
  const found = state.completions.find(c => String(c.task) === String(taskId));
  return found ? found.status : null;
}
function completionRecord(taskId) {
  return state.completions.find(c => String(c.task) === String(taskId)) || null;
}

function renderHome() {
  const approvedTasks = state.completions.filter(c => c.status === "approved").length;
  const level = state.level || { badge: "🥉", name: "Bronze" };
  const withdrawalProgress = Math.min(100, Math.max(0, state.withdrawalProgress));

  const content = $("#content");
  content.innerHTML = `
    <section class="tbCard tbBalance">
      <div class="tbBalanceTop">
        <div class="tbBalanceInfo">
          <div class="tbLabel">${t("tb_total_balance")}</div>
          <div class="tbAmount"><span class="tbAmountNum">${formatFixed(state.gramBalance, 3)}</span><span class="tbAmountUnit">GRAM</span></div>
          <div class="tbPills">
            <span class="tbPill tbPillPurple">${t("tb_UP_chip", { n: formatPoints(state.points) })}</span>
            <span class="tbPill tbPillOrange">${escapeHTML(level.badge)} ${escapeHTML(level.name)}</span>
          </div>
        </div>
        <div class="tbGemRing"><svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="30" fill="#2f9bf0"/><path d="M20 24h24l6 8-18 20L14 32z" fill="#fff"/><path d="M32 30v10M27 35h10" stroke="#2f9bf0" stroke-width="3" stroke-linecap="round"/></svg></div>
      </div>
      <div class="tbActions">
        <button class="tbBtnPrimary" type="button" onclick="showWithdraw()"><span class="tbBtnIcon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg></span>${t("tb_withdraw")}</button>
        <button class="tbBtnGhost" type="button" onclick="openHistory()"><span class="tbBtnIcon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7.5V12l3 2"/></svg></span>${t("tb_history")}</button>
      </div>
    </section>

    <section class="auroraQuickActions" aria-label="${t("section_quick_earn")}">
      <button class="auroraQuickAction auroraQuickDeposit" type="button" onclick="showDeposit()">
        <span class="auroraQuickIcon">＋</span><span>${t("wallet_deposit_button")}</span>
      </button>
      <button class="auroraQuickAction auroraQuickExchange" type="button" onclick="showExchange()">
        <span class="auroraQuickIcon">⇄</span><span>${t("wallet_exchange_button")}</span>
      </button>
      <button class="auroraQuickAction auroraQuickTasks" type="button" onclick="navigate('tasks')">
        <span class="auroraQuickIcon">✓</span><span>${t("tb_tasks")}</span>
      </button>
      <button class="auroraQuickAction auroraQuickReferral" type="button" onclick="openReferralHub()">
        <span class="auroraQuickIcon">↗</span><span>${t("menu_referral")}</span>
      </button>
    </section>
    <section class="auroraDailyCard ${state.canCheckIn ? '' : 'is-claimed'}">
      <div class="auroraDailyIcon">🔥</div>
      <div class="auroraDailyCopy">
        <strong>${t("earn_daily_title")}</strong>
        <span>${state.canCheckIn ? t("earn_daily_sub_available") : t("earn_daily_sub_done")}</span>
      </div>
      <div class="auroraDailyActions">
        ${state.canCheckIn
          ? `<button class="auroraInlineBtn" type="button" onclick="doCheckIn()">${t("checkin_button")}</button>`
          : `<span class="auroraClaimedBadge"><span aria-hidden="true">✓</span>${t("checkin_claimed", {}, "Claimed")}</span><button class="auroraTasksLink" type="button" onclick="navigate('tasks')">${t("tasks_title")}</button>`}
      </div>
    </section>

    ${renderLuckySpinBanner()}

    <div class="card" style="padding:14px 16px">
      <div class="cardHeader" style="margin-bottom:8px">
        <div class="cardTitle">${t("withdrawal_progress_title")}</div>
        <div class="badge info">${withdrawalProgress}%</div>
      </div>
      <div style="height:9px;background:var(--surface-3);border-radius:999px;overflow:hidden">
        <div style="height:100%;width:${withdrawalProgress}%;background:linear-gradient(90deg,var(--tb-blue),var(--primary));border-radius:999px"></div>
      </div>
      <div class="cardSubtitle" style="margin-top:8px">${t("withdrawal_progress_remaining", { n: formatNumber(state.withdrawalRemainingGram, 6) })}</div>
    </div>

    <div class="tbSectionHead">
      <h2 class="tbSectionTitle">${t("tb_your_progress")} <span class="tbSpark" aria-hidden="true">●</span></h2>
      <button class="tbLink" type="button" onclick="navigate('profile')">${t("tb_view_all")} <span class="tbLinkArrow">→</span></button>
    </div>

    <div class="tbStats">
      <div class="tbStat">
        <div class="tbStatIcon">${tokenIconMarkup()}</div>
        <div class="tbStatLabel">${t("tb_earned")}</div>
        <div class="tbStatValue">${tokenAmount(state.totalEarnedPoints)}</div>
      </div>
      <div class="tbStat">
        <div class="tbStatIcon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2A6.5 6.5 0 0 1 21.5 20"/></svg></div>
        <div class="tbStatLabel">${t("tb_referrals")}</div>
        <div class="tbStatValue">${formatPoints(state.invitedCount)}</div>
      </div>
      <div class="tbStat">
        <div class="tbStatIcon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="3.5" width="14" height="17.5" rx="2.5"/><path d="M9 3.5h6v3H9z"/><path d="m9 13.5 2 2 4-4"/></svg></div>
        <div class="tbStatLabel">${t("tb_tasks")}</div>
        <div class="tbStatValue">${formatPoints(approvedTasks)}</div>
      </div>
    </div>

    <section class="auroraTaskPreview">
      <div class="auroraSectionHead">
        <div>
          <h2>${t("tasks_title")}</h2>
          <span>${formatPoints(approvedTasks)} / ${formatPoints(state.tasks.length)} ${t("task_btn_done")}</span>
        </div>
        <button type="button" onclick="navigate('tasks')">${t("tb_view_all")} <span>←</span></button>
      </div>
      <div class="auroraTaskPreviewList">
        ${state.tasks.slice(0, 2).map(task => {
          const status = completionStatus(task._id);
          const icon = taskIconMarkup(task);
          return `<button type="button" class="auroraPreviewTask" onclick="navigate('tasks')">
            <span class="auroraPreviewTaskIcon">${icon}</span>
            <span class="auroraPreviewTaskCopy"><strong>${escapeHTML(task.title)}</strong><small>+${tokenAmount(task.reward)}</small></span>
            <span class="auroraPreviewStatus ${status === "approved" ? "done" : ""}">${status === "approved" ? "✓" : "→"}</span>
          </button>`;
        }).join("") || `<div class="auroraPreviewEmpty">${t("tasks_empty_desc")}</div>`}
      </div>
    </section>

  `;
  updateSpinControls();
}

/* ================= TASKS ================= */
function taskIconMarkup(task) {
  // Latest-post reaction tasks also target Telegram channel posts.
  const telegramTask = task?.verifyType === "telegram" || task?.verifyType === "latest_post" || task?.type === "channel" || task?.type === "group";
  if (telegramTask) return `<span class="taskBrandIcon taskBrandTelegram" aria-label="Telegram"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.4 4.6 18.2 20c-.2 1.1-.8 1.4-1.7.9l-4.8-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.4-4.9 8.9-8c.4-.4-.1-.6-.6-.2L7 13.6l-4.7-1.5c-1-.3-1-1 .2-1.5L20.8 4c.8-.3 1.5.2.6.6Z"/></svg></span>`;
  return `<span class="taskBrandIcon taskBrandWeb" aria-label="Web"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.8 12h16.4M12 3.5c2.3 2.4 3.4 5.2 3.4 8.5s-1.1 6.1-3.4 8.5c-2.3-2.4-3.4-5.2-3.4-8.5S9.7 5.9 12 3.5Z" fill="none" stroke="currentColor" stroke-width="1.4"/></svg></span>`;
}

function safeTaskHttpUrl(value) {
  const text = String(value ?? "").trim();
  if (!text || text.length > 2048) return "";
  try {
    const url = new URL(text);
    if (!["https:", "http:"].includes(url.protocol) || !url.hostname || url.username || url.password) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function openTaskLinkOnly(url) {
  const safeUrl = safeTaskHttpUrl(url);
  if (!safeUrl) return;
  if (tg?.openLink) tg.openLink(safeUrl);
  else window.open(safeUrl, "_blank", "noopener,noreferrer");
}
window.openTaskLinkOnly = openTaskLinkOnly;

document.addEventListener("click", event => {
  const vipClaimButton = event.target?.closest?.("[data-vip-claim]");
  if (vipClaimButton) {
    event.preventDefault();
    void claimVipReward(vipClaimButton.dataset.vipClaim);
    return;
  }
  const referralButton = event.target?.closest?.("[data-referral-claim]");
  if (referralButton) {
    event.preventDefault();
    void claimReferralTask(referralButton.dataset.referralClaim);
    return;
  }
  const latestPostCheckButton = event.target?.closest?.("[data-latest-post-check]");
  if (latestPostCheckButton) {
    event.preventDefault();
    void verifyLatestPostTask(latestPostCheckButton.dataset.latestPostCheck);
    return;
  }
  const verifyButton = event.target?.closest?.("[data-verify]");
  if (verifyButton) {
    event.preventDefault();
    void verifyTelegramTask(verifyButton.dataset.verify);
    return;
  }
  const screenshotButton = event.target?.closest?.("[data-upload-screenshot]");
  if (screenshotButton) {
    event.preventDefault();
    chooseScreenshotFile(screenshotButton.dataset.uploadScreenshot);
    return;
  }
  const withdrawalButton = event.target?.closest?.("[data-withdrawal-id]");
  if (withdrawalButton) {
    event.preventDefault();
    void openWithdrawalDetail(withdrawalButton.dataset.withdrawalId);
    return;
  }
  const button = event.target?.closest?.("[data-task-open-url]");
  if (!button) return;
  event.preventDefault();
  const url = button.dataset.taskOpenUrl;
  const taskId = button.dataset.latestPostOpen;
  if (taskId) void openLatestPostTask(url, taskId);
  else openTaskLinkOnly(url);
});

async function openLatestPostTask(url, taskId) {
  if (!readModelActionAllowed()) return;
  const id = String(taskId || "");
  if (!id || !url || latestPostOpeningTaskIds.has(id)) return;

  latestPostOpeningTaskIds.add(id);
  const button = findByData("[data-latest-post-open]", "latestPostOpen", id);
  if (button) button.disabled = true;
  const openRequest = api(`/api/tasks/${encodeURIComponent(id)}/engagement/open`, { method: "POST" });

  // Open the Telegram link in the original user gesture so Telegram/WebView does not block it.
  try { openTaskLinkOnly(url); } catch (error) { console.warn("Latest Post link could not be opened:", error); }

  try {
    const result = await openRequest;
    latestPostOpenedTaskIds.add(id);
    latestPostOpenedAt.set(id, Date.now() + Number(state.tasksServerOffsetMs || 0));
    delete taskHints[id];
    const serverNow = Number(result.serverNow);
    if (Number.isFinite(serverNow)) state.tasksServerOffsetMs = serverNow - Date.now();
    await loadTasks({ force: true });
    if (state.activeTab === "tasks") renderTasks();
  } catch (error) {
    latestPostOpenedTaskIds.delete(id);
    latestPostOpenedAt.delete(id);
    taskHints[id] = { type: "error", message: translateServerMessage(error.code, error.message) };
    haptic("error");
    toast(taskHints[id].message, error.code === "TASK_COOLDOWN_ACTIVE" ? "warning" : "error");
    await loadTasks({ force: true });
    if (state.activeTab === "tasks") renderTasks();
  } finally {
    latestPostOpeningTaskIds.delete(id);
  }
}
window.openLatestPostTask = openLatestPostTask;

async function refreshLatestPostTasksOnReturn() {
  if (document.visibilityState !== "visible" || !state.initialized || state.gateActive ||
      !latestPostOpenedTaskIds.size || state.activeTab !== "tasks") return;
  await loadTasks({ force: true });
  renderTasks();
}
document.addEventListener("visibilitychange", refreshLatestPostTasksOnReturn);
window.addEventListener("pageshow", refreshLatestPostTasksOnReturn);

function chooseScreenshotFile(taskId) {
  findByData('input[data-screenshot-task]', 'screenshotTask', taskId)?.click();
}
window.chooseScreenshotFile = chooseScreenshotFile;

document.addEventListener("change", event => {
  const input = event.target?.closest?.("input[data-screenshot-task]");
  if (!input) return;
  void submitScreenshotTask(input.dataset.screenshotTask, input.files?.[0], input);
});

async function submitScreenshotTask(taskId, file, input) {
  if (!readModelActionAllowed()) return;
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    toast(t("task_submission_too_large"), "error");
    if (input) input.value = "";
    return;
  }
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    toast(t("task_submission_invalid_image"), "error");
    if (input) input.value = "";
    return;
  }

  const button = findByData("[data-upload-screenshot]", "uploadScreenshot", taskId);
  const previousText = button?.textContent || "";
  if (button) { button.disabled = true; button.textContent = t("task_action_uploading"); }
  try {
    const formData = new FormData();
    formData.append("screenshot", file, file.name || "screenshot");
    const result = await api(`/api/tasks/${encodeURIComponent(taskId)}/submission`, { method: "POST", body: formData });
    haptic("success");
    toast(result.message || t("task_submission_pending"), "success");
    await loadTasks({ force: true });
    renderTasks();
  } catch (error) {
    haptic("error");
    toast(error.message || t("error_generic"), "error");
    if (button) { button.disabled = false; button.textContent = previousText || `📸 ${t("task_action_upload")}`; }
  } finally {
    if (input) input.value = "";
  }
}
window.submitScreenshotTask = submitScreenshotTask;

// صفحه‌ی عمومی «تاریخچه‌ی پرداخت‌ها» — بدون نیاز به لاگین، لینک‌های Tonviewer، برای اثبات پرداخت واقعی
function openProofPage() {
  haptic("selection");
  openTaskLinkOnly(`${location.origin}/proof.html`);
}
window.openProofPage = openProofPage;

function openPayoutChannel() {
  haptic("selection");
  openTaskLinkOnly("https://t.me/GramUpPayouts");
}
window.openPayoutChannel = openPayoutChannel;

/**
 * راهنمای پایدار زیر هر تسک، بعد از تلاش ناموفق برای تایید — کلید taskId.
 * بر خلاف toast (که بعد از ۲.۸ ثانیه محو می‌شود)، این راهنما تا اقدام بعدی
 * کاربر (یا موفقیت تسک) روی صفحه باقی می‌ماند، تا واقعاً بداند چه کاری
 * باید انجام بدهد، نه فقط اینکه «رد شد».
 */
const taskHints = {};

/** تسک‌های تلگرامی: بررسی خودکار عضویت با API ربات */
async function verifyTelegramTask(taskId) {
  if (!readModelActionAllowed()) return;
  const button = findByData("[data-verify]", "verify", taskId);
  if (button) { button.disabled = true; button.textContent = t("task_action_verifying"); }

  try {
    const result = await api(`/api/tasks/${encodeURIComponent(taskId)}/claim`, { method: "POST" });
    haptic("success");
    toast(result.message, "success");
    delete taskHints[taskId];
    state.points = Number(result.points) || state.points;
    await loadTasks({ force: true });
    updateHeader();
    renderTasks();
  } catch (error) {
    haptic("error");
    const task = state.tasks.find(item => String(item._id) === String(taskId));

    if (error.code === "NOT_JOINED") {
      toast(t("toast_verify_needs_join"), "warning");
      taskHints[taskId] = {
        type: "warning",
        message: task && task.url ? t("task_hint_not_joined_with_link") : t("task_hint_not_joined_no_link")
      };
    } else if (error.code === "VERIFY_CONFIG_ERROR") {
      // خطای واقعی تنظیمات (chatId اشتباه، ربات بدون دسترسی و ...) — پیام دقیق را نشان بده
      toast(error.message, "error");
      taskHints[taskId] = { type: "error", message: `${error.message} ${t("task_hint_config_error_suffix")}` };
    } else {
      const message = translateServerMessage(error.code, error.message);
      toast(message, "error");
      taskHints[taskId] = { type: "error", message };
    }
    if (button) { button.disabled = false; button.textContent = t("task_action_verify"); }
    renderTasks();
  }
}
window.verifyTelegramTask = verifyTelegramTask;

async function verifyLatestPostTask(taskId) {
  if (!readModelActionAllowed()) return;
  const button = findByData("[data-latest-post-check]", "latestPostCheck", taskId);
  if (button) {
    button.disabled = true;
    button.dataset.taskState = "VERIFYING";
    button.textContent = t("task_action_verifying");
  }
  try {
    const result = await api(`/api/tasks/${encodeURIComponent(taskId)}/engagement/check`, { method: "POST" });
    latestPostOpenedTaskIds.delete(String(taskId));
    latestPostOpenedAt.delete(String(taskId));
    delete taskHints[taskId];
    state.points = Number(result.points) || state.points;
    const serverNow = Number(result.serverNow);
    if (Number.isFinite(serverNow)) state.tasksServerOffsetMs = serverNow - Date.now();
    haptic("success");
    toast(t("task_latest_post_reward", { n: formatPoints(result.reward) }), "success");
    await loadTasks({ force: true });
    updateHeader();
    renderTasks();
  } catch (error) {
    haptic("error");
    const message = translateServerMessage(error.code, error.message);
    taskHints[taskId] = { type: "error", message };
    toast(message, error.code === "TASK_COOLDOWN_ACTIVE" ? "warning" : "error");
    await loadTasks({ force: true });
    renderTasks();
  }
}
window.verifyLatestPostTask = verifyLatestPostTask;

let latestPostCooldownTimer = null;
function formatCountdown(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(remainingSeconds)}`;
}

function startLatestPostCooldownCountdown() {
  clearInterval(latestPostCooldownTimer);
  const buttons = Array.from(document.querySelectorAll("[data-latest-post-cooldown], [data-latest-post-wait], [data-bio-link-cooldown]"));
  if (!buttons.length) return;

  const tick = () => {
    const now = Date.now() + state.tasksServerOffsetMs;
    let refreshAfterCooldown = false;
    let refreshAfterWait = false;
    buttons.forEach(button => {
      const remaining = button.dataset.latestPostWait === "true"
        ? Number(button.dataset.openedAt || 0) + 10000 - now
        : Date.parse(button.dataset.until || "") - now;
      if (remaining > 0) {
        button.textContent = button.dataset.bioLinkCooldown === "true"
          ? t("task_latest_post_available_in", { time: formatCountdown(remaining) })
          : button.dataset.latestPostWait === "true"
          ? t("task_latest_post_check_in", { time: formatCountdown(remaining) })
          : t("task_latest_post_available_in", { time: formatCountdown(remaining) });
        return;
      }
      const waitingForCheck = button.dataset.latestPostWait === "true";
      button.disabled = false;
      button.dataset.taskState = "AVAILABLE";
      button.textContent = button.dataset.bioLinkCooldown === "true" ? t("bio_link_task_verify") : waitingForCheck ? t("task_action_claim") : t("task_action_start");
      if (waitingForCheck) {
        // Re-render the same task immediately so the button gets the Claim
        // click handler and data attribute; no page/tab refresh is required.
        refreshAfterWait = true;
      } else if (button.dataset.refreshed !== "true") {
        button.dataset.refreshed = "true";
        refreshAfterCooldown = true;
      }
    });
    if (refreshAfterWait && state.activeTab === "tasks") {
      renderTasks();
      return;
    }
    if (refreshAfterCooldown) {
      loadTasks({ force: true }).then(() => {
        if (state.activeTab === "tasks") renderTasks();
      });
    }
    if (!document.querySelector("[data-latest-post-cooldown], [data-latest-post-wait], [data-bio-link-cooldown]")) {
      clearInterval(latestPostCooldownTimer);
      latestPostCooldownTimer = null;
    }
  };
  tick();
  latestPostCooldownTimer = setInterval(tick, 1000);
}

const DAILY_CHECKIN_REWARDS = Object.freeze([5, 7, 9, 11, 13, 14, 15]);
function dailyCycleDay() {
  const streak = Math.floor(Number(state.streak) || 0);
  return streak > 0 ? ((streak - 1) % DAILY_CHECKIN_REWARDS.length) + 1 : 0;
}
function stopDailyCheckinCountdown() {
  if (dailyCheckinTimer) clearInterval(dailyCheckinTimer);
  dailyCheckinTimer = null;
}
async function startDailyCheckinCountdown() {
  stopDailyCheckinCountdown();
  const countdown = document.querySelector("[data-daily-checkin-countdown]");
  if (!countdown || state.canCheckIn || !Number(state.nextResetAt)) return;
  const tick = async () => {
    const remaining = Number(state.nextResetAt) - Date.now();
    if (remaining > 0) {
      countdown.textContent = t("checkin_next_available_in", { time: formatCountdown(remaining) });
      return;
    }
    stopDailyCheckinCountdown();
    countdown.textContent = t("checkin_refreshing");
    try { await loadUserData({ force: true }); }
    finally { if (state.activeTab === "tasks") renderTasks(); }
  };
  await tick();
  if (document.querySelector("[data-daily-checkin-countdown]")) dailyCheckinTimer = setInterval(tick, 1000);
}
function renderDailyCheckinCard() {
  const completedDays = dailyCycleDay();
  const nextDay = state.canCheckIn ? (completedDays >= 7 ? 1 : completedDays + 1) : (completedDays || 1);
  const dayCells = DAILY_CHECKIN_REWARDS.map((reward, index) => {
    const day = index + 1;
    const completed = day <= completedDays;
    const current = state.canCheckIn && day === nextDay;
    const rewardLabel = `+${formatPoints(reward)} UP`;
    return `<div class="dailyCheckDay ${completed ? "is-complete" : ""} ${current ? "is-current" : ""}">
      ${completed
        ? `<span class="dailyCheckDayNumber isClaimed" aria-label="${t("checkin_done_button")}">✓</span>`
        : `<span class="dailyCheckDayNumber dailyCheckToken"><img src="/img/gramup-logo-new.png" alt="UP" width="25" height="25"></span>`}
      <strong>${t("day_label", { n: day })}</strong>
      <small class="dailyCheckReward" aria-label="${rewardLabel}"><span>${rewardLabel}</span><img src="/img/gramup-logo-new.png" alt="" aria-hidden="true" width="10" height="10"></small>
    </div>`;
  }).join("");
  return `<section class="card dailyCheckCard" aria-labelledby="dailyCheckTitle">
    <div class="dailyCheckHeader"><div><span class="tasksOverline">${t("daily_title")}</span><h2 id="dailyCheckTitle">${t("daily_check_title")}</h2></div><span class="tbPill tbPillOrange tbPillSm">${formatPoints(completedDays)} / 7</span></div>
    <p class="dailyCheckSubtitle">${state.canCheckIn ? t("daily_check_available") : t("daily_check_completed")}</p>
    <div class="dailyCheckGrid">${dayCells}</div>
    <div class="dailyCheckFooter"><span>${t("daily_check_today_reward", { n: formatPoints(DAILY_CHECKIN_REWARDS[nextDay - 1]) })}</span><button id="checkinBtn" class="primaryBtn" type="button" ${state.canCheckIn ? "" : "disabled"} onclick="doCheckIn()">${state.canCheckIn ? t("checkin_button") : t("checkin_done_button")}</button></div>
    <div class="dailyCheckCountdown" data-daily-checkin-countdown>${state.canCheckIn ? "" : t("checkin_next_available_in", { time: formatCountdown(Math.max(0, Number(state.nextResetAt) - Date.now())) })}</div>
  </section>`;
}
async function doCheckIn() {
  if (!readModelActionAllowed()) return;
  const button = document.querySelector("#checkinBtn");
  if (button) { button.disabled = true; button.textContent = t("checkin_processing"); }
  haptic("light");
  try {
    const result = await api("/api/points/checkin", { method: "POST" });
    state.points = Number(result.points) || state.points;
    state.streak = Number(result.streak) || state.streak;
    state.tickets = Number(result.tickets) || 0;
    state.canCheckIn = false;
    state.totalCheckins += 1;
    state.nextResetAt = Number(result.nextResetAt) || state.nextResetAt;
    updateHeader();
    haptic("success");
    toast(t("checkin_claim_success", { n: tokenAmount(result.earned) }), "success");
    rerenderActiveUserDataView();
    try {
      await loadUserData({ force: true });
    } catch (refreshError) {
      // The check-in was accepted; a read-model refresh failure must not undo it.
      console.warn("Check-in read-model refresh failed:", refreshError);
    }
    rerenderActiveUserDataView();
  } catch (error) {
    if (error?.code === "ALREADY_CHECKED_IN") {
      try {
        await loadUserData({ force: true });
        rerenderActiveUserDataView();
      } catch (refreshError) {
        // The server already owns the claim; retain the current view if refresh is unavailable.
        console.warn("Already-checked-in read-model refresh failed:", refreshError);
      }
      haptic("warning");
      toast(translateServerMessage(error.code, error.message), "warning");
      if (button) {
        button.disabled = true;
        button.textContent = t("checkin_done_button");
      }
      return;
    }
    haptic("error");
    toast(translateServerMessage(error.code, error.message), "error");
    if (button) { button.disabled = false; button.textContent = t("checkin_button"); }
  }
}
window.doCheckIn = doCheckIn;
function closeMissedStreakModal() {
  document.querySelector('#missedStreakOverlay')?.remove();
  if (state.streakMissed) state.missedStreakPrompted = false;
}
function openMissedStreakModal() {
  if (state.activeTab !== 'tasks' || !state.streakMissed || document.querySelector('#missedStreakOverlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'missedStreakOverlay';
  overlay.className = 'overlay missedStreakOverlay';
  overlay.innerHTML = `<div class="modalBox missedStreakModal" role="dialog" aria-modal="true" aria-labelledby="missedStreakTitle">
    <div class="missedStreakIcon">🔥</div><div class="modalEyebrow">${t('streak_missed_eyebrow', {}, 'Streak check')}</div>
    <h3 id="missedStreakTitle">${t('streak_missed_title', {}, 'You missed a day')}</h3>
    <p class="missedStreakLead">${t('streak_missed_desc', { n: formatPoints(state.streak) }, 'Your current streak is at risk. Choose how to continue.')}</p>
    <div class="missedStreakChoices"><button type="button" class="missedStreakKeep" onclick="freezeMissedStreak()"><strong>${t('streak_freeze_action', { n: formatPoints(state.streakFreezeCost) }, 'Pay 20 UP to Freeze Streak')}</strong><small>${t('streak_freeze_help', {}, 'Keep your streak and claim today’s reward')}</small></button><button type="button" class="missedStreakRestart" onclick="restartMissedStreak()"><strong>${t('streak_restart_action', {}, 'Restart Streak')}</strong><small>${t('streak_restart_help', {}, 'Reset to Day 1 without a charge')}</small></button></div>
    <button type="button" class="missedStreakLater" onclick="closeMissedStreakModal()">${t('streak_decide_later', {}, 'Decide later')}</button>
  </div>`;
  overlay.addEventListener('click', event => { if (event.target === overlay) closeMissedStreakModal(); });
  document.body.appendChild(overlay);
}
async function freezeMissedStreak() {
  if (!readModelActionAllowed()) return;
  const button = document.querySelector('.missedStreakKeep');
  if (button) button.disabled = true;
  try { const result = await api('/api/points/checkin/freeze', { method: 'POST', body: {} }); state.points = Number(result.points) || state.points; closeMissedStreakModal(); await loadUserData({ force: true }); renderTasks(); toast(t('streak_freeze_success', {}, 'Your streak was frozen. Claim today’s reward.'), 'success'); haptic('success'); }
  catch (error) { if (button) button.disabled = false; toast(translateServerMessage(error.code, error.message), 'error'); haptic('error'); }
}
async function restartMissedStreak() {
  if (!readModelActionAllowed()) return;
  const button = document.querySelector('.missedStreakRestart');
  if (button) button.disabled = true;
  try { const result = await api('/api/points/checkin/restart', { method: 'POST', body: {} }); state.points = Number(result.points) || state.points; closeMissedStreakModal(); await loadUserData({ force: true }); renderTasks(); toast(t('streak_restart_success', {}, 'Your streak was restarted at Day 1.'), 'success'); haptic('light'); }
  catch (error) { if (button) button.disabled = false; toast(translateServerMessage(error.code, error.message), 'error'); haptic('error'); }
}
window.closeMissedStreakModal = closeMissedStreakModal; window.openMissedStreakModal = openMissedStreakModal; window.freezeMissedStreak = freezeMissedStreak; window.restartMissedStreak = restartMissedStreak;
function renderTasks() {
  stopDailyCheckinCountdown();
  if (state.streakMissed && !state.missedStreakPrompted) {
    state.missedStreakPrompted = true;
    setTimeout(openMissedStreakModal, 0);
  }
  const content = $("#content");
  const taskSection = ["daily", "vip", "invite"].includes(state.taskSection) ? state.taskSection : "daily";
  const isInviteSection = taskSection === "invite";
  const visibleTasks = isInviteSection
    ? []
    : state.tasks.filter(task => taskSection === "vip" ? task.taskKind === "vip_activation" : task.taskKind !== "vip_activation");
  const referralHtml = isInviteSection ? renderReferralRewardTasks() : "";
  const referralTierHtml = isInviteSection ? renderReferralTierSummary() : "";
  const dailyCheckinHtml = taskSection === "daily" ? renderDailyCheckinCard() : "";
  const taskErrorHtml = tasksLoadError ? `<div class="card" role="status"><div class="emptyDesc">${t("tasks_load_error")}</div><button class="secondaryBtn" type="button" onclick="retryTasks()">${t("retry_button")}</button></div>` : "";
  const sectionTabs = `
    <div class="taskCategoryTabs taskSectionTabs" role="tablist" aria-label="${escapeHTML(t("tasks_title"))}">
      <button type="button" role="tab" aria-selected="${taskSection === "daily"}" class="taskCategoryTab ${taskSection === "daily" ? "active" : ""}" onclick="setTaskSection('daily')">☀️ ${t("daily_title")}</button>
      <button type="button" role="tab" aria-selected="${taskSection === "vip"}" class="taskCategoryTab ${taskSection === "vip" ? "active" : ""}" onclick="setTaskSection('vip')">💎 ${t("vip_title")}</button>
      <button type="button" role="tab" aria-selected="${taskSection === "invite"}" class="taskCategoryTab ${taskSection === "invite" ? "active" : ""}" onclick="setTaskSection('invite')">👥 ${t("menu_referral")}</button>
    </div>`;

  if (!state.readModelTasksConfirmed && !tasksLoadError && !isInviteSection) {
    content.innerHTML = `<div class="sectionHeader"><h2 class="sectionTitle">${t("tasks_title")}</h2></div>${sectionTabs}<div class="taskSkeletonGrid"><div class="loading" style="height:118px"></div><div class="loading" style="height:118px"></div><div class="loading" style="height:118px"></div></div>`;
    return;
  }

  if (!state.tasks.length && tasksLoadError && !isInviteSection) {
    content.innerHTML = `<div class="sectionHeader"><h2 class="sectionTitle">${t("tasks_title")}</h2></div>${sectionTabs}${taskErrorHtml}`;
    return;
  }
  if (!isInviteSection && visibleTasks.length === 0) {
    clearInterval(latestPostCooldownTimer);
    latestPostCooldownTimer = null;
    content.innerHTML = `
      <div class="sectionHeader"><h2 class="sectionTitle">${t("tasks_title")}</h2></div>
      ${sectionTabs}
      ${dailyCheckinHtml}
      ${taskErrorHtml}
      ${referralHtml}
      ${referralTierHtml}
      <div class="card emptyState">
        <div class="emptyIcon">🗂️</div>
        <div class="emptyTitle">${t("tasks_empty_title")}</div>
        <div class="emptyDesc">${t("tasks_empty_desc")}</div>
      </div>
    `;
    return;
  }

  if (isInviteSection) {
    clearInterval(latestPostCooldownTimer);
    latestPostCooldownTimer = null;
    content.innerHTML = `
      <div class="sectionHeader"><h2 class="sectionTitle">${t("tasks_title")}</h2></div>
      ${sectionTabs}
      ${referralHtml}
      ${referralTierHtml}
    `;
    return;
  }

  const doneCount = visibleTasks.filter(task => completionStatus(task._id) === "approved").length;
  const taskProgress = visibleTasks.length ? Math.round((doneCount / visibleTasks.length) * 100) : 0;

  content.innerHTML = `
    <section class="tasksOverview">
      <div class="tasksOverviewTop"><div><h1>${t("tasks_title")}</h1></div><strong>${taskProgress}%</strong></div>
      <div class="tasksProgressTrack"><i style="width:${taskProgress}%"></i></div>
      <div class="tasksOverviewMeta"><span>${formatPoints(doneCount)} / ${formatPoints(visibleTasks.length)} ${t("task_btn_done")}</span><span>${t("tb_UP_chip", { n: formatPoints(state.points) })}</span></div>
    </section>
    ${sectionTabs}
    ${dailyCheckinHtml}
    ${taskErrorHtml}
    ${referralHtml}
    <div class="taskList">
      ${visibleTasks.map(task => {
        const status = completionStatus(task._id);
        const icon = taskIconMarkup(task);
        const taskTitle = task.taskKind === "bio_link" ? t("bio_link_task_title") : task.title;
        const taskDescription = task.taskKind === "bio_link" ? t("bio_link_task_desc") : task.description;
        const safeUrl = safeTaskHttpUrl(task.url).replaceAll("'", "\\'");
        let actionHtml;

        if (task.taskKind === "vip_activation") {
          actionHtml = status === "approved"
            ? `<button class="taskAction done" disabled>${t("task_btn_done")}</button>`
            : `<button class="taskAction pending" disabled>🔒 Miner ${formatPoints(task.vipPlanNumber)}</button>`;
        } else if (task.taskKind === "bio_link") {
          const completion = completionRecord(task._id);
          const nextAvailableAt = completion?.nextAvailableAt ? new Date(completion.nextAvailableAt) : null;
          const remaining = nextAvailableAt && Number.isFinite(nextAvailableAt.getTime())
            ? nextAvailableAt.getTime() - (Date.now() + state.tasksServerOffsetMs)
            : 0;
          actionHtml = remaining > 0
            ? `<button class="taskAction pending" data-task-state="COOLDOWN" data-bio-link-cooldown="true" data-until="${escapeHTML(nextAvailableAt.toISOString())}" disabled>${t("task_latest_post_available_in", { time: formatCountdown(remaining) })}</button>`
            : `<button type="button" class="taskAction" data-verify="${escapeHTML(task._id)}">${t("bio_link_task_verify")}</button>`;
        } else if (task.verifyType === "latest_post") {
          const completion = completionRecord(task._id);
          const nextAvailableAt = completion?.nextAvailableAt ? new Date(completion.nextAvailableAt) : null;
          const remaining = nextAvailableAt && Number.isFinite(nextAvailableAt.getTime())
            ? nextAvailableAt.getTime() - (Date.now() + state.tasksServerOffsetMs)
            : 0;
          const openedAtMs = latestPostOpenedAt.get(String(task._id));
          const openWaitRemaining = openedAtMs ? openedAtMs + 10000 - (Date.now() + state.tasksServerOffsetMs) : 0;
          const waitingForCheck = latestPostOpenedTaskIds.has(String(task._id)) && openWaitRemaining <= 0;
          const openButton = !waitingForCheck && remaining <= 0 && safeUrl
            ? `<button class="taskAction" data-latest-post-open="${escapeHTML(task._id)}" data-task-open-url="${escapeHTML(safeUrl)}" style="background:var(--surface-3);color:var(--text)">${t("task_action_start")}</button>`
            : "";
          let actionButton = "";
          if (remaining > 0) {
            actionButton = `<button class="taskAction pending" data-task-state="COOLDOWN" data-latest-post-cooldown data-task-id="${escapeHTML(task._id)}" data-until="${escapeHTML(nextAvailableAt.toISOString())}" disabled>${t("task_latest_post_available_in", { time: formatCountdown(remaining) })}</button>`;
          } else if (waitingForCheck) {
            actionButton = `<button type="button" class="taskAction" data-task-state="WAITING_FOR_CHECK" data-latest-post-check="${escapeHTML(task._id)}">${t("task_action_claim")}</button>`;
          } else if (latestPostOpenedTaskIds.has(String(task._id)) && openWaitRemaining > 0) {
            actionButton = `<button class="taskAction pending" data-latest-post-wait="true" data-opened-at="${escapeHTML(String(openedAtMs))}" disabled>${t("task_latest_post_check_in", { time: formatCountdown(openWaitRemaining) })}</button>`;
          } else {
            actionButton = openButton;
          }
          // One compact control: Start becomes the 10-second wait,
          // then Check, and later the recurring cooldown countdown.
          actionHtml = `<div class="taskActionSlot">${actionButton}</div>`;
        } else if (status === "approved") {
          actionHtml = `<button class="taskAction done" disabled>${t("task_btn_done")}</button>`;
        } else if (status === "pending") {
          actionHtml = `<button class="taskAction pending" disabled>${t("task_btn_pending")}</button>`;
        } else if (task.verifyType === "manual") {
          const rejectedRecord = status === "rejected" ? completionRecord(task._id) : null;
          const rejectedNote = rejectedRecord?.adminNote
            ? `<div class="taskHint error" style="flex-basis:100%">${escapeHTML(rejectedRecord.adminNote)}</div>`
            : status === "rejected" ? `<div class="taskHint error" style="flex-basis:100%">${t("task_submission_rejected")}</div>` : "";
          actionHtml = `
            <div style="display:flex;flex-direction:column;gap:6px;align-items:stretch">
              ${safeUrl ? `<button class="taskAction" data-task-open-url="${escapeHTML(safeUrl)}" style="background:var(--surface-3);color:var(--text)">${t("task_action_open")}</button>` : ""}
              <input class="hidden" data-screenshot-task="${escapeHTML(task._id)}" type="file" accept="image/jpeg,image/png,image/webp">
              <button type="button" class="taskAction" data-upload-screenshot="${escapeHTML(task._id)}">📸 ${t("task_action_upload")}</button>
            </div>${rejectedNote}`;
        } else {
          actionHtml = `
            <div style="display:flex;flex-direction:column;gap:6px;align-items:stretch">
              ${safeUrl ? `<button class="taskAction" data-task-open-url="${escapeHTML(safeUrl)}" style="background:var(--surface-3);color:var(--text)">${t("task_action_open")}</button>` : ""}
              <button type="button" class="taskAction" data-verify="${escapeHTML(task._id)}">${t("task_action_verify")}</button>
            </div>`;
        }

        const hint = status === "todo" || task.verifyType === "latest_post" ? taskHints[task._id] : null;

        return `
        <div class="taskItem" style="flex-wrap:wrap">
          <div class="taskIcon">${icon}</div>
          <div class="taskBody">
            <div class="taskTitle">${task.isSpecialOfDay ? `<span class="sponsoredTag">⭐ ${t("special_task_badge")}</span> ` : ""}${task.isSponsored ? `<span class="sponsoredTag">${t("task_sponsored_tag")}</span> ` : ""}${escapeHTML(taskTitle)}</div>
            ${taskDescription ? `<div class="taskDesc">${escapeHTML(taskDescription)}</div>` : ""}
            ${task.verifyType === "latest_post" ? `<div class="taskDesc">${t("task_latest_post_open_hint")}</div>` : ""}
            ${task.isSpecialOfDay && task.expiresAt ? `<div class="taskDesc" style="color:var(--warning)">⏳ ${t("special_task_deadline", { date: new Date(task.expiresAt).toLocaleString(state.language === "en" ? "en-US" : "fa-IR") })}</div>` : ""}
            <div class="taskReward">+${tokenAmount(task.reward)}</div>
          </div>
          ${actionHtml}
          ${hint ? `<div class="taskHint ${hint.type}" style="flex-basis:100%">${escapeHTML(hint.message)}</div>` : ""}
        </div>`;
      }).join("")}
    </div>
  `;
  startLatestPostCooldownCountdown();
  if (taskSection === "daily") void startDailyCheckinCountdown();
}

async function retryTasks() { await loadTasks({ force: true }); if (state.activeTab === "tasks") renderTasks(); else if (state.activeTab === "home") renderHome(); }
window.retryTasks = retryTasks;

/* ================= WALLET ================= */
function showWithdraw() {
  if (!readModelActionAllowed()) return;
  if (state.gramBalance < state.minWithdrawGram) {
    toast(t("wallet_min_withdraw_note", { n: formatNumber(state.minWithdrawGram, 6) }), "warning");
    return;
  }
  if (!window.gramupWallet?.isConnected()) {
    toast(t("wallet_connect_required"), "warning");
    void window.gramupWallet?.connect();
    return;
  }
  const overlay = $("#withdrawOverlay");
  haptic("light");
  const pointsInput = $("#withdrawPoints");
  const addressInput = $("#withdrawAddress");
  const error = $("#withdrawError");
  if (pointsInput) pointsInput.value = "";
  if (addressInput) addressInput.value = window.gramupWallet.getAddress();
  if (error) error.textContent = "";
  if (overlay) overlay.style.display = "flex";
}
window.showWithdraw = showWithdraw;

function hideWithdraw() {
  const overlay = $("#withdrawOverlay");
  if (overlay) overlay.style.display = "none";
}
window.hideWithdraw = hideWithdraw;

async function submitWithdraw() {
  if (!readModelActionAllowed()) return;
  const gramInput = $("#withdrawPoints");
  const addressInput = $("#withdrawAddress");
  const error = $("#withdrawError");
  const button = $("#submitWithdraw");

  const gram = Number(gramInput?.value);
  const address = String(window.gramupWallet?.getAddress?.() || addressInput?.value || "").trim();

  if (!gram || gram <= 0) {
    if (error) error.textContent = t("error_generic");
    return;
  }
  if (!window.gramupWallet?.isConnected() || !window.gramupWallet?.isProofVerified?.() || address.length < 6) {
    if (error) error.textContent = t("error_generic");
    return;
  }

  if (button) button.disabled = true;
  try {
    const result = await window.gramupWallet.requestWithdrawal(gram, getPendingIdempotencyKey("withdraw"));
    clearPendingIdempotencyKey("withdraw");
    state.gramBalance = Number(result.gramBalance) ?? state.gramBalance;
    haptic("success");
    toast(result.message, "success");
    hideWithdraw();
    updateHeader();
    renderWallet();
  } catch (err) {
    clearDefinitiveIdempotencyFailure("withdraw", err);
    if (error) error.textContent = translateServerMessage(err.code, err.message);
    haptic("error");
  } finally {
    if (button) button.disabled = false;
  }
}
window.submitWithdraw = submitWithdraw;

/* ---- Exchange: Points <-> GRAM (bidirectional) ---- */
let exchangeDirection = "points_to_gram"; // "points_to_gram" | "gram_to_points"

function showExchange() {
  if (!readModelActionAllowed()) return;
  const verifiedWalletAvailable = Boolean(window.gramupWallet?.isConnected?.() && window.gramupWallet?.isProofVerified?.());
  if (getExchangeAvailableBalance("points_to_gram") <= 0 && getExchangeAvailableBalance("gram_to_points") <= 0 && !verifiedWalletAvailable) {
    toast(t("error_generic"), "warning");
    return;
  }
  const overlay = $("#exchangeOverlay");
  haptic("light");
  const input = $("#exchangePoints");
  const error = $("#exchangeError");
  if (input) input.value = "";
  if (error) error.textContent = "";
  setExchangeDirection("points_to_gram");
  if (overlay) overlay.style.display = "flex";
  if (state.activeTab === "wallet" && state.chainGramBalance == null) void loadWalletChainBalance(walletRenderSequence);
}
window.showExchange = showExchange;

function hideExchange() {
  const overlay = $("#exchangeOverlay");
  if (overlay) overlay.style.display = "none";
}
window.hideExchange = hideExchange;

function setExchangeDirection(direction) {
  exchangeDirection = direction === "gram_to_points" ? "gram_to_points" : "points_to_gram";

  const btnPTG = $("#exchangeDirPTG");
  const btnGTP = $("#exchangeDirGTP");
  if (btnPTG) btnPTG.classList.toggle("active", exchangeDirection === "points_to_gram");
  if (btnGTP) btnGTP.classList.toggle("active", exchangeDirection === "gram_to_points");

  const label = $("#exchangeAmountLabel");
  const input = $("#exchangePoints");
  const title = $("#exchangeTitle");
  if (exchangeDirection === "points_to_gram") {
    if (label) { label.dataset.i18n = "exchange_UP_label"; label.textContent = t("exchange_UP_label"); }
    if (input) { input.dataset.i18nPh = "exchange_UP_ph"; input.setAttribute("placeholder", t("exchange_UP_ph")); }
    if (title) { title.dataset.i18n = "exchange_modal_title"; title.textContent = t("exchange_modal_title"); }
  } else {
    if (label) { label.dataset.i18n = "exchange_gram_label"; label.textContent = t("exchange_gram_label"); }
    if (input) { input.dataset.i18nPh = "withdraw_amount_ph"; input.setAttribute("placeholder", t("withdraw_amount_ph")); }
    if (title) { title.dataset.i18n = "exchange_modal_title_reverse"; title.textContent = t("exchange_modal_title_reverse"); }
  }

  if (input) input.value = "";
  const error = $("#exchangeError");
  if (error) error.textContent = "";
  updateExchangePreview();
  updateExchangeQuickSelectState();
}
window.setExchangeDirection = setExchangeDirection;

function getExchangeAvailableBalance(direction = exchangeDirection) {
  if (direction === "points_to_gram") {
    const points = Number(state.points);
    return Number.isFinite(points) ? Math.max(0, points) : 0;
  }

  const internalGram = Number(state.gramBalance);
  const internalAvailable = Number.isFinite(internalGram) ? Math.max(0, internalGram) : 0;
  const walletVerified = Boolean(window.gramupWallet?.isConnected?.() && window.gramupWallet?.isProofVerified?.());
  const chainGram = Number(state.chainGramBalance);
  const chainAvailable = walletVerified && Number.isFinite(chainGram) ? Math.max(0, chainGram) : 0;
  // The current submit path uses either the internal balance or the connected wallet balance,
  // rather than combining them into one transaction.
  return Math.max(internalAvailable, chainAvailable);
}

function isExchangeAmountValid(amount) {
  const value = Number(amount);
  return Number.isFinite(value) && value > 0 && value <= getExchangeAvailableBalance();
}

function updateExchangeQuickSelectState() {
  const availableBalance = getExchangeAvailableBalance();
  document.querySelectorAll("#exchangeQuickAmounts .exchangeQuickBtn").forEach(button => {
    button.disabled = !(Number.isFinite(availableBalance) && availableBalance > 0);
  });
}

function setExchangeAmountPercent(percent) {
  const input = $("#exchangePoints");
  const percentage = Number(percent);
  if (!input || ![25, 50, 75, 100].includes(percentage)) return;

  const availableBalance = getExchangeAvailableBalance();
  if (!Number.isFinite(availableBalance) || availableBalance <= 0) {
    input.value = "";
    updateExchangePreview();
    return;
  }

  const precision = exchangeDirection === "points_to_gram" ? 3 : 9;
  const scale = 10 ** precision;
  const maxUnits = Math.floor(availableBalance * scale);
  const selectedUnits = Math.floor(maxUnits * percentage / 100);
  let amount = (selectedUnits / scale).toFixed(precision);
  if (amount.includes(".")) amount = amount.replace(/0+$/, "").replace(/\.$/, "");
  input.value = amount;
  updateExchangePreview();
}
window.setExchangeAmountPercent = setExchangeAmountPercent;

function updateExchangePreview() {
  const input = $("#exchangePoints");
  const preview = $("#exchangePreview");
  if (!input || !preview) return;
  const rawValue = String(input.value || "").trim();
  const parsedAmount = Number(rawValue);
  const amount = Number.isFinite(parsedAmount) && parsedAmount >= 0 ? parsedAmount : 0;
  const error = $("#exchangeError");
  if (error) error.textContent = rawValue && !isExchangeAmountValid(parsedAmount) ? t("error_generic") : "";

  if (exchangeDirection === "points_to_gram") {
    const gram = amount * state.rate;
    preview.textContent = `${t("exchange_result_label")}: ${formatNumber(gram, 6)} GRAM`;
  } else {
    const points = state.rate > 0 ? Math.floor(amount / state.rate) : 0;
    preview.textContent = `${t("exchange_result_label_points")}: ${formatPoints(points)}`;
  }
}
window.updateExchangePreview = updateExchangePreview;

async function submitExchange() {
  if (!readModelActionAllowed()) return;
  const input = $("#exchangePoints");
  const error = $("#exchangeError");
  const button = $("#submitExchange");

  const amount = Number(input?.value);
  if (!isExchangeAmountValid(amount)) {
    haptic("error");
    if (error) error.textContent = t("error_generic");
    return;
  }
  if (button) button.disabled = true;
  const useInternalGramBalance = exchangeDirection === "gram_to_points" && amount <= state.gramBalance;
  const idempotencyScope = "exchange_points_to_gram";
  try {
    const result = exchangeDirection === "gram_to_points" && !useInternalGramBalance
      ? (typeof window.gramupWallet?.swapGramToPoints === "function"
        ? await window.gramupWallet.swapGramToPoints(amount)
        : Promise.reject(Object.assign(new Error(t("wallet_connection_unavailable")), { code: "WALLET_PROOF_REQUIRED" })))
      : await api("/api/points/exchange", {
        method: "POST",
        headers: { "Idempotency-Key": getPendingIdempotencyKey(idempotencyScope) },
        body: { direction: exchangeDirection, amount }
      });
    if (exchangeDirection === "points_to_gram" || useInternalGramBalance) clearPendingIdempotencyKey(idempotencyScope);
    state.points = Number(result.points) ?? state.points;
    if (result.gramBalance != null) state.gramBalance = Number(result.gramBalance) ?? state.gramBalance;
    if (exchangeDirection === "gram_to_points" && !useInternalGramBalance) state.chainGramBalance = null;
    haptic("success");
    toast(result.message || t("wallet_exchange_success", { n: formatPoints(result.pointsGained || 0) }), "success");
    hideExchange();
    updateHeader();
    renderWallet();
  } catch (err) {
    if (exchangeDirection === "points_to_gram" || useInternalGramBalance) clearDefinitiveIdempotencyFailure(idempotencyScope, err);
    if (error) error.textContent = translateServerMessage(err.code, err.message);
    haptic("error");
  } finally {
    if (button) button.disabled = false;
  }
}
window.submitExchange = submitExchange;

/* ---- TON Mainnet Native GRAM deposit ---- */
let currentDeposit = null;
let depositPanelLoading = false;
let depositSubmissionBusy = false;

async function copyDepositValue(targetId) {
  const target = document.getElementById(targetId);
  const value = target && "value" in target ? String(target.value) : String(target?.textContent || "");
  if (!value.trim()) {
    toast(t("deposit_copy_empty"), "error");
    return;
  }

  let copied = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      copied = true;
    }
  } catch {
    // Telegram WebView and some mobile browsers may reject Clipboard API access.
  }
  if (!copied) copied = fallbackCopyDepositValue(value);

  if (copied) {
    haptic("success");
    toast(t("deposit_copy_success"), "success");
  } else {
    haptic("error");
    toast(t("deposit_copy_failed"), "error");
  }
}

function fallbackCopyDepositValue(value) {
  const temporary = document.createElement("textarea");
  temporary.value = value;
  temporary.readOnly = true;
  temporary.setAttribute("aria-hidden", "true");
  temporary.style.position = "fixed";
  temporary.style.top = "0";
  temporary.style.left = "0";
  temporary.style.opacity = "0";
  temporary.style.fontSize = "16px";
  document.body.appendChild(temporary);
  let copied = false;
  try {
    temporary.focus({ preventScroll: true });
    temporary.select();
    temporary.setSelectionRange(0, temporary.value.length);
    copied = document.execCommand("copy") === true;
  } catch {
    copied = false;
  } finally {
    temporary.remove();
  }
  return copied;
}

function handleDepositCopyClick(event) {
  const button = event.target?.closest?.("[data-copy-target]");
  if (!button || !document.getElementById("depositOverlay")?.contains(button)) return;
  event.preventDefault();
  void copyDepositValue(button.dataset.copyTarget);
}

document.addEventListener("click", handleDepositCopyClick);

function setDepositActionMessage(message, type = "normal") {
  const box = $("#depositActionMessage");
  if (!box) return;
  box.textContent = message || "";
  box.style.color = type === "success" ? "var(--success)" : type === "error" ? "var(--danger)" : "var(--text-soft)";
}

function renderDepositHistory(deposits) {
  const container = $("#depositHistoryList");
  if (!container) return;
  if (depositHistoryError) {
    container.innerHTML = `<div class="small" role="status" style="opacity:.9">${escapeHTML(t("history_load_error"))} <button type="button" class="secondaryBtn" onclick="retryDepositHistory()">${t("retry_button")}</button></div>`;
    return;
  }
  const list = Array.isArray(deposits) ? deposits.slice(0, 5) : [];
  if (!list.length) {
    container.innerHTML = `<div class="small" style="opacity:.75">${escapeHTML(t("history_empty"))}</div>`;
    return;
  }
  container.innerHTML = `
    <div class="small" style="font-weight:700;margin-bottom:6px">${escapeHTML(t("deposit_history_title"))}</div>
    ${list.map(item => {
      const statusKey = item.status === "confirmed" ? "deposit_status_confirmed" : item.status === "rejected" ? "deposit_status_rejected" : "deposit_status_pending";
      const amount = item.amount == null ? t("deposit_pending_amount") : `${formatNumber(item.amount, 9)} GRAM`;
      return `<div style="padding:8px 0;border-top:1px solid var(--line);font-size:12px">
        <div style="display:flex;justify-content:space-between;gap:8px"><b>${escapeHTML(amount)}</b><span>${escapeHTML(t(statusKey))}</span></div>
        ${item.txHash ? `<div dir="ltr" style="text-align:start;opacity:.75;margin-top:3px">${escapeHTML(truncateMiddle(item.txHash, 8, 8))}</div>` : ""}
        <div style="opacity:.65;margin-top:3px">${escapeHTML(timeAgo(item.verifiedAt || item.createdAt))}</div>
      </div>`;
    }).join("")}`;
}

let depositHistoryError = null;
async function refreshDepositHistory() {
  try {
    const data = await api("/api/points/deposits");
    if (!Array.isArray(data?.deposits)) throw new Error('Invalid deposit history response');
    depositHistoryError = null;
    renderDepositHistory(data.deposits);
    return data.deposits;
  } catch (error) {
    depositHistoryError = error;
    renderDepositHistory([]);
    throw error;
  }
}
async function retryDepositHistory() { try { await refreshDepositHistory(); } catch {} }
window.retryDepositHistory = retryDepositHistory;

function showDeposit() {
  if (!readModelActionAllowed()) return;
  const overlay = $("#depositOverlay");
  haptic("light");
  const panel = $("#depositPanel");
  const disabled = $("#depositDisabledMessage");
  const message = $("#depositMessage");
  if (overlay) { overlay.style.display = "flex"; overlay.setAttribute("aria-busy", "true"); }
  if (panel) panel.style.display = "none";
  if (disabled) disabled.style.display = "block";
  if (message) message.textContent = t("history_loading");
  const submitButton = $("#depositVerifyButton");
  if (submitButton) submitButton.disabled = true;
  setDepositActionMessage("");
  void loadDepositPanel();
}
window.showDeposit = showDeposit;

async function loadDepositPanel() {
  if (depositPanelLoading) return;
  depositPanelLoading = true;
  const overlay = $("#depositOverlay");
  const panel = $("#depositPanel");
  const disabled = $("#depositDisabledMessage");
  const message = $("#depositMessage");
  const button = $("#depositVerifyButton");
  try {
    // Fetch both resources together. History is useful but should not delay the
    // form once the deposit configuration is available.
    const historyPromise = refreshDepositHistory().catch(() => null);
    const configData = await api("/api/points/deposit/config");

    if (!configData?.enabled) {
      if (panel) panel.style.display = "none";
      if (disabled) disabled.style.display = "block";
      if (message) message.textContent = t("deposit_coming_soon");
      return;
    }

    if (panel) panel.style.display = "block";
    if (disabled) disabled.style.display = "none";
    const address = $("#depositWalletAddress");
    const reference = $("#depositReference");
    const amount = $("#depositAmount");
    const minimum = $("#depositMinimumText");
    if (address) address.value = configData?.depositWalletAddress || "";
    if (reference) reference.textContent = t("deposit_reference_auto");
    if (minimum) minimum.textContent = t("deposit_minimum", { amount: formatNumber(configData?.minimumDepositGram ?? 0, 9) });
    if (button) button.disabled = true;

    // The form is visible now; finish optional history lookup and restore an
    // existing invoice before enabling submission.
    const deposits = await historyPromise;
    const pending = deposits?.find(item => item.status === "pending");
    currentDeposit = pending || null;
    if (address) address.value = currentDeposit?.depositWalletAddress || configData?.depositWalletAddress || "";
    if (reference) reference.textContent = currentDeposit?.reference || t("deposit_reference_auto");
    if (amount && currentDeposit?.requestedAmount != null) amount.value = currentDeposit.requestedAmount;
    if (minimum) minimum.textContent = t("deposit_minimum", { amount: formatNumber(currentDeposit?.minimumDepositGram ?? configData?.minimumDepositGram ?? 0, 9) });
    if (button) button.disabled = currentDeposit?.status === "confirmed";
  } catch (error) {
    if (panel) panel.style.display = "none";
    if (disabled) disabled.style.display = "block";
    if (message) message.textContent = translateServerMessage(error.code, error.message);
  } finally {
    depositPanelLoading = false;
    if (overlay) overlay.setAttribute("aria-busy", "false");
  }
}

async function submitGramDeposit() {
  if (!readModelActionAllowed()) return;
  const button = $("#depositVerifyButton");
  const input = $("#depositAmount");
  const amount = Number(input?.value || 0);
  if (depositSubmissionBusy) return;
  if (!Number.isFinite(amount) || amount <= 0) {
    setDepositActionMessage(t("deposit_invalid_amount_message"), "error");
    return;
  }
  depositSubmissionBusy = true;
  if (button) button.disabled = true;
  setDepositActionMessage(t("history_loading"));
  try {
    if (!window.gramupWallet?.isProofVerified?.()) {
      throw Object.assign(new Error(t("wallet_proof_required_for_deposit")), { code: "WALLET_PROOF_REQUIRED" });
    }
    const created = await window.gramupWallet.requestDeposit(amount);
    currentDeposit = created?.deposit;
    if (!currentDeposit?._id || !created?.transaction) throw new Error(t("deposit_transaction_unavailable"));
    setDepositActionMessage(t("deposit_sent_waiting"), "normal");
    let result = null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, attempt === 0 ? 3000 : 5000));
      try {
        result = await window.gramupWallet.verifyDeposit(currentDeposit._id);
        if (result?.status === "confirmed") break;
      } catch (error) {
        if (error.code !== "TON_TRANSACTION_NOT_INDEXED" && error.status !== 202) throw error;
      }
    }
    if (result?.status === "confirmed") {
      window.gramupWallet?.setOperation?.("deposit", "confirmed");
      const balance = Number(result.gramBalance);
      if (Number.isFinite(balance)) state.gramBalance = balance;
      setDepositActionMessage(t("deposit_confirmed_message", { amount: formatNumber(result.amount, 9) }), "success");
      toast(t("deposit_confirmed_message", { amount: formatNumber(result.amount, 9) }), "success");
      haptic("success");
      updateHeader();
      if (state.activeTab === "wallet") renderWallet();
      await refreshDepositHistory();
    } else {
      setDepositActionMessage(t("deposit_pending_message"), "normal");
      haptic("warning");
      if (button) button.disabled = false;
      await refreshDepositHistory();
    }
  } catch (error) {
    if (!currentDeposit && error?.deposit) currentDeposit = error.deposit;
    window.gramupWallet?.setOperation?.("deposit", "error", error);
    setDepositActionMessage(translateServerMessage(error.code, error.message), "error");
    haptic("error");
    let deposits = [];
    try { deposits = await refreshDepositHistory(); } catch { deposits = []; }
    const refreshed = deposits.find(item => item._id === currentDeposit?._id);
    if (refreshed) currentDeposit = refreshed;
    if (button) button.disabled = currentDeposit?.status !== "pending";
  } finally {
    depositSubmissionBusy = false;
  }
}
window.submitGramDeposit = submitGramDeposit;

function hideDeposit() {
  const overlay = $("#depositOverlay");
  if (overlay) overlay.style.display = "none";
}
window.hideDeposit = hideDeposit;

let walletHistory = [];
let walletHistoryError = null;
let walletHistorySequence = 0;
async function loadWalletHistory() {
  const requestId = ++walletHistorySequence;
  try {
    const data = await api("/api/points/withdrawals");
    if (requestId !== walletHistorySequence) return;
    if (!Array.isArray(data?.withdrawals)) throw new Error("Invalid withdrawals response");
    walletHistory = data.withdrawals;
    walletHistoryError = null;
  } catch (error) {
    console.warn("Withdrawals failed:", error);
    if (requestId === walletHistorySequence) walletHistoryError = error;
  }
}

const WITHDRAW_STATUS_UI = {
  pending: { cls: "warning" }, approved: { cls: "info" }, processing: { cls: "info" },
  paid: { cls: "success" }, rejected: { cls: "danger" }, cancelled: { cls: "danger" }
};

let publicHistory = [];
let publicHistoryError = null;
let publicHistorySequence = 0;
async function loadPublicHistory() {
  const requestId = ++publicHistorySequence;
  try {
    const data = await api("/api/points/public-history");
    if (requestId !== publicHistorySequence) return;
    if (!Array.isArray(data?.history)) throw new Error("Invalid public history response");
    publicHistory = data.history;
    publicHistoryError = null;
  } catch (error) {
    console.warn("Public history failed:", error);
    if (requestId === publicHistorySequence) publicHistoryError = error;
  }
}

const TB_ICONS = {
  coin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M14.5 9.3c-.4-.9-1.4-1.4-2.5-1.4-1.4 0-2.5.8-2.5 1.9 0 2.6 5 1.4 5 4.2 0 1.1-1.1 1.9-2.5 1.9-1.1 0-2.1-.5-2.5-1.4M12 6.5v1.4M12 16.1v1.4"/></svg>',
  gem: '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="30" fill="#2f9bf0"/><path d="M20 24h24l6 8-18 20L14 32z" fill="#fff"/><path d="M32 30v10M27 35h10" stroke="#2f9bf0" stroke-width="3" stroke-linecap="round"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  exchange: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4 3 8l4 4M3 8h15M17 20l4-4-4-4M21 16H6"/></svg>',
  out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg>'
};

let walletRenderSequence = 0;
async function loadWalletChainBalance(renderRequestId = walletRenderSequence) {
  const value = document.getElementById('walletChainBalanceValue');
  const meta = document.getElementById('walletChainBalanceMeta');
  if (!value || !meta) return;
  state.chainGramBalance = null;
  updateExchangeQuickSelectState();
  value.textContent = t('wallet_chain_balance_loading');
  meta.textContent = t('deposit_network_ton_mainnet');
  try {
    const result = await api('/api/points/wallet/chain-balance');
    if (renderRequestId !== walletRenderSequence || state.activeTab !== 'wallet') return;
    const balance = Number(result?.balance);
    if (!Number.isFinite(balance) || balance < 0) throw new Error('Invalid wallet chain balance');
    state.chainGramBalance = balance;
    updateExchangeQuickSelectState();
    value.textContent = `${formatNumber(result.balance, 6)} GRAM`;
    meta.textContent = t('wallet_chain_balance_title');
  } catch (error) {
    if (renderRequestId !== walletRenderSequence || state.activeTab !== 'wallet') return;
    state.chainGramBalance = null;
    updateExchangeQuickSelectState();
    value.textContent = t('wallet_chain_balance_unavailable');
    meta.textContent = error?.code === 'WALLET_NOT_CONNECTED' ? t('wallet_connected_withdraw_hint') : t('deposit_network_ton_mainnet');
  }
}
window.refreshWalletChainBalance = () => loadWalletChainBalance(walletRenderSequence);
window.onGramupWalletChange = () => {
  if (state.activeTab === 'wallet') void loadWalletChainBalance(walletRenderSequence);
};
function renderWallet() {
  const renderRequestId = ++walletRenderSequence;
  const content = $("#content");

  content.innerHTML = `
    <section class="walletOverview">
      <div class="walletOverviewTop"><div><span class="walletOverline">${t("wallet_title")}</span><h1>${t("wallet_balance_title")}</h1></div><span class="walletLivePill">● ${t("wallet_rate_label", { rate: formatNumber(state.rate, 6) })}</span></div>
      <div class="walletOverviewValue"><strong>${formatNumber(state.gramBalance, 6)}</strong><span>GRAM</span></div>
      <div class="walletOverviewBottom"><span>${t("wallet_estimated_value")}</span><b>${state.gramUsdPrice > 0 ? `≈ $${formatFixed(state.gramBalance * state.gramUsdPrice, 3)}` : "—"}</b></div>
    </section>
    <div id="tonWalletConnection" aria-live="polite"></div>
    <section class="walletChainBalance" aria-live="polite">
      <div><span class="walletChainBalanceLabel">${t("wallet_chain_balance_title")}</span><strong id="walletChainBalanceValue">${t("wallet_chain_balance_loading")}</strong><small id="walletChainBalanceMeta">${t("deposit_network_ton_mainnet")}</small></div>
      <button type="button" class="walletChainRefresh" onclick="refreshWalletChainBalance()">↻ ${t("wallet_chain_balance_refresh")}</button>
    </section>

    <div class="tbWalletGrid">
      <div class="tbWalletCard">
        <div class="tbWalletIcon tbWalletLogoWrap"><img class="tbWalletLogo" src="img/gramup-logo-new.png" alt="Gramup" /></div>
        <div class="tbStatLabel tbColBlue">UP</div>
        <div class="tbWalletValue">${formatPoints(state.points)}</div>
      </div>
      <div class="tbWalletCard">
        <div class="tbWalletIcon tbIconBlue">${TB_ICONS.gem}</div>
        <div class="tbStatLabel tbColBlue">${t("wallet_gram_card_title")}</div>
        <div class="tbWalletValue">${formatNumber(state.gramBalance, 6)}</div>
      </div>
    </div>

    <div class="tbWalletActions">
      <button class="tbAct" type="button" onclick="showDeposit()">
        <span class="tbActIcon">${TB_ICONS.plus}</span>
        <span>${t("wallet_deposit_button")}</span>
      </button>
      <button class="tbAct" type="button" onclick="showExchange()">
        <span class="tbActIcon">${TB_ICONS.exchange}</span>
        <span>${t("wallet_exchange_button")}</span>
      </button>
      <button class="tbAct tbActPrimary" type="button" onclick="showWithdraw()">
        <span class="tbActIcon">${TB_ICONS.out}</span>
        <span>${t("wallet_withdraw_button")}</span>
      </button>
    </div>

    <div class="card">
      <p style="font-size:11px;margin-bottom:0">${t("wallet_exchange_rate_note", { rate: formatNumber(state.rate, 6) })} • ${t("wallet_min_withdraw_note", { n: formatNumber(state.minWithdrawGram, 6) })}</p>
    </div>

    <div class="card" id="withdrawHistoryCard">
      <div class="cardHeader"><div class="cardTitle">${t("wallet_history_title")}</div></div>
      <div id="withdrawHistoryList">
        <div class="loading" style="height:60px"></div>
      </div>
    </div>

    <div class="card" id="publicHistoryCard">
      <div class="cardHeader">
        <div class="cardTitle">${t("wallet_public_history_title")}</div>
      </div>
      <p class="cardSubtitle" style="margin-bottom:10px">${t("wallet_public_history_desc")}</p>
      <div id="publicHistoryList">
        <div class="loading" style="height:60px"></div>
      </div>
      <button type="button" class="secondaryBtn" style="width:100%;margin-top:12px" onclick="openProofPage()">${t("wallet_proof_button")}</button>
      <button type="button" class="secondaryBtn" style="width:100%;margin-top:8px;border-color:rgba(124,58,237,0.4);background:rgba(124,58,237,0.08);" onclick="openPayoutChannel()">${t("wallet_proof_channel_button")}</button>
    </div>
  `;

  window.gramupWallet?.mount("tonWalletConnection");
  void loadWalletChainBalance(renderRequestId);

  loadWalletHistory().then(() => {
    if (renderRequestId !== walletRenderSequence || state.activeTab !== "wallet") return;
    const list = $("#withdrawHistoryList");
    if (!list) return;
    if (walletHistoryError) { list.innerHTML = `<div class="emptyState" style="padding:20px 0"><div class="emptyDesc">${t("history_load_error")}</div><button class="secondaryBtn" type="button" onclick="retryWalletHistory()">${t("retry_button")}</button></div>`; return; }
    if (walletHistory.length === 0) {
      list.innerHTML = `<div class="emptyState" style="padding:20px 0"><div class="emptyDesc">${t("wallet_history_empty")}</div></div>`;
      return;
    }
    list.innerHTML = walletHistory.map(item => {
      const statusInfo = WITHDRAW_STATUS_UI[item.status] || { cls: "" };
      return `
        <button type="button" class="historyItem historyItemBtn" data-withdrawal-id="${escapeHTML(item._id)}">
          <div>
            <div class="historyAmount">${formatNumber(item.cryptoAmount, 6)} ${escapeHTML(item.token || "GRAM")}</div>
            <div class="historyMeta">${timeAgo(item.createdAt)}</div>
            ${item.status === "paid" && item.txHash ? `
              <div class="historyTxRow">
                <span class="verifiedTick">${item.verified ? "✅" : "⚠️"}</span>
                <span>${escapeHTML(truncateMiddle(item.txHash))}</span>
              </div>` : ""}
          </div>
          <div class="badge ${statusInfo.cls}">${t(`withdraw_status_${item.status}`)}</div>
        </button>`;
    }).join("");
  });

  loadPublicHistory().then(() => {
    if (renderRequestId !== walletRenderSequence || state.activeTab !== "wallet") return;
    const list = $("#publicHistoryList");
    if (!list) return;
    if (publicHistoryError) { list.innerHTML = `<div class="emptyState" style="padding:20px 0"><div class="emptyDesc">${t("history_load_error")}</div><button class="secondaryBtn" type="button" onclick="retryWalletHistory()">${t("retry_button")}</button></div>`; return; }
    if (publicHistory.length === 0) {
      list.innerHTML = `<div class="emptyState" style="padding:20px 0"><div class="emptyDesc">${t("wallet_public_history_empty")}</div></div>`;
      return;
    }
    list.innerHTML = publicHistory.map(item => `
      <div class="publicTxCard">
        <div class="publicTxTop">
          <span class="publicTxAmount">${formatNumber(item.amount, 6)} ${escapeHTML(item.token)}</span>
          <span class="publicTxStatus">${item.verified ? "✅" : "⚠️"} ${t("history_status_completed")}</span>
        </div>
        <div class="publicTxRow"><span>${t("history_to_label")}</span><span>${escapeHTML(truncateMiddle(item.toAddress))}</span></div>
        ${item.fromAddress ? `<div class="publicTxRow"><span>${t("history_from_label")}</span><span>${escapeHTML(truncateMiddle(item.fromAddress))}</span></div>` : ""}
        ${item.txHash ? `<div class="publicTxRow"><span>${t("history_txid_label")}</span><span>${escapeHTML(truncateMiddle(item.txHash))}</span></div>` : ""}
        <div class="publicTxRow"><span>${t("history_date_label")}</span><span style="font-family:inherit">${timeAgo(item.date)}</span></div>
        ${item.txHash ? `<a class="explorerLink" href="#" onclick="openTaskLinkOnly('https://tonviewer.com/transaction/${encodeURIComponent(item.txHash)}');return false;">🔗 ${t("history_view_explorer")}</a>` : ""}
      </div>
    `).join("");
  });
}

async function retryWalletHistory() { renderWallet(); }
window.retryWalletHistory = retryWalletHistory;

/* ================= WITHDRAWAL DETAIL (Timeline) =================
   Overlay مثل withdraw/exchange پویا ساخته می‌شود (چیزی به index.html اضافه نشده) */
function ensureWithdrawalDetailOverlay() {
  let el = document.getElementById("withdrawalDetailOverlay");
  if (!el) {
    el = document.createElement("div");
    el.id = "withdrawalDetailOverlay";
    el.className = "overlay";
    el.style.display = "none";
    document.body.appendChild(el);
  }
  return el;
}

let withdrawalDetailRequestSequence = 0;
function closeWithdrawalDetail() {
  withdrawalDetailRequestSequence += 1;
  const el = document.getElementById("withdrawalDetailOverlay");
  if (el) el.style.display = "none";
}
window.closeWithdrawalDetail = closeWithdrawalDetail;

async function openWithdrawalDetail(id) {
  const requestId = ++withdrawalDetailRequestSequence;
  const el = ensureWithdrawalDetailOverlay();
  el.style.display = "flex";
  el.innerHTML = `<div class="modalBox withdrawBox" role="dialog" aria-modal="true"><div class="loading" style="height:120px"></div></div>`;

  try {
    const data = await api(`/api/points/withdrawals/${encodeURIComponent(id)}`);
    if (requestId !== withdrawalDetailRequestSequence || el.style.display === "none") return;
    const w = data.withdrawal;
    const statusInfo = WITHDRAW_STATUS_UI[w.status] || { cls: "" };
    const showReason = (w.status === "rejected" || w.status === "cancelled") && w.adminNote;

    el.innerHTML = `
      <div class="modalBox withdrawBox" role="dialog" aria-modal="true" aria-labelledby="wdDetailTitle">
        <div class="modalHeader">
          <div>
            <span class="modalEyebrow">${t("withdrawal_detail_eyebrow")}</span>
            <h3 id="wdDetailTitle">${t("withdrawal_detail_title")}</h3>
          </div>
          <button class="closeBtn" type="button" onclick="closeWithdrawalDetail()" aria-label="${t("common_close")}">×</button>
        </div>
        <div class="withdrawBody">
          <div class="flexBetween" style="margin-bottom:12px">
            <span class="historyAmount" style="font-size:20px">${formatNumber(w.cryptoAmount, 6)} ${escapeHTML(w.token || "GRAM")}</span>
            <span class="badge ${statusInfo.cls}">${t(`withdraw_status_${w.status}`)}</span>
          </div>
          <div class="publicTxRow"><span>${t("history_to_label")}</span><span>${escapeHTML(w.address)}</span></div>
          ${w.txHash ? `<div class="publicTxRow"><span>${t("history_txid_label")}</span><span>${escapeHTML(truncateMiddle(w.txHash))}</span></div>` : ""}
          ${w.txHash ? `<a class="explorerLink" href="#" onclick="openTaskLinkOnly('https://tonviewer.com/transaction/${encodeURIComponent(w.txHash)}');return false;">🔗 ${t("history_view_explorer")}</a>` : ""}
          ${showReason ? `<p class="captchaErr" style="margin-top:10px">${t("withdrawal_detail_reason_label")}: ${escapeHTML(w.adminNote)}</p>` : ""}

          <div class="fieldLabel" style="margin-top:16px">${t("withdrawal_detail_timeline_title")}</div>
          <div class="wdTimeline">
            ${(w.timeline || []).map(step => `
              <div class="wdStep">
                <div class="wdStepDot"></div>
                <div>
                  <div class="wdStepLabel">${t(`withdraw_status_${step.status}`)}</div>
                  <div class="wdStepDate">${new Date(step.at).toLocaleString(state.language === "en" ? "en-US" : "fa-IR")}</div>
                  ${step.note ? `<div class="wdStepNote">${escapeHTML(step.note)}</div>` : ""}
                </div>
              </div>`).join("")}
          </div>
        </div>
      </div>`;
  } catch (error) {
    if (requestId !== withdrawalDetailRequestSequence || el.style.display === "none") return;
    el.innerHTML = `<div class="modalBox withdrawBox"><div class="emptyState"><div class="emptyDesc">${escapeHTML(error.message)}</div></div>
      <button type="button" class="secondaryBtn" style="width:100%;margin-top:12px" onclick="closeWithdrawalDetail()">${t("common_close")}</button></div>`;
  }
}
window.openWithdrawalDetail = openWithdrawalDetail;

/* ================= PROFILE ================= */
function copyReferralLink() {
  const link = state.shareLink;
  if (!link) return toast(t("referral_link_unavailable"), "error");

  const finish = () => {
    haptic("success");
    toast(t("referral_copied"), "success");
  };

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(link).then(finish).catch(() => fallbackCopy(link, finish));
  } else {
    fallbackCopy(link, finish);
  }
}
window.copyReferralLink = copyReferralLink;

function fallbackCopy(text, onDone) {
  const temp = document.createElement("textarea");
  temp.value = text;
  temp.style.position = "fixed";
  temp.style.opacity = "0";
  document.body.appendChild(temp);
  temp.select();
  try { document.execCommand("copy"); onDone?.(); } catch { /* ignore */ }
  document.body.removeChild(temp);
}

function shareReferralLink() {
  const link = state.shareLink;
  if (!link) return toast(t("referral_link_unavailable"), "error");
  const text = t("referral_share_message", { n: formatPoints(state.referralInitialRewardPoints) });
  if (tg?.openTelegramLink) {
    tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
  } else if (navigator.share) {
    navigator.share({ text, url: link }).catch(() => {});
  } else {
    copyReferralLink();
  }
}
window.shareReferralLink = shareReferralLink;
async function shareToTelegramStory(context = "referral") {
  const link = String(state.shareLink || "").trim();
  if (!link) return toast(t("referral_link_unavailable"), "error");
  const text = context === "milestone" ? t("story_milestone_text", { link }) : t("story_referral_text", { link });
  const telegram = window.Telegram?.WebApp;
  if (telegram && typeof telegram.shareToStory === "function") {
    try {
      const mediaUrl = new URL("/img/gramup-logo-new.png", window.location.origin).toString();
      telegram.shareToStory(mediaUrl, { text, widget_link: { url: link, name: "Gramup" } });
      return;
    } catch (error) { console.warn("Story sharing unavailable; using Telegram share fallback", error); }
  }
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
  if (telegram?.openTelegramLink) telegram.openTelegramLink(shareUrl);
  else window.open(shareUrl, "_blank", "noopener,noreferrer");
}
window.shareToTelegramStory = shareToTelegramStory;

let profileView = "menu"; // menu | referral | groups | leaderboard | about | history
let pendingProfileView = null;
let referralPreviousProfileView = "menu";
let referralBackButtonHandlerBound = false;
let referralEntryTransitionPending = false;

function syncReferralTelegramBackButton() {
  const backButton = tg?.BackButton;
  if (!backButton) return;

  const shouldShow = !state.gateActive && state.activeTab === "profile" && profileView === "referral";
  try {
    if (shouldShow && typeof backButton.show === "function") backButton.show();
    else if (!shouldShow && typeof backButton.hide === "function") backButton.hide();
  } catch (error) {
    console.warn("Telegram Referral BackButton update failed:", error);
  }
}

function returnFromReferral() {
  if (state.activeTab !== "profile" || profileView !== "referral") {
    syncReferralTelegramBackButton();
    return;
  }
  setProfileView(referralPreviousProfileView || "menu");
}

function setupReferralTelegramBackButton() {
  const backButton = tg?.BackButton;
  if (!backButton) return;

  if (!referralBackButtonHandlerBound) {
    try {
      if (typeof backButton.onClick === "function") {
        backButton.onClick(returnFromReferral);
      } else if (typeof tg.onEvent === "function") {
        tg.onEvent("backButtonClicked", returnFromReferral);
      } else {
        return;
      }
      referralBackButtonHandlerBound = true;
    } catch (error) {
      console.warn("Telegram Referral BackButton listener failed:", error);
      return;
    }
  }
  syncReferralTelegramBackButton();
}

function openHistory() {
  pendingProfileView = "history";
  navigate("profile");
}
window.openHistory = openHistory;

function openReferralHub() {
  pendingProfileView = "referral";
  navigate("profile");
}
window.openReferralHub = openReferralHub;

function setProfileView(view) {
  if (view === "referral" && profileView !== "referral") {
    referralPreviousProfileView = profileView || "menu";
    referralEntryTransitionPending = true;
  } else if (view !== "referral") {
    referralEntryTransitionPending = false;
  }
  profileView = view;
  if (view === "vip") state.vipDataLoaded = false;
  if (view === "referral") {
    state.referralFilter = "all";
    void loadReferralData();
  }
  if (view === "groups" && !state.squadsLoaded && !state.squadsLoading) void loadSquads();
  renderProfile();
  syncReferralTelegramBackButton();
}
window.setProfileView = setProfileView;

// ورود مستقیم به همان نمای Weekly Leaderboard موجود؛ سیستم داده یا رتبه‌بندی جداگانه‌ای ساخته نمی‌شود.
function openWeeklyCompetition() {
  leaderboardMode = "weekly";
  profileView = "leaderboard";
  renderProfile();
}
window.openWeeklyCompetition = openWeeklyCompetition;

function renderProfileMenu() {
  const directInvitesValue = state.referralDataLoaded
    ? formatNumber(state.invitedCount)
    : state.referralError ? "—" : "…";
  const telegramUser = getTelegramUser();
  const user = state.user || telegramUser || {};
  const firstName = user.first_name || user.firstName || "";
  const langNames = { fa: t("language_fa"), ps: t("language_ps"), en: t("language_en") };
  const level = state.level || { badge: "🥉", name: "Bronze" };

  return `
    <section class="profileOverviewCard">
      <div class="profileAvatarLg">
        ${user.photo_url ? `<img src="${escapeHTML(user.photo_url)}" alt="">` : escapeHTML(getInitials(user))}
      </div>
      <div class="profileHeadInfo">
        <div class="profileNameLg">${escapeHTML(firstName)}</div>
        <div class="tbPills">
          <span class="tbPill tbPillPurple tbPillSm">${t("tb_UP_chip", { n: formatPoints(state.points) })}</span>
          <span class="tbPill tbPillOrange tbPillSm">${directInvitesValue} ${t("tb_referrals")}</span>
          <span class="tbPill tbPillGreen tbPillSm">${escapeHTML(level.badge)} ${escapeHTML(level.name)}</span>
        </div>
      </div>
      <div class="profileBalanceMini"><span>${t("tb_total_balance")}</span><strong>${formatNumber(state.gramBalance, 3)} <small>GRAM</small></strong></div>
    </section>

    <section class="profilePulseGrid" aria-label="${escapeHTML(t("tb_your_progress"))}">
      <div><strong>${formatPoints(state.points)}</strong><small class="profilePulseUnit">${tokenIconMarkup()}<span>UP</span></small><span class="profilePulseLabel">${t("wallet_points_card_title", null, "Available Balance")}</span></div>
      <div><strong>${directInvitesValue}</strong><span class="profilePulseLabel">${t("referral_kpi_direct")}</span></div>
      <div><strong>${formatPoints(state.totalEarnedPoints)}</strong><small class="profilePulseUnit">${tokenIconMarkup()}<span>UP</span></small><span class="profilePulseLabel">${t("tb_earned")}</span></div>
    </section>
    <div class="card profileMenuPanel">
      <div class="profileMenuLabel">${t("menu_referral")}</div>
      <div class="profileList">
        <div class="profileItem" onclick="setProfileView('referral')">
          <div class="profileIcon profileIconReferral">↗</div>
          <div class="profileText">${t("menu_referral")}</div>
          <span class="profileItemHint">${t("referral_kpi_network")}</span>
          <div class="profileChevron">‹</div>
        </div>
        <div class="profileItem" onclick="setProfileView('leaderboard')">
          <div class="profileIcon">🏆</div>
          <div class="profileText">${t("menu_leaderboard")}</div>
          <div class="profileChevron">‹</div>
        </div>
        <div class="profileItem" onclick="openWeeklyCompetition()">
          <div class="profileIcon">🏆</div>
          <div class="profileText">${t("menu_weekly_competition")}</div>
          <div class="profileChevron">‹</div>
        </div>
        <div class="profileItem" onclick="setProfileView('groups')">
          <div class="profileIcon">👥</div>
          <div class="profileText">${t("squad_title")}</div>
          <div class="profileChevron">‹</div>
        </div>
        <div class="profileItem" onclick="setProfileView('history')">
          <div class="profileIcon">🧾</div>
          <div class="profileText">${t("menu_history")}</div>
          <div class="profileChevron">‹</div>
        </div>
      </div>
    </div>
    <div class="card profileMenuPanel profileSettingsPanel">
      <div class="profileMenuLabel">${t("menu_about")}</div>
      <div class="profileList">
        <div class="profileItem" onclick="setProfileView('about')">
          <div class="profileIcon">ℹ️</div>
          <div class="profileText">${t("menu_about")}</div>
          <div class="profileChevron">‹</div>
        </div>
        <div class="profileItem" onclick="showTerms()">
          <div class="profileIcon">📜</div>
          <div class="profileText">${t("menu_terms")}</div>
          <div class="profileChevron">‹</div>
        </div>
        <div class="profileItem" onclick="showPrivacy()">
          <div class="profileIcon">🔒</div>
          <div class="profileText">${t("menu_privacy")}</div>
          <div class="profileChevron">‹</div>
        </div>
        <div class="profileItem" onclick="showReferralMessageConsent(false)">
          <div class="profileIcon">✉️</div>
          <div class="profileText">${t("menu_referral_message_consent")}</div>
          <div class="profileChevron">‹</div>
        </div>
        <div class="profileItem" onclick="showOnboarding()">
          <div class="profileIcon">✨</div>
          <div class="profileText">${t("menu_onboarding")}</div>
          <div class="profileChevron">‹</div>
        </div>
        <div class="profileItem" onclick="showLanguageOverlay()">
          <div class="profileIcon">🌐</div>
          <div class="profileText">${t("menu_language")} — ${langNames[state.language]}</div>
          <div class="profileChevron">‹</div>
        </div>
        <div class="profileThemePicker" role="group" aria-label="${escapeHTML(t("theme_title"))}">
          <div class="profileThemeHeading"><span class="profileIcon">🎨</span><strong>${t("theme_title")}</strong></div>
          <div class="profileThemeChoices">
            ${Object.entries(THEME_REGISTRY).map(([id, definition]) => `<button type="button" class="themeChoice" data-theme-choice="${id}" aria-checked="false" onclick="selectTheme('${id}')"><span>${definition.icon}</span>${t(definition.labelKey)}</button>`).join("")}
          </div>
        </div>
      </div>
    </div>

  `;
}

function renderProfileGroups() {
  return `<div class="profileGroupsView"><div class="sectionHeader"><button class="sectionMore" type="button" onclick="setProfileView('menu')">${t("referral_back")}</button><h2 class="sectionTitle">${t("squad_title")}</h2><span></span></div>${renderSquadsCard()}</div>`;
}

function renderProfileAbout() {
  return `
    <div class="profileAboutView">
    <div class="sectionHeader">
      <button class="sectionMore" type="button" onclick="setProfileView('menu')">${t("referral_back")}</button>
      <h2 class="sectionTitle">${t("about_title")}</h2>
      <span></span>
    </div>

    <div class="card">
      <div class="cardHeader">
        <div class="cardTitle">${t("about_what_title")}</div>
      </div>
      <p class="cardSubtitle" style="line-height:1.9">${t("about_what_desc")}</p>
    </div>

    <div class="card">
      <div class="cardHeader">
        <div class="cardTitle">${t("about_earn_title")}</div>
      </div>
      <p class="cardSubtitle" style="line-height:1.9">${t("about_earn_desc")}</p>
    </div>


    <div class="card">
      <div class="cardHeader">
        <div class="cardTitle">${t("about_proof_title")}</div>
      </div>
      <p class="cardSubtitle" style="line-height:1.9;margin-bottom:12px">${t("about_proof_desc")}</p>
      <button type="button" class="secondaryBtn" style="width:100%" onclick="openProofPage()">${t("about_proof_button")}</button>
    </div>
    </div>
  `;
}

function renderReferralRewardTasks() {
  if (!state.referralTasks.length) return "";

  const items = state.referralTasks.map(task => {
    const progress = Math.min(100, Math.round((task.invitedCount / task.requiredInvites) * 100));
    let action = "";
    if (task.status === "claimed") {
      action = `<button class="taskAction done" type="button" disabled>${t("referral_task_claimed")}</button>`;
    } else if (task.status === "claimable") {
      action = `<button class="taskAction" type="button" data-referral-claim="${escapeHTML(task.id)}">${t("referral_claim_button")}</button>`;
    }

    return `
      <div class="taskItem referralTaskItem ${action ? "has-action" : "no-action"}" style="margin-bottom:12px">
        <div class="taskIcon">👥</div>
        <div class="taskBody">
          <div class="taskTitle">${t("referral_task_invite", { n: formatPoints(task.requiredInvites) })}</div>
          <div class="taskDesc" style="display:flex;align-items:center;gap:9px">
            <span>${formatPoints(task.requiredInvites)}</span>
            <span style="display:inline-block;width:18px;height:1px;background:var(--text-muted);opacity:.7"></span>
            <span>${formatPoints(task.invitedCount)} ${t("referral_active_label")}</span>
          </div>
          <div class="taskReward">+${tokenAmount(task.rewardPoints)}</div>
          <div style="height:6px;background:var(--surface-3);border-radius:999px;overflow:hidden;margin-top:8px">
            <div style="height:100%;width:${progress}%;background:linear-gradient(90deg,var(--primary),var(--primary-2));border-radius:999px;transition:width .3s ease"></div>
          </div>
        </div>
        ${action}
        <button class="secondaryBtn" type="button" onclick="shareToTelegramStory('milestone')">${t("story_share_button")}</button>
      </div>`;
  }).join("");

  // عنوان بخش خارج از کارت‌هاست؛ هر milestone خودش یک کارت مستقل است
  // تا دقیقاً با کارت‌های تسک کانال Telegram هم‌ساختار باشد.
  return `
    <section class="referralMilestonesSection" aria-labelledby="referralMilestonesTitle">
      <div class="cardHeader referralMilestonesHeader">
        <div class="cardTitle" id="referralMilestonesTitle">${t("referral_milestones_title")}</div>
      </div>
      <div class="referralMilestonesList">${items}</div>
    </section>`;
}

function renderTeamCommissionCard() {
  if (!state.referralLevelRates.length) return "";
  const rows = state.referralLevelRates.map((rate, index) => `
    <div class="flexBetween" style="padding:10px 12px;border:1px solid var(--line);border-radius:13px;background:var(--surface-2);margin-top:8px">
      <span style="font-weight:700">${t("referral_level_label", { n: index + 1 })}</span>
      <span class="badge gold">${formatNumber(rate)}%</span>
    </div>`).join("");
  return `
    <div class="card">
      <div class="cardHeader"><div class="cardTitle">💰 ${t("referral_team_commission_title")}</div></div>
      <p class="cardSubtitle" style="line-height:1.8">${t("referral_team_commission_desc")}</p>
      ${rows}
    </div>`;
}

function renderReferralStatsCard() {
  const stats = state.referralStats;
  if (!stats) return "";
  const levelRows = state.referralLevelRates.map((_, index) => `
    <div class="card" style="margin:0;padding:12px;background:var(--surface-2)">
      <div class="cardSubtitle">${t("referral_level_label", { n: index + 1 })}</div>
      <div style="font-size:18px;font-weight:850;margin-top:5px">${formatNumber(Number(stats.levelCounts?.[String(index + 1)]) || 0)}</div>
    </div>`).join("");
  return `
    <div class="card">
      <div class="cardHeader"><div class="cardTitle">${t("referral_stats_title")}</div></div>
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:10px">
        <div class="card" style="margin:0;padding:12px;background:var(--surface-2)"><div class="cardSubtitle">${t("referral_total_count")}</div><div style="font-size:18px;font-weight:850;margin-top:5px">${formatNumber(Number(stats.totalReferrals) || 0)}</div></div>
        <div class="card" style="margin:0;padding:12px;background:var(--surface-2)"><div class="cardSubtitle">${t("referral_active_count")}</div><div style="font-size:18px;font-weight:850;margin-top:5px">${formatNumber(Number(stats.activeReferrals) || 0)}</div></div>
        ${levelRows}
        <div class="card" style="margin:0;padding:12px;background:var(--surface-2)"><div class="cardSubtitle">${t("referral_total_invite_rewards")}</div><div style="font-size:17px;font-weight:850;margin-top:5px">${tokenAmount(Number(stats.totalInviteRewardsPoints) || 0)}</div></div>
        <div class="card" style="margin:0;padding:12px;background:var(--surface-2)"><div class="cardSubtitle">${t("referral_total_team_commission")}</div><div style="font-size:17px;font-weight:850;margin-top:5px">${tokenAmount(Number(stats.totalTeamCommissionPoints) || 0)}</div></div>
        <div class="card" style="margin:0;padding:12px;background:var(--surface-2)"><div class="cardSubtitle">${t("referral_tier1_members")}</div><div style="font-size:18px;font-weight:850;margin-top:5px">${formatNumber(Number(stats.tier1Members) || 0)}</div><small>${t("referral_tier1_rate")}</small></div>
        <div class="card" style="margin:0;padding:12px;background:var(--surface-2)"><div class="cardSubtitle">${t("referral_tier2_members")}</div><div style="font-size:18px;font-weight:850;margin-top:5px">${formatNumber(Number(stats.tier2Members) || 0)}</div><small>${t("referral_tier2_rate")}</small></div>
        <div class="card" style="margin:0;padding:12px;background:var(--surface-2)"><div class="cardSubtitle">${t("referral_mining_commission_t1")}</div><div style="font-size:17px;font-weight:850;margin-top:5px">${tokenAmount(Number(stats.miningCommissionByTier?.["1"]) || 0)}</div></div>
        <div class="card" style="margin:0;padding:12px;background:var(--surface-2)"><div class="cardSubtitle">${t("referral_mining_commission_t2")}</div><div style="font-size:17px;font-weight:850;margin-top:5px">${tokenAmount(Number(stats.miningCommissionByTier?.["2"]) || 0)}</div></div>
      </div>
    </div>`;
}

function setReferralLevelFilter(value) {
  const filter = String(value);
  if (filter !== "all") {
    const level = Number(filter);
    if (!Number.isInteger(level) || level < 1 || level > state.referralLevelRates.length) return;
  }
  state.referralFilter = filter;
  renderProfile();
}
window.setReferralLevelFilter = setReferralLevelFilter;

function retryReferralData() {
  state.referralError = "";
  void loadReferralData({ force: true });
  renderProfile();
}
window.retryReferralData = retryReferralData;

function formatReferralJoinDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "—";
  const locale = state.language === "en" ? "en-US" : state.language === "ps" ? "ps-AF" : "fa-IR";
  return date.toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" });
}

function renderReferralPageHeader() {
  return `
    <header class="referralHeading">
      <div class="referralHeadingIcon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none"><path d="M15.5 19.5v-1.3a3.2 3.2 0 0 0-3.2-3.2H6.7a3.2 3.2 0 0 0-3.2 3.2v1.3M9.5 11.5a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2ZM19 8v6M16 11h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <div class="referralHeadingText">
        <span class="rf-overline">${t("referral_eyebrow")}</span>
        <h1 class="referralPageTitle">${t("referral_hub_title")}</h1>
        <p class="referralPageSubtitle">${t("referral_hub_subtitle")}</p>
      </div>
    </header>`;
}

function renderProfileReferral() {
  const header = renderReferralPageHeader();
  if (state.referralLoading) {
    return `<div class="referralPage">${header}<div class="referralLoadingCard" role="status"><span class="referralSpinner"></span><span>${t("referral_loading")}</span></div></div>`;
  }
  if (state.referralError) {
    return `<div class="referralPage">${header}<div class="referralErrorCard" role="alert"><span class="referralErrorIcon">!</span><p>${t("referral_load_error")}</p><button type="button" class="referralRetryBtn" onclick="retryReferralData()">${t("referral_retry")}</button></div></div>`;
  }

  const stats = state.referralStats || {};
  const totalEarnings = Math.max(0, Number(stats.totalReferralEarningsPoints) || 0);
  const monthlyEarnings = Math.max(0, Number(stats.thisMonthReferralEarningsPoints) || 0);
  const directCount = Math.max(0, Number(stats.totalReferrals) || 0);
  const activeCount = Math.max(0, Number(stats.activeReferrals) || 0);
  const networkSize = Math.max(0, Number(stats.totalNetwork) || 0);
  const currentLevel = Math.max(0, Number(stats.currentReferralLevel) || 0);
  const rawNetwork = Array.isArray(state.referralNetworkLevels) ? state.referralNetworkLevels : [];
  const configuredRates = Array.isArray(state.referralLevelRates) ? state.referralLevelRates : [];
  const buckets = [
    { key: "1", label: t("referral_level_label", { n: 1 }), min: 1, max: 1 },
    { key: "2", label: t("referral_level_label", { n: 2 }), min: 2, max: 2 },
    { key: "3", label: t("referral_level_label", { n: 3 }), min: 3, max: 3 },
    { key: "4plus", label: t("referral_level_4_plus"), min: 4, max: Infinity }
  ].map(bucket => {
    const rows = rawNetwork.filter(row => Number(row.level) >= bucket.min && Number(row.level) <= bucket.max);
    const configuredRateValues = bucket.key === "4plus"
      ? configuredRates.slice(3)
      : [configuredRates[bucket.min - 1]];
    const rateValues = configuredRateValues.filter(Number.isFinite);
    return {
      ...bucket,
      members: rows.reduce((sum, row) => sum + (Number(row.members) || 0), 0),
      active: rows.reduce((sum, row) => sum + (Number(row.activeMembers) || 0), 0),
      earned: rows.reduce((sum, row) => sum + (Number(row.commissionPoints) || 0), 0),
      rate: rateValues[0] ?? null,
      rateLabel: rateValues.length ? `${rateValues.map(value => formatNumber(value)).join(" / ")}%` : "—"
    };
  });
  const maxMembers = Math.max(1, ...buckets.map(row => row.members));
  const levelCards = buckets.map((row, index) => `
    <article class="rf-level-card rf-level-${Math.min(index + 1, 4)}">
      <div class="rf-level-top"><span>${escapeHTML(row.label)}</span><strong>${row.rateLabel}</strong></div>
      <small class="rf-level-desc">${t(`referral_level_relationship_${row.key}`)}</small>
      <div class="rf-level-bar"><i style="width:${Math.min(100, row.members / maxMembers * 100)}%"></i></div>
      <div class="rf-level-foot"><span>${formatNumber(row.active)} / ${formatNumber(row.members)} ${t("referral_active_short")}</span><b>+${formatPoints(row.earned)}</b></div>
    </article>`).join("");

  const history = (Array.isArray(state.referralHistory) ? state.referralHistory : []).slice(0, 20);
  const historyRows = history.map(item => {
    const kindKey = item.kind === "commission" ? "referral_history_commission"
      : item.kind === "milestone" ? "referral_history_milestone"
        : item.kind === "welcome" ? "referral_history_welcome"
        : "referral_history_direct_invite";
    const title = t(kindKey);
    const sourceLabel = item.kind === "commission" ? t(`referral_source_${item.source || "other"}`) : "";
    const meta = [];
    if (item.kind === "commission") {
      meta.push(t("referral_history_level_rate", { level: formatPoints(item.level || 0), rate: formatNumber(Number(item.rate) || 0) }));
      meta.push(t("referral_history_source_earned", { source: sourceLabel, points: formatPoints(Number(item.sourceEarnedPoints) || 0) }));
    }
    meta.push(formatReferralJoinDate(item.date));
    return `
      <li class="rf-history-row" key="${escapeHTML(item.id || "")}">
        <span class="rf-history-icon" aria-hidden="true">${item.kind === "commission" ? "↗" : item.kind === "milestone" ? "✦" : "＋"}</span>
        <span class="rf-history-main"><strong>${escapeHTML(title)}</strong><small>${escapeHTML(meta.join(" · "))}</small></span>
        <b class="rf-history-points">+${tokenAmount(Number(item.points) || 0)}</b>
      </li>`;
  }).join("");
  const currentLevelLabel = currentLevel > 0 ? t("referral_level_label", { n: formatPoints(currentLevel) }) : "—";
  const rewardPoints = Number(state.referralInitialRewardPoints);
  const rewardDisplay = Number.isFinite(rewardPoints) && rewardPoints > 0
    ? formatPoints(rewardPoints)
    : t("referral_reward_unconfigured");

  return `
    <div class="referralPage referralDashboard">
      ${header}

      <section class="rf-hero" aria-labelledby="rfHeroTitle">
        <div class="rf-hero-orbit" aria-hidden="true"></div>
        <div class="rf-hero-top"><span class="rf-overline">${t("referral_hero_eyebrow")}</span><span class="rf-hero-badge">${t("referral_reward_direct_badge", { n: rewardDisplay })}</span></div>
        <h2 class="rf-hero-title" id="rfHeroTitle">${t("referral_total_earnings_title")}</h2>
        <div class="rf-hero-total"><span class="rf-hero-coin" aria-hidden="true">◇</span><strong>${tokenAmount(totalEarnings)}</div>
        <div class="rf-hero-bottom"><span>${t("referral_this_month")}</span><strong>+${tokenAmount(monthlyEarnings)}</strong></div>
      </section>

      <section class="rf-kpi-grid" aria-label="${escapeHTML(t("referral_stats_title"))}">
        <article class="rf-kpi"><span class="rf-kpi-icon">♙</span><strong>${formatNumber(directCount)}</strong><small>${t("referral_kpi_direct")}</small></article>
        <article class="rf-kpi rf-kpi-active"><span class="rf-kpi-icon">●</span><strong>${formatNumber(activeCount)}</strong><small>${t("referral_kpi_active")}</small></article>
        <article class="rf-kpi"><span class="rf-kpi-icon">⌘</span><strong>${formatNumber(networkSize)}</strong><small>${t("referral_kpi_network")}</small></article>
        <article class="rf-kpi rf-kpi-level"><span class="rf-kpi-icon">✧</span><strong>${escapeHTML(currentLevelLabel)}</strong><small>${t("referral_kpi_level")}</small></article>
      </section>

      <section class="rf-panel" aria-label="${escapeHTML(t("referral_mining_commission_t1"))}">
        <div class="rf-section-heading"><div><span class="rf-overline">${t("referral_team_commission_title")}</span><h2>${t("referral_tier1_members")} / ${t("referral_tier2_members")}</h2></div></div>
        <div class="rf-network-list">
          <div class="rf-network-row"><span class="rf-network-level">${t("referral_tier1_members")} · 10%</span><span class="rf-network-count">${formatNumber(Number(stats.tier1Members) || 0)} <small>${t("referral_members_label")}</small></span><span class="rf-network-active">${tokenAmount(Number(stats.miningCommissionByTier?.["1"]) || 0)} UP</span></div>
          <div class="rf-network-row"><span class="rf-network-level">${t("referral_tier2_members")} · 2.5%</span><span class="rf-network-count">${formatNumber(Number(stats.tier2Members) || 0)} <small>${t("referral_members_label")}</small></span><span class="rf-network-active">${tokenAmount(Number(stats.miningCommissionByTier?.["2"]) || 0)} UP</span></div>
        </div>
      </section>

      <section class="rf-panel rf-link-panel" aria-labelledby="rfLinkTitle">
        <div class="rf-panel-heading"><span class="rf-panel-symbol">↗</span><div><span class="rf-overline">${t("referral_link_eyebrow")}</span><h2 id="rfLinkTitle">${t("referral_link_title_new")}</h2></div></div>
        <div class="rf-link-box" dir="ltr"><span aria-hidden="true">⌁</span><b title="${escapeHTML(state.shareLink || "")}">${escapeHTML(state.shareLink || "—")}</b></div>
        <div class="referralLinkActions rf-link-actions">
          <button type="button" class="referralCopyBtn" onclick="copyReferralLink()" ${state.shareLink ? "" : "disabled"}>▢ ${t("referral_copy_button")}</button>
          <button type="button" class="referralShareBtn" onclick="shareReferralLink()" ${state.shareLink ? "" : "disabled"}>↗ ${t("referral_share_button")}</button>
          <button type="button" class="referralShareBtn" onclick="shareToTelegramStory()" ${state.shareLink ? "" : "disabled"}>${t("story_share_button")}</button>
        </div>
        <p class="rf-panel-note">${state.referralMiniAppConfigured ? t("referral_link_note") : t("referral_link_config_missing")}</p>
      </section>

      <section class="rf-panel" aria-labelledby="rfLevelsTitle">
        <div class="rf-section-heading"><div><span class="rf-overline">${t("referral_rates_eyebrow")}</span><h2 id="rfLevelsTitle">${t("referral_levels_title")}</h2></div><span class="rf-section-glyph">◎</span></div>
        <div class="rf-level-grid">${levelCards}</div>
        <p class="rf-panel-note">${t("referral_eligible_earnings_note")}</p>
      </section>

      <section class="rf-panel" aria-labelledby="rfNetworkTitle">
        <div class="rf-section-heading"><div><span class="rf-overline">${t("referral_network_eyebrow")}</span><h2 id="rfNetworkTitle">${t("referral_network_title")}</h2></div><span class="rf-network-total">${formatNumber(networkSize)}</span></div>
        <div class="rf-network-list">${buckets.map(row => `
          <div class="rf-network-row"><span class="rf-network-level">${escapeHTML(row.label)}</span><span class="rf-network-count">${formatNumber(row.members)} <small>${t("referral_members_label")}</small></span><span class="rf-network-active">${formatNumber(row.active)} ${t("referral_active_short")}</span></div>`).join("")}</div>
        <p class="rf-panel-note">${t("referral_network_privacy_note")}</p>
      </section>

      <section class="rf-panel rf-how-panel" aria-labelledby="rfHowTitle">
        <div class="rf-section-heading"><div><span class="rf-overline">${t("referral_how_eyebrow")}</span><h2 id="rfHowTitle">${t("referral_how_title")}</h2></div><span class="rf-section-glyph">✦</span></div>
        <ol class="rf-how-list">
          <li><span>01</span><p>${t("referral_how_step_1")}</p></li>
          <li><span>02</span><p>${t("referral_how_step_2", { n: rewardDisplay })}</p></li>
          <li><span>03</span><p>${t("referral_how_step_3")}</p></li>
          <li><span>04</span><p>${t("referral_how_step_4")}</p></li>
        </ol>
      </section>

      <section class="rf-panel" aria-labelledby="rfHistoryTitle">
        <div class="rf-section-heading"><div><span class="rf-overline">${t("referral_history_eyebrow")}</span><h2 id="rfHistoryTitle">${t("referral_history_title")}</h2></div><span class="rf-section-glyph">◷</span></div>
        ${historyRows ? `<ul class="rf-history-list">${historyRows}</ul>` : `<div class="rf-empty-history">${t("referral_history_empty")}</div>`}
      </section>

      ${renderReferralRewardTasks()}
    </div>`;
}

let leaderboardMode = "all";
function setLeaderboardMode(mode) {
  leaderboardMode = mode === "weekly" ? "weekly" : "all";
  renderProfile();
}
window.setLeaderboardMode = setLeaderboardMode;

let weeklyCountdownTimer = null;
let weeklyRolloverLoading = false;

function stopWeeklyCompetitionCountdown() {
  if (weeklyCountdownTimer) clearInterval(weeklyCountdownTimer);
  weeklyCountdownTimer = null;
}

function formatWeeklyCountdown(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${days}d ${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
}

function renderWeeklyCompetitionBanner() {
  const prizes = Array.isArray(state.weeklyLeaderboardMeta?.prizes)
    ? state.weeklyLeaderboardMeta.prizes.slice(0, 3)
    : [500, 250, 100];
  return `
    <div class="weeklyCompetitionBanner">
      <div class="weeklyCompetitionTitle">🏆 ${t("weekly_competition_title")}</div>
      <div class="weeklyCompetitionDescription">${t("weekly_competition_description")}</div>
      <div class="weeklyCompetitionRewardsTitle">🎁 ${t("weekly_rewards_title")}</div>
      <div class="weeklyCompetitionRewards">
        <span>🥇 ${t("weekly_reward_first", { n: formatPoints(prizes[0] || 0) })}</span>
        <span>🥈 ${t("weekly_reward_second", { n: formatPoints(prizes[1] || 0) })}</span>
        <span>🥉 ${t("weekly_reward_third", { n: formatPoints(prizes[2] || 0) })}</span>
      </div>
      <div class="weeklyCompetitionCountdownLabel">⏳ ${t("weekly_competition_ends_in")}</div>
      <div id="weeklyCompetitionCountdown" class="weeklyCompetitionCountdown">${t("weekly_competition_calculating")}</div>
      <div class="weeklyCompetitionDescription" style="margin-top:10px">📌 ${t("weekly_competition_rules")}</div>
      <div class="weeklyCompetitionDescription" style="margin-top:5px">🎁 ${t("weekly_competition_auto_payment")}</div>
    </div>
  `;
}

async function startWeeklyCompetitionCountdown() {
  stopWeeklyCompetitionCountdown();
  if (leaderboardMode !== "weekly") return;

  const countdown = document.getElementById("weeklyCompetitionCountdown");
  const endAt = new Date(state.weeklyLeaderboardMeta?.weekEnd || 0).getTime();
  if (!countdown || !Number.isFinite(endAt) || endAt <= 0) return;

  const tick = async () => {
    const remaining = endAt - (Date.now() + Number(state.weeklyServerOffsetMs || 0));
    if (remaining <= 0) {
      countdown.textContent = t("weekly_competition_refreshing");
      stopWeeklyCompetitionCountdown();
      if (weeklyRolloverLoading) return;
      weeklyRolloverLoading = true;
      try {
        await loadWeeklyLeaderboard();
        if (profileView === "leaderboard" && leaderboardMode === "weekly") {
          const content = $("#content");
          if (content) {
            content.innerHTML = renderProfileLeaderboard();
            startWeeklyCompetitionCountdown();
          }
        }
      } finally {
        weeklyRolloverLoading = false;
      }
      return;
    }
    countdown.textContent = formatWeeklyCountdown(remaining);
  };

  await tick();
  if (!weeklyCountdownTimer && document.getElementById("weeklyCompetitionCountdown")) {
    weeklyCountdownTimer = setInterval(tick, 1000);
  }
}

async function retryLeaderboard() { if (leaderboardMode === "weekly") await loadWeeklyLeaderboard(); else await loadLeaderboard(); if (state.activeTab === "profile" && profileView === "leaderboard") renderProfile(); }
window.retryLeaderboard = retryLeaderboard;

function renderProfileLeaderboard() {
  const weekly = leaderboardMode === "weekly";
  const list = weekly ? state.weeklyLeaderboard : state.leaderboard;
  const myRank = weekly ? state.weeklyMyRank : state.myRank;
  const loadError = weekly ? weeklyLeaderboardLoadError : leaderboardLoadError;
  const errorHtml = loadError ? `<div class="card" role="status"><div class="emptyDesc">${t("error_generic")}</div><button class="secondaryBtn" type="button" onclick="retryLeaderboard()">${t("retry_button")}</button></div>` : "";
  const rows = list.map((person, index) => {
    const rank = index + 1;
    const rankClass = rank === 1 ? "top1" : rank === 2 ? "top2" : rank === 3 ? "top3" : "";
    const isMe = Boolean(person.isMe);
    return `
      <div class="leaderboardItem ${isMe ? "me" : ""}">
        <div class="rankBadge ${rankClass}">${formatPoints(rank)}</div>
        <div class="leaderName">${escapeHTML(person.firstName || person.username || "—")}</div>
        <div class="leaderPoints">${formatPoints(person.points)}${weekly && person.prizePoints ? `<small class="leaderPrize">+${formatPoints(person.prizePoints)}</small>` : ""}</div>
      </div>`;
  }).join("");

  return `
    <div class="profileLeaderboardView">
    <div class="sectionHeader">
      <button class="sectionMore" type="button" onclick="setProfileView('menu')">${t("referral_back")}</button>
      <h2 class="sectionTitle">${weekly ? t("weekly_leaderboard_title") : t("leaderboard_title")}</h2>
      <span></span>
    </div>

    <div class="card" style="display:flex;gap:8px;padding:8px">
      <button class="${!weekly ? "primaryBtn" : "secondaryBtn"}" type="button" style="min-height:40px;padding:8px" onclick="setLeaderboardMode('all')">${t("leaderboard_all_time")}</button>
      <button class="${weekly ? "primaryBtn" : "secondaryBtn"}" type="button" style="min-height:40px;padding:8px" onclick="setLeaderboardMode('weekly')">${t("leaderboard_weekly")}</button>
    </div>
    ${weekly ? renderWeeklyCompetitionBanner() : ""}
    ${errorHtml}
    ${myRank ? `
      <div class="card" style="text-align:center">
        <div class="cardSubtitle">${t("leaderboard_rank_label")}</div>
        <div style="font-size:24px;font-weight:900;margin-top:4px">#${formatPoints(myRank)}</div>
        ${weekly ? `<div class="cardSubtitle">${tokenAmount(state.weeklyMyPoints)}</div>` : ""}
      </div>` : ""
    }

    ${list.length === 0 && !loadError
      ? `<div class="card emptyState"><div class="emptyDesc">${t("leaderboard_empty")}</div></div>`
      : rows
    }
  `;
}

function renderProfileHistory() {
  const rows = historyList.map(item => {
    const isPendingDeposit = item.type === "deposit" && item.status === "pending";
    const isPositive = item.type === "deposit" ? item.status === "confirmed" : Number(item.amount) >= 0;
    const unit = item.currency === "gram" ? "GRAM" : t("UP_unit");
    const amountText = isPendingDeposit
      ? t("deposit_pending_amount")
      : `${isPositive ? "+" : ""}${item.currency === "gram" ? formatNumber(item.amount, 9) : formatPoints(item.amount)} ${unit}`;
    const icon = (LEDGER_TYPE_UI[item.type] || {}).icon || "🔸";
    const desc = item.type === "spin_paid" ? t("history_type_spin_paid") : item.description || t(`history_type_${item.type}`);
    const referralMeta = item.type === "referral_commission"
      ? `${t("history_referral_level", { n: item.referralLevel || "—" })} · ${Number(item.commissionRatePercent || 0)}%`
      : item.type === "referral_initial" ? t("history_referral_initial") : "";
    const transactionMeta = item.transactionId ? `${t("history_txid_label")} ${truncateMiddle(item.transactionId, 5, 5)}` : "";
    const depositStatusMeta = item.type === "deposit"
      ? t(item.status === "confirmed" ? "history_status_confirmed" : item.status === "rejected" ? "history_status_rejected" : "history_status_pending")
      : "";
    const earningMeta = item.earningTransactionId ? `${t("history_source_earning")} ${truncateMiddle(item.earningTransactionId, 5, 5)}` : "";
    const referralUsersMeta = item.sourceUserId || item.recipientUserId
      ? `${t("history_source_user")} ${truncateMiddle(String(item.sourceUserId || "—"), 5, 5)} · ${t("history_recipient_user")} ${truncateMiddle(String(item.recipientUserId || "—"), 5, 5)}`
      : "";

    return `
      <div class="ledgerRow">
        <div class="ledgerIcon">${icon}</div>
        <div class="ledgerBody">
          <div class="ledgerDesc">${escapeHTML(desc)}</div>
          <div class="historyMeta">${timeAgo(item.transactionAt || item.verifiedAt || item.createdAt)}${depositStatusMeta ? ` · ${escapeHTML(depositStatusMeta)}` : ""}${referralMeta ? ` · ${escapeHTML(referralMeta)}` : ""}${transactionMeta ? ` · ${escapeHTML(transactionMeta)}` : ""}${earningMeta ? ` · ${escapeHTML(earningMeta)}` : ""}${referralUsersMeta ? ` · ${escapeHTML(referralUsersMeta)}` : ""}</div>
        </div>
        <div class="ledgerAmount ${isPendingDeposit ? "" : isPositive ? "positive" : "negative"}">${amountText}</div>
      </div>`;
  }).join("");

  return `
    <div class="profileHistoryView">
    <div class="sectionHeader">
      <button class="sectionMore" type="button" onclick="setProfileView('menu')">${t("referral_back")}</button>
      <h2 class="sectionTitle">${t("history_page_title")}</h2>
      <span></span>
    </div>

    <div class="card" style="padding:0">
      ${historyList.length === 0
        ? `<div class="emptyState"><div class="emptyIcon">🧾</div><div class="emptyDesc">${t("history_empty")}</div></div>`
        : rows
      }
    </div>

    ${historyHasMore ? `<button class="loadMoreBtn" id="historyLoadMoreBtn" type="button" onclick="loadMoreHistory()">${t("history_load_more")}</button>` : ""}
    </div>
  `;
}

async function loadVipPlans() {
  if (state.vipLoading) return false;
  state.vipLoading = true;
  state.vipError = "";
  try {
    const data = await api("/api/points/vip/plans");
    state.vipPlans = Array.isArray(data?.plans) ? data.plans : [];
    state.vipSubscriptions = Array.isArray(data?.subscriptions) ? data.subscriptions : [];
    if (data?.points != null) state.points = Number(data.points) || 0;
    const serverNow = Date.parse(data?.serverNow || "");
    state.vipServerOffsetMs = Number.isFinite(serverNow) ? serverNow - Date.now() : 0;
    state.vipServerNowMs = Number.isFinite(serverNow) ? serverNow : Date.now();
    state.vipDataLoaded = true;
    return true;
  } catch (error) {
    console.warn("Mining plans failed:", error);
    state.vipError = translateServerMessage(error.code, error.message) || t("vip_error");
    state.vipDataLoaded = false;
    return false;
  } finally {
    state.vipLoading = false;
  }
}

async function loadMiningStatus() {
  if (state.miningLoading) return false;
  state.miningLoading = true;
  try {
    const data = await api('/api/mining/status');
    state.mining = data?.mining || null;
    return true;
  } catch (error) {
    console.warn('Mining status failed:', error);
    return false;
  } finally {
    state.miningLoading = false;
  }
}

function renderMiningPanel() {
  const mining = state.mining;
  if (!mining) return '';
  const boltIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2 4 14h6l-1 8 11-14h-7l1-6z"/></svg>';
  const diamondIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 3 12 0 4 6-10 12L2 9l4-6z"/><path d="M2 9h20M6 3l6 18 6-18"/></svg>';
  const products = [['hash_boost_7d', boltIcon, t('stars_hash_boost'), 150], ['vip_gold', diamondIcon, t('stars_vip_gold'), 250]];
  return `<section class="phase3MiningCard phase3StarsOnly" aria-label="${t('stars_shop_title')}">
    <div class="phase3StarsShop"><h4>${t('stars_shop_title')}</h4><div class="phase3StarsGrid">${products.map(([key, icon, label, stars]) => `<button type="button" class="phase3StarsCard" onclick="buyStarsProduct('${key}')"><span aria-hidden="true">${icon}</span><b>${label}</b><small>${stars} XTR</small></button>`).join('')}</div></div>
  </section>`;
}

async function claimMining() {
  if (!readModelActionAllowed()) return;
  haptic('medium');
  const scope = 'mining_claim';
  try { const result = await api('/api/mining/claim', { method: 'POST', body: {}, headers: { 'Idempotency-Key': getPendingIdempotencyKey(scope) } }); clearPendingIdempotencyKey(scope); state.mining = result.mining; state.points = Number(result.newBalance) || state.points; haptic('success'); toast(t('mining_claim_success', { n: formatPoints(result.claimedPoints) }), 'success'); rerenderActiveUserDataView(); }
  catch (error) { haptic('error'); toast(error.message, 'error'); }
}
window.claimMining = claimMining;

async function upgradeMining(type) {
  if (!readModelActionAllowed()) return;
  haptic('selection');
  const scope = `mining_upgrade_${type}`;
  try { const result = await api('/api/mining/upgrade', { method: 'POST', body: { type }, headers: { 'Idempotency-Key': getPendingIdempotencyKey(scope) } }); clearPendingIdempotencyKey(scope); state.mining = result.mining; state.points = Number(result.newBalance) || state.points; haptic('success'); toast(t('mining_upgrade_success'), 'success'); rerenderActiveUserDataView(); }
  catch (error) { haptic('error'); toast(error.message, 'error'); }
}
window.upgradeMining = upgradeMining;

async function buyStarsProduct(product) {
  haptic('selection');
  try { await api('/api/mining/stars/invoice', { method: 'POST', body: { product } }); toast(t('stars_invoice_sent'), 'success'); }
  catch (error) { haptic('error'); toast(error.message, 'error'); }
}
window.buyStarsProduct = buyStarsProduct;

function formatVipCountdown(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return days > 0
    ? `${days}d ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

let vipCountdownTimer = null;
let vipCountdownRefreshPending = false;
const vipClaimingIds = new Set();
const vipPurchasingPlanNumbers = new Set();
let vipSelectedCategory = "starter";
let vipSubscriptionFilter = "active";
let vipClaimAllBusy = false;
let vipClaimAllProgress = { done: 0, total: 0 };

function setVipPlanCategory(category) {
  if (!["starter", "pro", "ultimate"].includes(category)) return;
  vipSelectedCategory = category;
  if ((state.activeTab === "profile" && profileView === "vip") || state.activeTab === "vip") {
    const content = $("#content");
    if (content) content.innerHTML = renderProfileVip();
    startVipCountdown();
  }
}
window.setVipPlanCategory = setVipPlanCategory;

function setVipSubscriptionFilter(filter) {
  if (!["active", "expired"].includes(filter)) return;
  vipSubscriptionFilter = filter;
  if ((state.activeTab === "profile" && profileView === "vip") || state.activeTab === "vip") {
    const content = $("#content");
    if (content) content.innerHTML = renderProfileVip();
    startVipCountdown();
  }
}
window.setVipSubscriptionFilter = setVipSubscriptionFilter;

function stopVipCountdown() {
  if (vipCountdownTimer) clearInterval(vipCountdownTimer);
  vipCountdownTimer = null;
  vipCountdownRefreshPending = false;
}

function updateVipLiveDashboard() {
  const now = Date.now() + Number(state.vipServerOffsetMs || 0);
  const activeSubscriptions = (state.vipSubscriptions || []).filter(subscription => subscription.status === "active");
  const liveSubscriptions = activeSubscriptions.filter(subscription => {
    const endAt = Date.parse(subscription.endAt || "");
    return Number.isFinite(endAt) && now < endAt;
  });
  const storageFull = liveSubscriptions.some(subscription => vipStorageFull(subscription, now));
  const storageCapAt = liveSubscriptions
    .map(subscription => vipStorageCapAt(subscription))
    .filter(Number.isFinite)
    .reduce((soonest, value) => Math.min(soonest, value), Infinity);
  const total = activeSubscriptions.reduce((sum, subscription) => sum + vipLiveUnclaimed(subscription, now), 0);
  const dailyTotal = activeSubscriptions.reduce((sum, subscription) => {
    const endAt = Date.parse(subscription.endAt || "");
    return sum + (Number.isFinite(endAt) && now >= endAt ? 0 : Number(subscription.dailyMiningRatePoints || 0));
  }, 0);
  const liveCount = activeSubscriptions.filter(subscription => {
    const endAt = Date.parse(subscription.endAt || "");
    return Number.isFinite(endAt) && now < endAt;
  }).length;
  const claimable = activeSubscriptions.some(subscription => vipLiveUnclaimed(subscription, now) >= 0.01);

  document.querySelectorAll("[data-vip-unclaimed-total], [data-vip-claim-total]").forEach(element => {
    element.textContent = formatNumber(total, 3);
  });
  document.querySelectorAll("[data-vip-daily-total]").forEach(element => {
    element.textContent = formatNumber(dailyTotal, 2);
  });
  document.querySelectorAll("[data-vip-active-count]").forEach(element => {
    element.textContent = formatPoints(liveCount);
  });
  document.querySelectorAll("[data-vip-mining-status-label]").forEach(element => {
    element.textContent = t(storageFull ? "vip_storage_full" : liveCount ? "vip_mining_live" : activeSubscriptions.length ? "vip_settlement_ready" : "vip_status_inactive");
  });
  const storageRemainingMs = Number.isFinite(storageCapAt) ? Math.max(0, storageCapAt - now) : null;
  document.querySelectorAll("[data-vip-storage-countdown]").forEach(element => {
    element.hidden = storageRemainingMs === null;
    element.classList.toggle("isFull", storageFull);
    if (storageRemainingMs === null) return;
    const text = element.querySelector("[data-vip-storage-countdown-text]");
    if (text) text.textContent = t("vip_storage_full_in", { time: formatVipStorageTime(storageRemainingMs) });
    const ring = element.querySelector("[data-vip-storage-ring]");
    if (ring) {
      const remainingRatio = Math.max(0, Math.min(1, storageRemainingMs / 86400000));
      ring.style.strokeDashoffset = String(226.1946710584651 * (1 - remainingRatio));
    }
  });
  document.querySelectorAll("[data-vip-mining-status]").forEach(element => {
    element.classList.toggle("isActive", liveCount > 0 && !storageFull);
    element.classList.toggle("isInactive", liveCount === 0 || storageFull);
  });
    for (const subscription of activeSubscriptions) {
      const id = String(subscription.id || "");
      const ended = Number.isFinite(Date.parse(subscription.endAt || "")) && now >= Date.parse(subscription.endAt);
    document.querySelectorAll("[data-vip-live-rate]").forEach(element => {
      if (element.dataset.vipLiveRate === id) {
        const rate = Number(subscription.dailyMiningRatePoints || 0);
        element.textContent = `${formatNumber(ended ? 0 : rate, Number.isInteger(rate) ? 0 : 2)} UP/day`;
      }
    });
      document.querySelectorAll("[data-vip-live-days]").forEach(element => {
        if (element.dataset.vipLiveDays !== id) return;
        const endAt = Date.parse(subscription.endAt || "");
        const days = Number.isFinite(endAt) ? Math.max(0, Math.ceil((endAt - now) / 86400000)) : 0;
        element.textContent = `${formatPoints(days)}d`;
      });
      document.querySelectorAll("[data-vip-progress]").forEach(element => {
        if (element.dataset.vipProgress !== id) return;
        const progress = vipPlanProgressPercent(subscription, now);
        element.style.width = `${progress}%`;
        element.setAttribute("aria-valuenow", String(progress));
      });
    }
  document.querySelectorAll("[data-vip-claim-all]").forEach(button => {
    const readModelReady = !state.readModelStale && state.financialDataConfirmed && state.membershipDataConfirmed;
    button.disabled = !claimable || vipClaimAllBusy || vipClaimingIds.size > 0 || !readModelReady;
  });
  document.querySelectorAll("[data-vip-claim-label]").forEach(element => {
    element.textContent = vipClaimAllBusy ? t("vip_claim_all_progress", vipClaimAllProgress) : t("vip_claim_wallet");
  });
}

async function tickVipCountdowns() {
  if ((state.activeTab !== "profile" && state.activeTab !== "vip") || (state.activeTab === "profile" && profileView !== "vip")) return;
  updateVipLiveDashboard();
}

function startVipCountdown() {
  stopVipCountdown();
  if ((state.activeTab !== "profile" && state.activeTab !== "vip") || (state.activeTab === "profile" && profileView !== "vip")) return;
  void tickVipCountdowns();
  vipCountdownTimer = setInterval(tickVipCountdowns, 1000);
}

function vipLiveUnclaimed(subscription, now = Date.now() + Number(state.vipServerOffsetMs || 0)) {
  const base = Math.max(0, Number(subscription?.estimatedUnclaimedPoints ?? subscription?.unclaimedPoints) || 0);
  const sampleAt = Date.parse(subscription?.accrualAsOf || "") || Number(state.vipServerNowMs) || now;
  const endAt = Date.parse(subscription?.endAt || "");
  const rate = Math.max(0, Number(subscription?.dailyMiningRatePoints) || 0);
  const storageCapAt = vipStorageCapAt(subscription);
  const accrualUntil = Number.isFinite(endAt)
    ? Math.min(now, endAt, Number.isFinite(storageCapAt) ? storageCapAt : now)
    : Number.isFinite(storageCapAt) ? Math.min(now, storageCapAt) : now;
  const elapsedMs = Math.max(0, accrualUntil - sampleAt);
  let estimated = base + (rate * elapsedMs / 86400000);
  const isNewPolicy = subscription?.policyVersion === "v2_100d";
  if (!isNewPolicy && Number(subscription?.principalAtMaturityPoints) > 0
    && Number.isFinite(endAt) && now >= endAt && sampleAt < endAt) {
    estimated += Number(subscription.principalAtMaturityPoints);
  }
  const cap = Number(subscription?.unclaimedEstimateCapPoints);
  if (Number.isFinite(cap) && cap >= 0) estimated = Math.min(estimated, cap);
  return Math.max(0, estimated);
}

function vipStorageCapAt(subscription) {
  const explicitCap = Date.parse(subscription?.storageCapAt || "");
  if (Number.isFinite(explicitCap)) return explicitCap;
  const anchor = Date.parse(subscription?.lastClaimAt || subscription?.startAt || "");
  return Number.isFinite(anchor) ? anchor + 86400000 : NaN;
}

function vipStorageFull(subscription, now = Date.now() + Number(state.vipServerOffsetMs || 0)) {
  const endAt = Date.parse(subscription?.endAt || "");
  const capAt = vipStorageCapAt(subscription);
  return Boolean(subscription?.storageFull || Number.isFinite(capAt) && now >= capAt && (!Number.isFinite(endAt) || now < endAt));
}

function formatVipStorageTime(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function vipPlanProgressPercent(subscription, now = Date.now() + Number(state.vipServerOffsetMs || 0)) {
  const endAt = Date.parse(subscription?.endAt || "");
  if (!Number.isFinite(endAt)) return 0;
  const durationDays = Math.max(1, Number(subscription?.durationDays) || 0);
  const explicitStartAt = Date.parse(subscription?.startAt || "");
  const startAt = Number.isFinite(explicitStartAt) ? explicitStartAt : endAt - (durationDays * 86400000);
  const totalMs = Math.max(1, endAt - startAt);
  return Math.min(100, Math.max(0, Number((((now - startAt) / totalMs) * 100).toFixed(2))));
}

function renderProfileVip() {
  const plans = state.vipPlans || [];
  const subscriptions = state.vipSubscriptions || [];
  const activeSubscriptions = subscriptions.filter(subscription => subscription.status === "active");
  const expiredSubscriptions = subscriptions.filter(subscription => subscription.status !== "active");
  const now = Date.now() + Number(state.vipServerOffsetMs || 0);
  const liveSubscriptions = activeSubscriptions.filter(subscription => {
    const endAt = Date.parse(subscription.endAt || "");
    return Number.isFinite(endAt) && now < endAt;
  });
  const storageFull = liveSubscriptions.some(subscription => vipStorageFull(subscription, now));
  const storageCapAt = liveSubscriptions
    .map(subscription => vipStorageCapAt(subscription))
    .filter(Number.isFinite)
    .reduce((soonest, value) => Math.min(soonest, value), Infinity);
  const unclaimedVipPoints = activeSubscriptions.reduce((sum, subscription) => sum + vipLiveUnclaimed(subscription, now), 0);
  const getPlanCategory = planNumber => Number(planNumber) <= 3 ? "starter" : Number(planNumber) <= 7 ? "pro" : "ultimate";
  const visiblePlans = plans.filter(plan => getPlanCategory(plan.planNumber) === vipSelectedCategory);
  const themeByPlan = { 1: "bronze", 2: "silver", 3: "gold", 4: "neon", 5: "cyan", 6: "sapphire", 7: "emerald", 8: "ruby", 9: "emerald", 10: "ultimate" };
  const planIconMarkup = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2 4 14h6l-1 8 11-14h-7l1-6z"/></svg>';

  const planCards = visiblePlans.map(plan => {
    const available = plan.enabled === true && plan.comingSoon !== true;
    const canAfford = Number(state.points) >= Number(plan.pricePoints);
    const neededPoints = Math.max(0, Number(plan.pricePoints) - (Number(state.points) || 0));
    const planNumber = Number(plan.planNumber);
    const isOwned = subscriptions.some(subscription => Number(subscription.planNumber) === planNumber && subscription.status === "active");
    const theme = themeByPlan[planNumber] || "sapphire";
    const statusKey = plan.comingSoon ? "vip_status_coming_soon"
      : !available ? "vip_status_inactive"
        : isOwned ? "vip_status_owned"
          : planNumber === 3 ? "vip_badge_popular"
            : planNumber === 6 ? "vip_badge_recommended"
              : planNumber === 10 ? "vip_badge_best_value" : "";
    const statusClass = isOwned ? "vipPlanBadge--owned"
      : planNumber === 3 ? "vipPlanBadge--popular"
        : planNumber === 6 ? "vipPlanBadge--recommended"
          : planNumber === 10 ? "vipPlanBadge--best-value" : "vipPlanBadge--status";
    const buttonLabel = plan.comingSoon ? t("vip_status_coming_soon")
      : available ? (canAfford ? t("vip_activate") : t("vip_need_more_UP", { n: formatPoints(neededPoints) }))
        : t("vip_status_inactive");
    const totalRewardPoints = plan.totalRewardPoints || (Number(plan.pricePoints) * Number(plan.monthlyRewardPercent) / 100);
    const dailyAveragePoints = plan.dailyRewardAveragePoints || (Number(plan.pricePoints) * Number(plan.monthlyRewardPercent) / 100 / Number(plan.durationDays));
    const isNewVipPolicy = plan.policyVersion === "v2_100d";
    const dailyTotalPayoutPoints = Number(plan.dailyTotalPayoutPoints || 0);
    const totalReceivedPoints = Number(plan.totalReceivedPoints || 0);
    const planDailyMiningPoints = Number(plan.dailyMiningRatePoints ?? (isNewVipPolicy ? dailyTotalPayoutPoints : dailyAveragePoints));
    const isPurchasing = vipPurchasingPlanNumbers.has(planNumber);
    return `
      <article class="vipPlanCard vipPlanCard--${theme}">
        <div class="vipPlanAccent" aria-hidden="true"><span class="vipPlanMark">${planIconMarkup}</span></div>
        <div class="vipPlanBody">
          <div class="vipPlanTopline">
            <div class="vipPlanTitleLine"><span class="vipPlanTitle">${t("vip_plan_title", { n: formatPoints(plan.planNumber) })}</span><span class="vipPlanDuration">${formatPoints(plan.durationDays)}d</span>${statusKey ? `<span class="vipPlanBadge ${statusClass}">${t(statusKey)}</span>` : ""}</div>
          </div>
          <div class="vipPlanInlineMeta"><span>${formatPoints(plan.pricePoints)} ${t("vip_UP_unit")}</span><i aria-hidden="true">·</i><span>${t("vip_daily_total_label")}: ${formatNumber(planDailyMiningPoints, 2)} ${t("vip_UP_per_day")}</span><i aria-hidden="true">·</i><span>${t("vip_total_received_label")}: ${formatNumber(isNewVipPolicy ? totalReceivedPoints : totalRewardPoints, 2)} ${t("vip_UP_unit")}</span></div>
        </div>
        <button type="button" class="vipPlanButton ${available ? (canAfford ? "vipPlanButton--primary" : "vipPlanButton--insufficient") : "vipPlanButton--secondary"}" ${available && canAfford && !isPurchasing ? "" : "disabled"} onclick="purchaseVipPlan(${planNumber})"><span>${isPurchasing ? t("vip_buying") : buttonLabel}</span><i aria-hidden="true">↗</i></button>
      </article>`;
  }).join("");

  const activePlanRows = activeSubscriptions.map(subscription => {
    const id = escapeHTML(subscription.id);
    const ended = Number.isFinite(Date.parse(subscription.endAt || "")) && now >= Date.parse(subscription.endAt);
    const rate = ended ? 0 : Number(subscription.dailyMiningRatePoints || 0);
    const remainingDays = Math.max(0, Math.ceil((Date.parse(subscription.endAt) - now) / 86400000));
    const progress = vipPlanProgressPercent(subscription, now);
    return `
      <div class="vipHeroPlanItem">
        <div class="vipHeroPlanRow">
          <span class="vipHeroPlanName">${t("vip_plan_title", { n: formatPoints(subscription.planNumber) })}</span>
          <span class="vipHeroPlanMeta"><span data-vip-live-rate="${id}">${formatNumber(rate, Number.isInteger(rate) ? 0 : 2)} ${t("vip_points_per_day")}</span> · <span data-vip-live-days="${id}">${formatPoints(remainingDays)}d</span></span>
        </div>
        <div class="vipHeroPlanProgress" role="progressbar" aria-label="${t("vip_plan_title", { n: formatPoints(subscription.planNumber) })}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><span data-vip-progress="${id}" style="width:${progress}%"></span></div>
      </div>`;
  }).join("");

  const expiredRows = expiredSubscriptions.map(subscription => `
    <div class="vipPastPlanRow">
      <span>${t("vip_plan_title", { n: formatPoints(subscription.planNumber) })}</span>
      <small>${t(subscription.status === "cancelled" ? "vip_status_cancelled" : "vip_status_completed")}</small>
      <b>${formatPoints(subscription.claimedRewardPoints || 0)} ${t("vip_UP_unit")}</b>
    </div>`).join("");

  const liveCount = activeSubscriptions.filter(subscription => {
    const endAt = Date.parse(subscription.endAt || "");
    return Number.isFinite(endAt) && now < endAt;
  }).length;
  const claimableCount = activeSubscriptions.filter(subscription => vipLiveUnclaimed(subscription, now) >= 0.01).length;
  const hasLiveMining = liveCount > 0;

  return `
    <style>
      .vipRedesign{--vip-ink:#f7f7ff;--vip-muted:#a8aec2;--vip-line:rgba(255,255,255,.1);margin:0 -2px;padding:4px 0 26px;background:radial-gradient(circle at 85% 0%,var(--brand-accent-glow),transparent 34%),linear-gradient(180deg,rgba(7,12,24,.28),transparent 70%);color:var(--vip-ink)}
      .phase3MiningCard{margin:0 0 16px;padding:18px;border:1px solid rgba(56,189,248,.22);border-radius:22px;background:linear-gradient(145deg,rgba(14,34,62,.92),rgba(8,13,27,.92));box-shadow:0 14px 34px rgba(0,0,0,.2)}
      .phase3MiningTop,.phase3VaultMeta{display:flex;justify-content:space-between;gap:12px;align-items:center}.phase3MiningTop h3{margin:5px 0 0}.phase3MiningTop strong{color:#67e8f9}.phase3Vault{margin:16px 0}.phase3VaultBar{height:10px;background:rgba(255,255,255,.1);border-radius:999px;overflow:hidden}.phase3VaultBar span{display:block;height:100%;background:linear-gradient(90deg,#38bdf8,#a78bfa);border-radius:inherit;transition:width .4s}.phase3VaultMeta{margin-top:8px;font-size:12px;color:#a8aec2}.phase3VaultMeta b{color:#f8fafc}.phase3MiningActions{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.phase3MiningActions button{font-size:12px;padding:11px 7px}.phase3StarsShop{margin-top:18px}.phase3StarsShop h4{margin:0 0 10px}.phase3StarsGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.phase3StarsCard{display:flex;flex-direction:column;align-items:center;gap:4px;padding:12px 6px;border:1px solid rgba(255,255,255,.1);border-radius:16px;background:rgba(255,255,255,.05);color:inherit}.phase3StarsCard span{font-size:22px}.phase3StarsCard b{font-size:11px;text-align:center}.phase3StarsCard small{color:#fbbf24}@media(max-width:500px){.phase3MiningActions,.phase3StarsGrid{grid-template-columns:1fr}.phase3MiningActions button{width:100%}}
    </style>
    <div class="vipRedesign">
      <div class="sectionHeader">
        <button class="sectionMore" type="button" onclick="${state.activeTab === "vip" ? "navigate('home')" : "setProfileView('menu')"}">${t("referral_back")}</button>
        <h2 class="sectionTitle">${t("vip_title")}</h2><span></span>
      </div>
      <section class="vipHero vipMiningHero" aria-label="${t("vip_unclaimed_earnings")}">
        <div class="vipHeroTop">
          <img class="vipHeroLogo" src="/img/gramup-logo-new.png" alt="Gramup" width="42" height="42">
          <span class="vipStatusPill ${hasLiveMining && !storageFull ? "isActive" : "isInactive"}" data-vip-mining-status><i aria-hidden="true"></i><span data-vip-mining-status-label>${t(storageFull ? "vip_storage_full" : hasLiveMining ? "vip_mining_live" : activeSubscriptions.length ? "vip_settlement_ready" : "vip_status_inactive")}</span><b data-vip-active-count>${formatPoints(liveCount)}</b></span>
        </div>
        <div class="vipMinerVisual" aria-hidden="true"><span class="vipMinerOrbit"></span><span class="vipMinerCoin">◈</span><span class="vipMinerSpark vipMinerSpark--one">✦</span><span class="vipMinerSpark vipMinerSpark--two">·</span></div>
        <div class="vipBalanceValue"><strong data-vip-unclaimed-total>${formatNumber(unclaimedVipPoints, 3)}</strong><span>${t("vip_UP_unit")}</span></div>
        ${Number.isFinite(storageCapAt) ? `<div class="vipStorageCountdown${storageFull ? " isFull" : ""}" data-vip-storage-countdown role="timer" aria-live="off">
          <svg class="vipStorageCountdownSvg" viewBox="0 0 84 84" aria-hidden="true"><circle class="vipStorageCountdownTrack" cx="42" cy="42" r="36"></circle><circle class="vipStorageCountdownProgress" data-vip-storage-ring cx="42" cy="42" r="36" style="stroke-dasharray:226.1946710584651;stroke-dashoffset:${226.1946710584651 * (1 - Math.max(0, Math.min(1, Math.max(0, storageCapAt - now) / 86400000)))}"></circle></svg>
          <span data-vip-storage-countdown-text>${t("vip_storage_full_in", { time: formatVipStorageTime(Math.max(0, storageCapAt - now)) })}</span>
        </div>` : ""}
        <div class="vipHeroPlanList" aria-label="${t("vip_active_plans_heading")}">${activePlanRows || `<div class="vipHeroPlanEmpty">${t("vip_no_active_plans")}</div>`}</div>
        <button type="button" class="vipHeroButton vipHeroClaimButton" data-vip-claim-all ${!claimableCount || vipClaimAllBusy || vipClaimingIds.size ? "disabled" : ""} onclick="claimAllVipRewards()" aria-busy="${vipClaimAllBusy ? "true" : "false"}">
          <span class="vipClaimSpinner" aria-hidden="true"></span>
          <span data-vip-claim-label>${vipClaimAllBusy ? t("vip_claim_all_progress", vipClaimAllProgress) : t("vip_claim_wallet")}</span>
          <b><span data-vip-claim-total>${formatNumber(unclaimedVipPoints, 3)}</span> ${t("vip_UP_unit")}</b>
        </button>
        <div class="vipAccrualHint">${t("vip_live_estimate_note")}</div>
      </section>

      ${expiredRows ? `<details class="vipPastPlans"><summary>${t("vip_expired_title")} <b>${formatPoints(expiredSubscriptions.length)}</b></summary>${expiredRows}</details>` : ""}

      <section class="vipCatalog" aria-label="${t("vip_catalog_title")}">
        <div class="vipCatalogHeading"><h3>${t("vip_catalog_title")}</h3><p>${t("vip_intro")}</p><small>${t("vip_payout_breakdown_note")}</small></div>
        <div class="vipPlanTabs" role="tablist" aria-label="${t("vip_tier_tabs_label")}">
          <button type="button" class="vipTierTab" role="tab" aria-selected="${vipSelectedCategory === "starter"}" aria-controls="vipPlanGrid" onclick="setVipPlanCategory('starter')"><span>${t("vip_tier_starter")}</span></button>
          <button type="button" class="vipTierTab" role="tab" aria-selected="${vipSelectedCategory === "pro"}" aria-controls="vipPlanGrid" onclick="setVipPlanCategory('pro')"><span>${t("vip_tier_pro")}</span></button>
          <button type="button" class="vipTierTab" role="tab" aria-selected="${vipSelectedCategory === "ultimate"}" aria-controls="vipPlanGrid" onclick="setVipPlanCategory('ultimate')"><span>${t("vip_tier_ultimate")}</span></button>
        </div>
        <div class="vipPlanList" id="vipPlanGrid" role="tabpanel" aria-live="polite">${plans.length ? (planCards || `<div class="vipEmptyTier">${t("vip_category_empty")}</div>`) : `<div class="card"><div class="emptyDesc">${t("vip_empty_plans")}</div></div>`}</div>
      </section>
    </div>`;
}
function retryVipPlans() {
  state.vipDataLoaded = false;
  state.vipError = "";
  void (state.activeTab === "vip" ? renderVipTab() : renderProfile());
}
window.retryVipPlans = retryVipPlans;

function confirmVipPurchase(message) {
  if (tg && typeof tg.showConfirm === "function") {
    return new Promise(resolve => tg.showConfirm(message, resolve));
  }
  return Promise.resolve(window.confirm(message));
}

async function purchaseVipPlan(planNumber) {
  const plan = state.vipPlans.find(item => Number(item.planNumber) === Number(planNumber));
  if (!plan || plan.enabled !== true || plan.comingSoon === true) return;
  if (vipPurchasingPlanNumbers.has(Number(plan.planNumber))) return;
  if (Number(state.points) < Number(plan.pricePoints)) return toast(t("vip_balance", { n: formatPoints(state.points) }), "error");
  vipPurchasingPlanNumbers.add(Number(plan.planNumber));
  if ((state.activeTab === "profile" && profileView === "vip") || state.activeTab === "vip") {
    const content = $("#content");
    if (content) content.innerHTML = renderProfileVip();
  }
  const scope = `vip_purchase_${plan.planNumber}`;
  try {
    const confirmed = await confirmVipPurchase(t("vip_buy_confirm", { n: formatPoints(plan.planNumber), price: formatPoints(plan.pricePoints) }));
    if (!confirmed) return;
    const result = await api("/api/points/vip/purchase", {
      method: "POST",
      headers: { "Idempotency-Key": getPendingIdempotencyKey(scope) },
      body: { planNumber: Number(plan.planNumber) }
    });
    clearPendingIdempotencyKey(scope);
    state.points = Number(result.points) || state.points;
    updateHeader();
    state.vipDataLoaded = false;
    await loadVipPlans();
    await renderProfile();
    toast(t("vip_buy_success"), "success");
  } catch (error) {
    clearDefinitiveIdempotencyFailure(scope, error);
    toast(translateServerMessage(error.code, error.message), "error");
  } finally {
    vipPurchasingPlanNumbers.delete(Number(plan.planNumber));
    if ((state.activeTab === "profile" && profileView === "vip") || state.activeTab === "vip") await renderProfile();
  }
}
window.purchaseVipPlan = purchaseVipPlan;

async function claimVipReward(subscriptionId, options = {}) {
  if (!readModelActionAllowed()) return false;
  if (!subscriptionId || vipClaimingIds.has(subscriptionId) || (vipClaimAllBusy && !options.bulk)) return false;
  vipClaimingIds.add(subscriptionId);
  const scope = `vip_claim_${subscriptionId}`;
  if ((state.activeTab === "profile" && profileView === "vip") || state.activeTab === "vip") {
    const content = $("#content");
    if (content) content.innerHTML = renderProfileVip();
  }
  try {
    const result = await api(`/api/points/vip/${encodeURIComponent(subscriptionId)}/claim`, {
      method: "POST",
      headers: { "Idempotency-Key": getPendingIdempotencyKey(scope) },
      body: JSON.stringify({})
    });
    clearPendingIdempotencyKey(scope);
    state.points = Number(result.points) || state.points;
    updateHeader();
    state.vipDataLoaded = false;
    await loadVipPlans();
    if ((state.activeTab === "profile" && profileView === "vip") || state.activeTab === "vip") await renderProfile();
    if (!options.silent) toast(t("vip_claim_success", { n: formatNumber(result.totalPayoutPoints ?? result.rewardPoints, 2) }), "success");
    return true;
  } catch (error) {
    clearDefinitiveIdempotencyFailure(scope, error);
    if (!options.silent) toast(translateServerMessage(error.code, error.message), "error");
    state.vipDataLoaded = false;
    await loadVipPlans();
    if ((state.activeTab === "profile" && profileView === "vip") || state.activeTab === "vip") await renderProfile();
    return false;
  } finally {
    vipClaimingIds.delete(subscriptionId);
    if ((state.activeTab === "profile" && profileView === "vip") || state.activeTab === "vip") startVipCountdown();
  }
}
window.claimVipReward = claimVipReward;

async function claimAllVipRewards() {
  if (!readModelActionAllowed()) return;
  if (vipClaimAllBusy || vipClaimingIds.size) return;
  const hasClaimableRewards = (state.vipSubscriptions || [])
    .some(subscription => subscription.status === "active" && vipLiveUnclaimed(subscription) >= 0.01);
  if (!hasClaimableRewards) return;

  vipClaimAllBusy = true;
  vipClaimAllProgress = { done: 0, total: 1 };
  // Disable every rendered copy immediately, before the async request starts.
  // The backend remains idempotent, while this prevents rapid taps from
  // creating a second in-flight bulk request in the first place.
  document.querySelectorAll("[data-vip-claim-all]").forEach(button => {
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
  });
  const isVipView = () => (state.activeTab === "profile" && profileView === "vip") || state.activeTab === "vip";
  if (isVipView()) {
    const content = $("#content");
    if (content) content.innerHTML = renderProfileVip();
  }

  const scope = "vip_claim_all";
  try {
    const result = await api("/api/points/vip/claim-all", {
      method: "POST",
      headers: { "Idempotency-Key": getPendingIdempotencyKey(scope) },
      body: {}
    });
    clearPendingIdempotencyKey(scope);
    vipClaimAllProgress.done = 1;
    if (Array.isArray(result.subscriptions)) state.vipSubscriptions = result.subscriptions;
    const returnedPoints = Number(result.points);
    if (Number.isFinite(returnedPoints)) state.points = returnedPoints;
    updateHeader();
    updateVipLiveDashboard();
    toast(t("vip_claim_success", { n: formatNumber(result.totalPayoutPoints || 0, 2) }), "success");
  } catch (error) {
    clearDefinitiveIdempotencyFailure(scope, error);
    toast(translateServerMessage(error.code, error.message), "error");
  } finally {
    vipClaimAllBusy = false;
    vipClaimAllProgress = { done: 0, total: 0 };
    if (isVipView()) {
      state.vipDataLoaded = false;
      await loadVipPlans();
      await renderProfile();
      startVipCountdown();
    }
  }
}
window.claimAllVipRewards = claimAllVipRewards;

let profileRenderSequence = 0;
async function renderProfile() {
  const renderRequestId = ++profileRenderSequence;
  const isCurrentProfileRender = () => renderRequestId === profileRenderSequence
    && (state.activeTab === "profile" || (state.activeTab === "vip" && profileView === "vip"));
  const content = $("#content");
  if (profileView === "menu" && !state.referralDataLoaded && !state.referralLoading && !state.referralError) {
    void loadReferralData();
  }
  if (profileView !== "leaderboard" || leaderboardMode !== "weekly") stopWeeklyCompetitionCountdown();
  if (profileView !== "vip") stopVipCountdown();
  if (profileView === "leaderboard" && state.leaderboard.length === 0) {
    content.innerHTML = `<div class="loading" style="height:300px"></div>`;
    await loadLeaderboard();
    if (!isCurrentProfileRender()) return;
  }
  if (profileView === "leaderboard" && leaderboardMode === "weekly" && !state.weeklyLeaderboardMeta) {
    content.innerHTML = `<div class="loading" style="height:300px"></div>`;
    await loadWeeklyLeaderboard();
    if (!isCurrentProfileRender()) return;
  }
  if (profileView === "history" && historyList.length === 0 && !historyLoading) {
    content.innerHTML = `<div class="loading" style="height:300px"></div>`;
    await loadHistory(true);
    if (!isCurrentProfileRender()) return;
  }
  if (profileView === "vip" && !state.vipDataLoaded && !state.vipLoading) {
    content.innerHTML = `<div class="loading" style="height:300px"></div>`;
    await loadVipPlans();
    if (!isCurrentProfileRender()) return;
  }
  if (profileView === "referral") {
    content.innerHTML = renderProfileReferral();
    if (referralEntryTransitionPending && !state.referralLoading) {
      content.querySelector(".referralPage")?.classList.add("referralPageEntering");
      referralEntryTransitionPending = false;
    }
  } else if (profileView === "leaderboard") {
    content.innerHTML = renderProfileLeaderboard();
    if (leaderboardMode === "weekly") startWeeklyCompetitionCountdown();
  } else if (profileView === "about") {
    content.innerHTML = renderProfileAbout();
  } else if (profileView === "groups") {
    content.innerHTML = renderProfileGroups();
  } else if (profileView === "history") {
    content.innerHTML = renderProfileHistory();
  } else if (profileView === "vip") {
    content.innerHTML = state.vipError
      ? `<div class="card"><div class="emptyDesc">${escapeHTML(state.vipError)}</div><button type="button" class="secondary" onclick="retryVipPlans()">${t("vip_retry")}</button></div>`
      : renderProfileVip();
    startVipCountdown();
  } else {
    content.innerHTML = renderProfileMenu();
  }
}

async function renderVipTab() {
  const renderRequestId = navigationSequence;
  profileView = "vip";
  if (!state.vipDataLoaded && !state.vipLoading) {
    $("#content").innerHTML = `<div class="loading" style="height:300px"></div>`;
    await loadVipPlans();
  }
  if (renderRequestId !== navigationSequence || state.activeTab !== "vip") return;
  $("#content").innerHTML = state.vipError
    ? `<div class="card"><div class="emptyDesc">${escapeHTML(state.vipError)}</div><button type="button" class="secondary" onclick="retryVipPlans()">${t("vip_retry")}</button></div>`
    : renderProfileVip();
  startVipCountdown();
}

/* ================= TAB DISPATCH ================= */
async function renderCurrentTab(requestId = navigationSequence) {
  const tab = state.activeTab;
  const isCurrentRender = () => requestId === navigationSequence && state.activeTab === tab;
  showLoading();
  const cachedReadModelAvailable = state.readModelCacheHydrated && state.readModelStale;
  try {
    if (tab === "home") {
      if (cachedReadModelAvailable) {
        renderHome();
        void refreshReadModelInBackground();
      } else {
        await Promise.all([loadUserData(), loadTasks()]);
        if (!isCurrentRender()) return;
        renderHome();
      }
      void loadReferralData();
    } else if (tab === "tasks") {
      if (cachedReadModelAvailable) {
        renderTasks();
        void refreshReadModelInBackground();
      } else {
        await Promise.all([loadTasks(), loadUserData()]);
        if (!isCurrentRender()) return;
        renderTasks();
      }
      void loadReferralData();
    } else if (tab === "vip") {
      if (cachedReadModelAvailable) {
        const content = $("#content");
        if (content) content.innerHTML = renderProfileVip();
        startVipCountdown();
        void refreshReadModelInBackground();
      } else {
        await loadUserData();
        if (!isCurrentRender()) return;
        await renderVipTab();
      }
    } else if (tab === "wallet") {
      if (cachedReadModelAvailable) {
        renderWallet();
        void refreshReadModelInBackground();
      } else {
        await loadUserData();
        if (!isCurrentRender()) return;
        renderWallet();
      }
    } else if (tab === "profile") {
      profileView = pendingProfileView || "menu";
      pendingProfileView = null;
      if (cachedReadModelAvailable) {
        await renderProfile();
        void refreshReadModelInBackground();
      } else {
        await loadUserData();
        if (!isCurrentRender()) return;
        await renderProfile();
      }
      if (!isCurrentRender()) return;
      if (profileView === "referral") void loadReferralData();
    }
    updateReadModelFreshness();
  } catch (error) {
    if (!isCurrentRender()) return;
    console.error("Render tab failed:", error);
    if (state.gateActive) return; // صفحه‌ی عضویت اجباری باز است؛ خطا رویش نوشته نشود
    $("#content").innerHTML = `
      <div class="card emptyState">
        <div class="emptyIcon">⚠️</div>
        <div class="emptyTitle">${t("error_title")}</div>
        <div class="emptyDesc">${escapeHTML(error.message || t("error_generic"))}</div>
        <button class="secondaryBtn" style="margin-top:14px" onclick="renderCurrentTab()">${t("retry_button")}</button>
      </div>
    `;
  }
}

/* ================= BOOT ================= */
async function boot() {
  if (state.initialized) return;

  setupNavigation();
  updateNavigation();
  // قبل از احراز هویت و بررسی عضویت نیز باید کاربر وضعیت قابل‌مشاهده داشته باشد.
  showLoading();

  const telegramUser = getTelegramUser();
  if (telegramUser) state.user = telegramUser;

  if (!captchaPassed()) {
    updateHeader();
    showCaptcha();
    return;
  }

  await bootstrapAuth();
  applyStaticTranslations();
  if (typeof window.initGramupWalletConnect === "function") await window.initGramupWalletConnect();

  if (!termsAccepted()) {
    showTerms();
  } else {
    maybeShowOnboarding();
  }

  state.initialized = true;

  // Auth is verified, but membership/financial data are not yet confirmed.
  // Paint only the cached read model; all protected controls remain disabled.
  if (state.readModelCacheHydrated) {
    state.activeTab = "home";
    renderHome();
    updateReadModelFreshness();
  }

  // عضویت اجباری: هر بار که مینی‌اپ باز می‌شود، عضویت «فعلی» کاربر از تلگرام بررسی می‌شود
  const allowed = await enforceMembership();
  if (!allowed) return;

  await navigate("home");
  if (state.referralMessageConsent === "unset") showReferralMessageConsent(true);
}

document.addEventListener("DOMContentLoaded", () => {
  boot();
});
