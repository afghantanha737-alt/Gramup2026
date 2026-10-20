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
  points: 0,
  gramBalance: 0,
  rate: 0,
  streak: 0,
  canCheckIn: false,
  totalCheckins: 0,
  minWithdrawGram: 0,
  nextResetAt: 0,
  referralCode: "",
  shareLink: "",
  referralTelegramId: "",
  referralMiniAppConfigured: false,
  referralLevelRates: [],
  referralStats: null,
  referralTeam: [],
  referralLoading: false,
  referralDataLoaded: false,
  referralError: "",
  referralFilter: "all",
  invitedCount: 0,
  activeInvitedCount: 0,
  referralInitialRewardPoints: 10,
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
  captchaA: 0,
  captchaB: 0,
  initialized: false
};
window.state = state;
const latestPostOpenedTaskIds = new Set();
const latestPostOpenedAt = new Map();
const latestPostOpeningTaskIds = new Set();

/* ================= DOM HELPERS ================= */
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

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
    const err = new Error(response.status === 401 ? t('auth_error') : response.status === 403 ? t('auth_forbidden') : (data?.message || t("error_generic")));
    err.code = data?.code || (response.status === 401 ? 'AUTH_REQUIRED' : response.status === 403 ? 'AUTH_FORBIDDEN' : null);
    err.status = response.status;
    err.authFailure = authFailure;
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
      haptic("selection");
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
      if (state.gateActive) hideMembershipGate();
      return true;
    }
    showMembershipGate(data);
    return false;
  } catch (error) {
    // اگر نتوانستیم عضویت را بررسی کنیم، اجازه‌ی ورود نمی‌دهیم
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
});

/* ================= TERMS ================= */
function termsAccepted() {
  return localStorage.getItem("termsAccepted") === "1";
}
function showTerms() {
  const overlay = $("#termsOverlay");
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
  if (overlay) overlay.style.display = "flex";
}
window.showLanguageOverlay = showLanguageOverlay;

function hideLanguageOverlay() {
  const overlay = $("#languageOverlay");
  if (overlay) overlay.style.display = "none";
}
window.hideLanguageOverlay = hideLanguageOverlay;

async function selectLanguage(lang) {
  if (!["fa", "ps", "en"].includes(lang)) return;
  if (lang === state.language) { hideLanguageOverlay(); return; }

  try {
    await api("/api/auth/language", { method: "PATCH", body: { language: lang } });
  } catch (error) {
    console.warn("Failed to persist language:", error);
  }

  state.language = lang;
  localStorage.setItem("appLanguage", lang);
  hideLanguageOverlay();
  applyStaticTranslations();
  await renderCurrentTab();
}
window.selectLanguage = selectLanguage;

/* ================= DATA LOADERS ================= */
async function bootstrapAuth() {
  const params = new URLSearchParams(location.search);
  const ref = params.get("ref") || "";
  const url = ref ? `/api/auth/me?ref=${encodeURIComponent(ref)}` : "/api/auth/me";

  try {
    const data = await api(url);
    state.language = localStorage.getItem("appLanguage") || data.language || "fa";
    state.user = { ...(state.user || {}), id: data.telegramId, telegramId: data.telegramId };
    if (data.firstName) state.user.first_name = data.firstName;
  } catch (error) {
    console.warn("Bootstrap auth failed:", error);
    state.language = localStorage.getItem("appLanguage") || "fa";
  }
}

const CLIENT_DATA_TTL_MS = 15000;
let userDataRequestSequence = 0;
async function loadUserData({ force = false } = {}) {
  const requestId = ++userDataRequestSequence;
  if (!force && state.userDataLoadedAt && Date.now() - state.userDataLoadedAt < CLIENT_DATA_TTL_MS) return;
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
  state.totalEarnedPoints = Number(data?.totalEarnedPoints) || 0;
  state.level = data?.level || null;
  state.withdrawalProgress = Number(data?.withdrawalProgress) || 0;
  state.withdrawalRemainingGram = Number(data?.withdrawalRemainingGram) || 0;
  state.gramUsdPrice = Number(data?.gramUsdPrice) || 0;
  state.userDataLoadedAt = Date.now();
  if (data?.firstName) state.user = { ...(state.user || {}), first_name: data.firstName };
  updateHeader();
}

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
    state.invitedCount = Number(data?.invitedCount) || 0;
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
    if (state.activeTab === "profile" && profileView === "referral") renderProfile();
    else if (state.activeTab === "home") renderHome();
    else if (state.activeTab === "tasks") renderTasks();
  }
}

async function claimReferralTask(taskId) {
  const task = state.referralTasks.find(item => item.id === taskId);
  if (!task || task.status !== "claimable") return;

  const button = document.querySelector(`[data-referral-claim="${taskId}"]`);
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


let tasksRequestSequence = 0;
let tasksLoadError = null;
async function loadTasks({ force = false } = {}) {
  const requestId = ++tasksRequestSequence;
  if (!force && state.tasksLoadedAt && Date.now() - state.tasksLoadedAt < CLIENT_DATA_TTL_MS) return state.tasks;
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
            <span class="tbPill tbPillPurple">${t("tb_points_chip", { n: formatPoints(state.points) })}</span>
            <span class="tbPill tbPillOrange">${level.badge} ${escapeHTML(level.name)}</span>
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
    <section class="auroraDailyCard">
      <div class="auroraDailyIcon">🔥</div>
      <div class="auroraDailyCopy">
        <strong>${t("earn_daily_title")}</strong>
        <span>${state.canCheckIn ? t("earn_daily_sub_available") : t("earn_daily_sub_done")}</span>
      </div>
      <button class="auroraInlineBtn" type="button" onclick="${state.canCheckIn ? "doCheckIn()" : "navigate('tasks')"}">${state.canCheckIn ? t("checkin_button") : t("tasks_title")}</button>
    </section>

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
      <h2 class="tbSectionTitle">${t("tb_your_progress")} <span class="tbSpark">✨</span></h2>
      <button class="tbLink" type="button" onclick="navigate('profile')">${t("tb_view_all")} <span class="tbLinkArrow">→</span></button>
    </div>

    <div class="tbStats">
      <div class="tbStat">
        <div class="tbStatIcon tbIconMint"><svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="30" fill="#2f9bf0"/><path d="M20 24h24l6 8-18 20L14 32z" fill="#fff"/><path d="M32 30v10M27 35h10" stroke="#2f9bf0" stroke-width="3" stroke-linecap="round"/></svg></div>
        <div class="tbStatLabel tbColGreen">${t("tb_earned")}</div>
        <div class="tbStatValue">${formatPoints(state.totalEarnedPoints)}</div>
      </div>
      <div class="tbStat">
        <div class="tbStatIcon tbIconOrange"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2A6.5 6.5 0 0 1 21.5 20"/></svg></div>
        <div class="tbStatLabel tbColOrange">${t("tb_referrals")}</div>
        <div class="tbStatValue">${formatPoints(state.invitedCount)}</div>
      </div>
      <div class="tbStat">
        <div class="tbStatIcon tbIconPurple"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="3.5" width="14" height="17.5" rx="2.5"/><path d="M9 3.5h6v3H9z"/><path d="m9 13.5 2 2 4-4"/></svg></div>
        <div class="tbStatLabel tbColPurple">${t("tb_tasks")}</div>
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
            <span class="auroraPreviewTaskCopy"><strong>${escapeHTML(task.title)}</strong><small>+${formatPoints(task.reward)} ${t("points_unit")}</small></span>
            <span class="auroraPreviewStatus ${status === "approved" ? "done" : ""}">${status === "approved" ? "✓" : "→"}</span>
          </button>`;
        }).join("") || `<div class="auroraPreviewEmpty">${t("tasks_empty_desc")}</div>`}
      </div>
    </section>

  `;
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
  if (!url) return;
  if (tg?.openLink) tg.openLink(url);
  else window.open(url, "_blank");
}
window.openTaskLinkOnly = openTaskLinkOnly;

async function openLatestPostTask(url, taskId) {
  const id = String(taskId || "");
  if (!id || !url || latestPostOpeningTaskIds.has(id)) return;

  latestPostOpeningTaskIds.add(id);
  const button = document.querySelector(`[data-latest-post-open="${id}"]`);
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
  document.getElementById(`screenshot-file-${taskId}`)?.click();
}
window.chooseScreenshotFile = chooseScreenshotFile;

async function submitScreenshotTask(taskId, file, input) {
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

  const button = document.querySelector(`[data-upload-screenshot="${taskId}"]`);
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
  const button = document.querySelector(`[data-verify="${taskId}"]`);
  if (button) { button.disabled = true; button.textContent = t("task_action_verifying"); }

  try {
    const result = await api(`/api/tasks/${taskId}/claim`, { method: "POST" });
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
  const button = document.querySelector(`[data-latest-post-check="${taskId}"]`);
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
  const buttons = Array.from(document.querySelectorAll("[data-latest-post-cooldown], [data-latest-post-wait]"));
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
        button.textContent = button.dataset.latestPostWait === "true"
          ? t("task_latest_post_check_in", { time: formatCountdown(remaining) })
          : t("task_latest_post_available_in", { time: formatCountdown(remaining) });
        return;
      }
      const waitingForCheck = button.dataset.latestPostWait === "true";
      button.disabled = false;
      button.dataset.taskState = "AVAILABLE";
      button.textContent = waitingForCheck ? t("task_action_claim") : t("task_action_start");
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
    if (!document.querySelector("[data-latest-post-cooldown], [data-latest-post-wait]")) {
      clearInterval(latestPostCooldownTimer);
      latestPostCooldownTimer = null;
    }
  };
  tick();
  latestPostCooldownTimer = setInterval(tick, 1000);
}

const DAILY_CHECKIN_REWARDS = Object.freeze([5, 7, 9, 11, 13, 14, 15]);
function renderDailyCheckinCard() {
  const completedDays = state.streak === 7 ? 7 : Math.min(7, Math.max(0, state.streak));
  const nextDay = state.streak === 7 ? 1 : Math.min(7, completedDays + 1);
  const dayCells = DAILY_CHECKIN_REWARDS.map((reward, index) => {
    const day = index + 1;
    const completed = day <= completedDays;
    const current = state.canCheckIn && day === nextDay;
    return `<div class="dailyCheckDay ${completed ? "is-complete" : ""} ${current ? "is-current" : ""}">
      <span class="dailyCheckDayNumber">${completed ? "✓" : day}</span>
      <strong>${t("day_label", { n: day })}</strong>
      <small>+${formatPoints(reward)} ${t("points_unit")}</small>
    </div>`;
  }).join("");
  return `<section class="card dailyCheckCard" aria-labelledby="dailyCheckTitle">
    <div class="dailyCheckHeader"><div><span class="tasksOverline">${t("daily_title")}</span><h2 id="dailyCheckTitle">${t("daily_check_title")}</h2></div><span class="tbPill tbPillOrange tbPillSm">${formatPoints(completedDays)} / 7</span></div>
    <p class="dailyCheckSubtitle">${state.canCheckIn ? t("daily_check_available") : t("daily_check_completed")}</p>
    <div class="dailyCheckGrid">${dayCells}</div>
    <div class="dailyCheckFooter"><span>${t("daily_check_today_reward", { n: formatPoints(DAILY_CHECKIN_REWARDS[nextDay - 1]) })}</span><button id="checkinBtn" class="primaryBtn" type="button" ${state.canCheckIn ? "" : "disabled"} onclick="doCheckIn()">${state.canCheckIn ? t("checkin_button") : t("checkin_done_button")}</button></div>
  </section>`;
}
async function doCheckIn() {
  const button = document.querySelector("#checkinBtn");
  if (button) { button.disabled = true; button.textContent = t("checkin_processing"); }
  try {
    const result = await api("/api/points/checkin", { method: "POST" });
    state.points = Number(result.points) || state.points;
    state.streak = Number(result.streak) || state.streak;
    state.canCheckIn = false;
    state.totalCheckins += 1;
    state.nextResetAt = Number(result.nextResetAt) || state.nextResetAt;
    updateHeader();
    haptic("success");
    toast(`+${formatPoints(result.earned)} ${t("points_unit")} 🎉`, "success");
    renderTasks();
  } catch (error) {
    haptic("error");
    toast(translateServerMessage(error.code, error.message), "error");
    if (button) { button.disabled = false; button.textContent = t("checkin_button"); }
  }
}
window.doCheckIn = doCheckIn;
function renderTasks() {
  const content = $("#content");
  const taskSection = ["daily", "vip", "invite"].includes(state.taskSection) ? state.taskSection : "daily";
  const isInviteSection = taskSection === "invite";
  const visibleTasks = isInviteSection
    ? []
    : state.tasks.filter(task => taskSection === "vip" ? task.taskKind === "vip_activation" : task.taskKind !== "vip_activation");
  const referralHtml = isInviteSection ? renderReferralRewardTasks() : "";
  const dailyCheckinHtml = taskSection === "daily" ? renderDailyCheckinCard() : "";
  const taskErrorHtml = tasksLoadError ? `<div class="card" role="status"><div class="emptyDesc">${t("tasks_load_error")}</div><button class="secondaryBtn" type="button" onclick="retryTasks()">${t("retry_button")}</button></div>` : "";
  const sectionTabs = `
    <div class="taskCategoryTabs taskSectionTabs" role="tablist" aria-label="${escapeHTML(t("tasks_title"))}">
      <button type="button" role="tab" aria-selected="${taskSection === "daily"}" class="taskCategoryTab ${taskSection === "daily" ? "active" : ""}" onclick="setTaskSection('daily')">☀️ ${t("daily_title")}</button>
      <button type="button" role="tab" aria-selected="${taskSection === "vip"}" class="taskCategoryTab ${taskSection === "vip" ? "active" : ""}" onclick="setTaskSection('vip')">💎 ${t("vip_title")}</button>
      <button type="button" role="tab" aria-selected="${taskSection === "invite"}" class="taskCategoryTab ${taskSection === "invite" ? "active" : ""}" onclick="setTaskSection('invite')">👥 ${t("menu_referral")}</button>
    </div>`;

  if (!state.tasks.length && tasksLoadError && !isInviteSection) {
    content.innerHTML = `<div class="sectionHeader"><h2 class="sectionTitle">${t("tasks_title")}</h2></div>${sectionTabs}${taskErrorHtml}`;
    return;
  }
  const inviteHasContent = isInviteSection && state.referralTasks.length > 0;
  if ((!isInviteSection && visibleTasks.length === 0) || (isInviteSection && !inviteHasContent)) {
    clearInterval(latestPostCooldownTimer);
    latestPostCooldownTimer = null;
    content.innerHTML = `
      <div class="sectionHeader"><h2 class="sectionTitle">${t("tasks_title")}</h2></div>
      ${sectionTabs}
      ${dailyCheckinHtml}
      ${taskErrorHtml}
      ${referralHtml}
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
    `;
    return;
  }

  const doneCount = visibleTasks.filter(task => completionStatus(task._id) === "approved").length;
  const taskProgress = visibleTasks.length ? Math.round((doneCount / visibleTasks.length) * 100) : 0;

  content.innerHTML = `
    <section class="tasksOverview">
      <div class="tasksOverviewTop"><div><h1>${t("tasks_title")}</h1></div><strong>${taskProgress}%</strong></div>
      <div class="tasksProgressTrack"><i style="width:${taskProgress}%"></i></div>
      <div class="tasksOverviewMeta"><span>${formatPoints(doneCount)} / ${formatPoints(visibleTasks.length)} ${t("task_btn_done")}</span><span>${t("tb_points_chip", { n: formatPoints(state.points) })}</span></div>
    </section>
    ${sectionTabs}
    ${dailyCheckinHtml}
    ${taskErrorHtml}
    ${referralHtml}
    <div class="taskList">
      ${visibleTasks.map(task => {
        const status = completionStatus(task._id);
        const icon = taskIconMarkup(task);
        const safeUrl = safeTaskHttpUrl(task.url).replaceAll("'", "\\'");
        let actionHtml;

        if (task.taskKind === "vip_activation") {
          actionHtml = status === "approved"
            ? `<button class="taskAction done" disabled>${t("task_btn_done")}</button>`
            : `<button class="taskAction pending" disabled>🔒 VIP ${formatPoints(task.vipPlanNumber)}</button>`;
        } else if (task.verifyType === "latest_post") {
          const completion = completionRecord(task._id);
          const nextAvailableAt = completion?.nextAvailableAt ? new Date(completion.nextAvailableAt) : null;
          const remaining = nextAvailableAt && Number.isFinite(nextAvailableAt.getTime())
            ? nextAvailableAt.getTime() - (Date.now() + state.tasksServerOffsetMs)
            : 0;
          const latestPostUrlArgument = escapeHTML(JSON.stringify(safeTaskHttpUrl(task.url)).replaceAll("<", "\\u003c"));
          const openedAtMs = latestPostOpenedAt.get(String(task._id));
          const openWaitRemaining = openedAtMs ? openedAtMs + 10000 - (Date.now() + state.tasksServerOffsetMs) : 0;
          const waitingForCheck = latestPostOpenedTaskIds.has(String(task._id)) && openWaitRemaining <= 0;
          const openButton = !waitingForCheck && remaining <= 0 && safeUrl
            ? `<button class="taskAction" data-latest-post-open="${escapeHTML(task._id)}" style="background:var(--surface-3);color:var(--text)" onclick="openLatestPostTask(${latestPostUrlArgument}, '${escapeHTML(task._id)}')">${t("task_action_start")}</button>`
            : "";
          let actionButton = "";
          if (remaining > 0) {
            actionButton = `<button class="taskAction pending" data-task-state="COOLDOWN" data-latest-post-cooldown data-task-id="${escapeHTML(task._id)}" data-until="${escapeHTML(nextAvailableAt.toISOString())}" disabled>${t("task_latest_post_available_in", { time: formatCountdown(remaining) })}</button>`;
          } else if (waitingForCheck) {
            actionButton = `<button class="taskAction" data-task-state="WAITING_FOR_CHECK" data-latest-post-check="${escapeHTML(task._id)}" onclick="verifyLatestPostTask('${escapeHTML(task._id)}')">${t("task_action_claim")}</button>`;
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
              ${task.url ? `<button class="taskAction" style="background:var(--surface-3);color:var(--text)" onclick="openTaskLinkOnly('${safeUrl}')">${t("task_action_open")}</button>` : ""}
              <input class="hidden" id="screenshot-file-${task._id}" type="file" accept="image/jpeg,image/png,image/webp" onchange="submitScreenshotTask('${task._id}', this.files[0], this)">
              <button class="taskAction" data-upload-screenshot="${task._id}" onclick="chooseScreenshotFile('${task._id}')">📸 ${t("task_action_upload")}</button>
            </div>${rejectedNote}`;
        } else {
          actionHtml = `
            <div style="display:flex;flex-direction:column;gap:6px;align-items:stretch">
              ${task.url ? `<button class="taskAction" style="background:var(--surface-3);color:var(--text)" onclick="openTaskLinkOnly('${safeUrl}')">${t("task_action_open")}</button>` : ""}
              <button class="taskAction" data-verify="${task._id}" onclick="verifyTelegramTask('${task._id}')">${t("task_action_verify")}</button>
            </div>`;
        }

        const hint = status === "todo" || task.verifyType === "latest_post" ? taskHints[task._id] : null;

        return `
        <div class="taskItem" style="flex-wrap:wrap">
          <div class="taskIcon">${icon}</div>
          <div class="taskBody">
            <div class="taskTitle">${task.isSpecialOfDay ? `<span class="sponsoredTag">⭐ ${t("special_task_badge")}</span> ` : ""}${task.isSponsored ? `<span class="sponsoredTag">${t("task_sponsored_tag")}</span> ` : ""}${escapeHTML(task.title)}</div>
            ${task.description ? `<div class="taskDesc">${escapeHTML(task.description)}</div>` : ""}
            ${task.verifyType === "latest_post" ? `<div class="taskDesc">${t("task_latest_post_open_hint")}</div>` : ""}
            ${task.isSpecialOfDay && task.expiresAt ? `<div class="taskDesc" style="color:var(--warning)">⏳ ${t("special_task_deadline", { date: new Date(task.expiresAt).toLocaleString(state.language === "en" ? "en-US" : "fa-IR") })}</div>` : ""}
            <div class="taskReward">+${formatPoints(task.reward)} ${t("points_unit")}</div>
          </div>
          ${actionHtml}
          ${hint ? `<div class="taskHint ${hint.type}" style="flex-basis:100%">${escapeHTML(hint.message)}</div>` : ""}
        </div>`;
      }).join("")}
    </div>
  `;
  startLatestPostCooldownCountdown();
}

async function retryTasks() { await loadTasks({ force: true }); if (state.activeTab === "tasks") renderTasks(); else if (state.activeTab === "home") renderHome(); }
window.retryTasks = retryTasks;

/* ================= WALLET ================= */
function showWithdraw() {
  if (state.gramBalance < state.minWithdrawGram) {
    toast(t("wallet_min_withdraw_note", { n: formatNumber(state.minWithdrawGram, 6) }), "warning");
    return;
  }
  if (!window.gramupWallet?.isConnected()) {
    toast("ابتدا Wallet خود را متصل کنید.", "warning");
    void window.gramupWallet?.connect();
    return;
  }
  const overlay = $("#withdrawOverlay");
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
  if (!window.gramupWallet?.isConnected() || address.length < 6) {
    if (error) error.textContent = t("error_generic");
    return;
  }

  if (button) button.disabled = true;
  try {
    const result = await api("/api/points/withdraw", { method: "POST", headers: { "Idempotency-Key": getPendingIdempotencyKey("withdraw") }, body: { gram, address } });
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
  if (state.points <= 0 && state.gramBalance <= 0) {
    toast(t("error_generic"), "warning");
    return;
  }
  const overlay = $("#exchangeOverlay");
  const input = $("#exchangePoints");
  const error = $("#exchangeError");
  if (input) input.value = "";
  if (error) error.textContent = "";
  setExchangeDirection("points_to_gram");
  if (overlay) overlay.style.display = "flex";
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
    if (label) { label.dataset.i18n = "exchange_points_label"; label.textContent = t("exchange_points_label"); }
    if (input) { input.dataset.i18nPh = "exchange_points_ph"; input.setAttribute("placeholder", t("exchange_points_ph")); }
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
}
window.setExchangeDirection = setExchangeDirection;

function updateExchangePreview() {
  const input = $("#exchangePoints");
  const preview = $("#exchangePreview");
  if (!input || !preview) return;
  const amount = Number(input.value) || 0;

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
  const input = $("#exchangePoints");
  const error = $("#exchangeError");
  const button = $("#submitExchange");

  const amount = Number(input?.value);
  if (!amount || amount <= 0) {
    if (error) error.textContent = t("error_generic");
    return;
  }
  if (exchangeDirection === "points_to_gram" && amount > state.points) {
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
        : Promise.reject(Object.assign(new Error("Wallet connection is unavailable."), { code: "WALLET_PROOF_REQUIRED" })))
      : await api("/api/points/exchange", {
        method: "POST",
        headers: { "Idempotency-Key": getPendingIdempotencyKey(idempotencyScope) },
        body: { direction: exchangeDirection, amount }
      });
    if (exchangeDirection === "points_to_gram" || useInternalGramBalance) clearPendingIdempotencyKey(idempotencyScope);
    state.points = Number(result.points) ?? state.points;
    if (result.gramBalance != null) state.gramBalance = Number(result.gramBalance) ?? state.gramBalance;
    haptic("success");
    toast(result.message || `${result.pointsGained || 0} Point added after TON confirmation.`, "success");
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
  const overlay = $("#depositOverlay");
  const panel = $("#depositPanel");
  const disabled = $("#depositDisabledMessage");
  const message = $("#depositMessage");
  if (overlay) overlay.style.display = "flex";
  if (panel) panel.style.display = "none";
  if (disabled) disabled.style.display = "block";
  if (message) message.textContent = t("deposit_coming_soon");
  setDepositActionMessage("");
  void loadDepositPanel();
}
window.showDeposit = showDeposit;

async function loadDepositPanel() {
  if (depositPanelLoading) return;
  depositPanelLoading = true;
  const panel = $("#depositPanel");
  const disabled = $("#depositDisabledMessage");
  const message = $("#depositMessage");
  const button = $("#depositVerifyButton");
  try {
    const deposits = await refreshDepositHistory();
    const pending = deposits.find(item => item.status === "pending");
    const configData = await api("/api/points/deposit/config");
    currentDeposit = pending || null;
    if (!currentDeposit && configData?.enabled) {
      const created = await api("/api/points/deposits", { method: "POST", body: {} });
      currentDeposit = created?.deposit || null;
    }

    if (!currentDeposit) {
      if (panel) panel.style.display = "none";
      if (disabled) disabled.style.display = "block";
      if (message) message.textContent = t("deposit_coming_soon");
      return;
    }

    if (panel) panel.style.display = "block";
    if (disabled) disabled.style.display = "none";
    const address = $("#depositWalletAddress");
    const reference = $("#depositReference");
    const hash = $("#depositTxHash");
    const minimum = $("#depositMinimumText");
    if (address) address.value = currentDeposit.depositWalletAddress || configData?.depositWalletAddress || "";
    if (reference) reference.textContent = currentDeposit.reference || "";
    if (hash) hash.value = currentDeposit.txHash || currentDeposit.submittedTxHash || "";
    if (minimum) minimum.textContent = t("deposit_minimum", { amount: formatNumber(currentDeposit.minimumDepositGram ?? configData?.minimumDepositGram ?? 0, 9) });
    if (button) button.disabled = currentDeposit.status !== "pending";
    renderDepositHistory(deposits);
  } catch (error) {
    if (panel) panel.style.display = "none";
    if (disabled) disabled.style.display = "block";
    if (message) message.textContent = translateServerMessage(error.code, error.message);
  } finally {
    depositPanelLoading = false;
  }
}

async function submitGramDeposit() {
  const button = $("#depositVerifyButton");
  const input = $("#depositTxHash");
  const txHash = String(input?.value || "").trim();
  if (!currentDeposit?._id || currentDeposit.status !== "pending" || depositSubmissionBusy) return;
  if (!/^(?:0x)?(?:[a-f\d]{64}|[a-z\d+/_-]{43,44}={0,2})$/i.test(txHash)) {
    setDepositActionMessage(t("deposit_invalid_hash_message"), "error");
    return;
  }
  depositSubmissionBusy = true;
  if (button) button.disabled = true;
  setDepositActionMessage(t("history_loading"));
  try {
    const result = await api(`/api/points/deposits/${encodeURIComponent(currentDeposit._id)}/verify`, {
      method: "POST",
      body: { txHash }
    });
    currentDeposit = result.deposit || { ...currentDeposit, status: result.status, submittedTxHash: txHash };
    if (result.status === "confirmed") {
      const balance = Number(result.gramBalance);
      if (Number.isFinite(balance)) state.gramBalance = balance;
      setDepositActionMessage(t("deposit_confirmed_message", { amount: formatNumber(result.amount, 9) }), "success");
      toast(t("deposit_confirmed_message", { amount: formatNumber(result.amount, 9) }), "success");
      haptic("success");
      if (button) button.disabled = true;
      updateHeader();
      if (state.activeTab === "wallet") renderWallet();
      await refreshDepositHistory();
    } else {
      currentDeposit.submittedTxHash = txHash;
      setDepositActionMessage(t("deposit_pending_message"), "normal");
      haptic("warning");
      if (button) button.disabled = false;
      await refreshDepositHistory();
    }
  } catch (error) {
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
  value.textContent = t('wallet_chain_balance_loading');
  meta.textContent = 'TON Mainnet';
  try {
    const result = await api('/api/points/wallet/chain-balance');
    if (renderRequestId !== walletRenderSequence || state.activeTab !== 'wallet') return;
    value.textContent = `${formatNumber(result.balance, 6)} GRAM`;
    meta.textContent = t('wallet_chain_balance_title');
  } catch (error) {
    if (renderRequestId !== walletRenderSequence || state.activeTab !== 'wallet') return;
    value.textContent = t('wallet_chain_balance_unavailable');
    meta.textContent = error?.code === 'WALLET_NOT_CONNECTED' ? t('wallet_connected_withdraw_hint') : 'TON Mainnet';
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
      <div><span class="walletChainBalanceLabel">${t("wallet_chain_balance_title")}</span><strong id="walletChainBalanceValue">${t("wallet_chain_balance_loading")}</strong><small id="walletChainBalanceMeta">TON Mainnet</small></div>
      <button type="button" class="walletChainRefresh" onclick="refreshWalletChainBalance()">↻ ${t("wallet_chain_balance_refresh")}</button>
    </section>

    <div class="tbWalletGrid">
      <div class="tbWalletCard">
        <div class="tbWalletIcon tbIconOrange">${TB_ICONS.coin}</div>
        <div class="tbStatLabel tbColOrange">${t("wallet_points_card_title")}</div>
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
      <p style="font-size:11px;margin-bottom:0">${t("wallet_rate_label", { rate: formatNumber(state.rate, 6) })} • ${t("wallet_min_withdraw_note", { n: formatNumber(state.minWithdrawGram, 6) })}</p>
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
        <button type="button" class="historyItem historyItemBtn" onclick="openWithdrawalDetail('${item._id}')">
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

function closeWithdrawalDetail() {
  const el = document.getElementById("withdrawalDetailOverlay");
  if (el) el.style.display = "none";
}
window.closeWithdrawalDetail = closeWithdrawalDetail;

async function openWithdrawalDetail(id) {
  const el = ensureWithdrawalDetailOverlay();
  el.style.display = "flex";
  el.innerHTML = `<div class="modalBox withdrawBox" role="dialog" aria-modal="true"><div class="loading" style="height:120px"></div></div>`;

  try {
    const data = await api(`/api/points/withdrawals/${id}`);
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

let profileView = "menu"; // menu | referral | leaderboard | about | history
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
          <span class="tbPill tbPillPurple tbPillSm">${t("tb_points_chip", { n: formatPoints(state.points) })}</span>
          <span class="tbPill tbPillOrange tbPillSm">${formatPoints(state.invitedCount)} ${t("tb_referrals")}</span>
          <span class="tbPill tbPillGreen tbPillSm">${level.badge} ${escapeHTML(level.name)}</span>
        </div>
      </div>
      <div class="profileBalanceMini"><span>${t("tb_total_balance")}</span><strong>${formatNumber(state.gramBalance, 3)} <small>GRAM</small></strong></div>
    </section>

    <section class="profilePulseGrid" aria-label="${escapeHTML(t("tb_your_progress"))}">
      <div><strong>${formatPoints(state.points)}</strong><span>${t("wallet_points_card_title")}</span></div>
      <div><strong>${formatNumber(state.invitedCount)}</strong><span>${t("referral_kpi_direct")}</span></div>
      <div><strong>${formatPoints(state.totalEarnedPoints)}</strong><span>${t("tb_earned")}</span></div>
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
      action = `<button class="taskAction" type="button" data-referral-claim="${escapeHTML(task.id)}" onclick="claimReferralTask('${escapeHTML(task.id)}')">${t("referral_claim_button")}</button>`;
    }

    return `
      <div class="taskItem referralTaskItem" style="margin-bottom:12px">
        <div class="taskIcon">👥</div>
        <div class="taskBody">
          <div class="taskTitle">${t("referral_task_invite", { n: formatPoints(task.requiredInvites) })}</div>
          <div class="taskDesc" style="display:flex;align-items:center;gap:9px">
            <span>${formatPoints(task.requiredInvites)}</span>
            <span style="display:inline-block;width:18px;height:1px;background:var(--text-muted);opacity:.7"></span>
            <span>${formatPoints(task.invitedCount)} ${t("referral_active_label")}</span>
          </div>
          <div class="taskReward">+${formatPoints(task.rewardPoints)} ${t("points_unit")}</div>
          <div style="height:6px;background:var(--surface-3);border-radius:999px;overflow:hidden;margin-top:8px">
            <div style="height:100%;width:${progress}%;background:linear-gradient(90deg,var(--primary),var(--primary-2));border-radius:999px;transition:width .3s ease"></div>
          </div>
        </div>
        ${action}
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
        <div class="card" style="margin:0;padding:12px;background:var(--surface-2)"><div class="cardSubtitle">${t("referral_total_invite_rewards")}</div><div style="font-size:17px;font-weight:850;margin-top:5px">${formatPoints(Number(stats.totalInviteRewardsPoints) || 0)} ${t("points_unit")}</div></div>
        <div class="card" style="margin:0;padding:12px;background:var(--surface-2)"><div class="cardSubtitle">${t("referral_total_team_commission")}</div><div style="font-size:17px;font-weight:850;margin-top:5px">${formatPoints(Number(stats.totalTeamCommissionPoints) || 0)} ${t("points_unit")}</div></div>
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
      { key: "1", label: t("referral_level_label", { n: 1 }), min: 1, max: 1, rate: 10 },
    { key: "2", label: t("referral_level_label", { n: 2 }), min: 2, max: 2, rate: 5 },
    { key: "3", label: t("referral_level_label", { n: 3 }), min: 3, max: 3, rate: 3 },
    { key: "4plus", label: t("referral_level_4_plus"), min: 4, max: 4, rate: 2 }
  ].map(bucket => {
    const rows = rawNetwork.filter(row => Number(row.level) >= bucket.min && Number(row.level) <= bucket.max);
    return {
      ...bucket,
      members: rows.reduce((sum, row) => sum + (Number(row.members) || 0), 0),
      active: rows.reduce((sum, row) => sum + (Number(row.activeMembers) || 0), 0),
      earned: rows.reduce((sum, row) => sum + (Number(row.commissionPoints) || 0), 0),
      rate: bucket.key === "4plus" ? 2 : Number(configuredRates[bucket.min - 1]) || bucket.rate
    };
  });
  const maxMembers = Math.max(1, ...buckets.map(row => row.members));
  const levelCards = buckets.map((row, index) => `
    <article class="rf-level-card rf-level-${Math.min(index + 1, 4)}">
      <div class="rf-level-top"><span>${escapeHTML(row.label)}</span><strong>${formatNumber(row.rate)}%</strong></div>
      <small class="rf-level-desc">${t(`referral_level_relationship_${row.key}`)}</small>
      <div class="rf-level-bar"><i style="width:${Math.min(100, row.members / maxMembers * 100)}%"></i></div>
      <div class="rf-level-foot"><span>${formatNumber(row.active)} / ${formatNumber(row.members)} ${t("referral_active_short")}</span><b>+${formatPoints(row.earned)}</b></div>
    </article>`).join("");

  const history = (Array.isArray(state.referralHistory) ? state.referralHistory : []).slice(0, 20);
  const historyRows = history.map(item => {
    const kindKey = item.kind === "commission" ? "referral_history_commission"
      : item.kind === "milestone" ? "referral_history_milestone"
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
        <b class="rf-history-points">+${formatPoints(Number(item.points) || 0)}<small>${t("points_unit")}</small></b>
      </li>`;
  }).join("");
  const currentLevelLabel = currentLevel > 0 ? t("referral_level_label", { n: formatPoints(currentLevel) }) : "—";
  const rewardPoints = 10;

  return `
    <div class="referralPage referralDashboard">
      ${header}

      <section class="rf-hero" aria-labelledby="rfHeroTitle">
        <div class="rf-hero-orbit" aria-hidden="true"></div>
        <div class="rf-hero-top"><span class="rf-overline">${t("referral_hero_eyebrow")}</span><span class="rf-hero-badge">${t("referral_reward_direct_badge", { n: formatPoints(rewardPoints) })}</span></div>
        <h2 class="rf-hero-title" id="rfHeroTitle">${t("referral_total_earnings_title")}</h2>
        <div class="rf-hero-total"><span class="rf-hero-coin" aria-hidden="true">◇</span><strong>${formatPoints(totalEarnings)}</strong><span>${t("points_unit")}</span></div>
        <div class="rf-hero-bottom"><span>${t("referral_this_month")}</span><strong>+${formatPoints(monthlyEarnings)} ${t("points_unit")}</strong></div>
      </section>

      <section class="rf-kpi-grid" aria-label="${escapeHTML(t("referral_stats_title"))}">
        <article class="rf-kpi"><span class="rf-kpi-icon">♙</span><strong>${formatNumber(directCount)}</strong><small>${t("referral_kpi_direct")}</small></article>
        <article class="rf-kpi rf-kpi-active"><span class="rf-kpi-icon">●</span><strong>${formatNumber(activeCount)}</strong><small>${t("referral_kpi_active")}</small></article>
        <article class="rf-kpi"><span class="rf-kpi-icon">⌘</span><strong>${formatNumber(networkSize)}</strong><small>${t("referral_kpi_network")}</small></article>
        <article class="rf-kpi rf-kpi-level"><span class="rf-kpi-icon">✧</span><strong>${escapeHTML(currentLevelLabel)}</strong><small>${t("referral_kpi_level")}</small></article>
      </section>

      <section class="rf-panel rf-link-panel" aria-labelledby="rfLinkTitle">
        <div class="rf-panel-heading"><span class="rf-panel-symbol">↗</span><div><span class="rf-overline">${t("referral_link_eyebrow")}</span><h2 id="rfLinkTitle">${t("referral_link_title_new")}</h2></div></div>
        <div class="rf-link-box" dir="ltr"><span aria-hidden="true">⌁</span><b title="${escapeHTML(state.shareLink || "")}">${escapeHTML(state.shareLink || "—")}</b></div>
        <div class="referralLinkActions rf-link-actions">
          <button type="button" class="referralCopyBtn" onclick="copyReferralLink()" ${state.shareLink ? "" : "disabled"}>▢ ${t("referral_copy_button")}</button>
          <button type="button" class="referralShareBtn" onclick="shareReferralLink()" ${state.shareLink ? "" : "disabled"}>↗ ${t("referral_share_button")}</button>
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
          <li><span>02</span><p>${t("referral_how_step_2", { n: formatPoints(rewardPoints) })}</p></li>
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
        ${weekly ? `<div class="cardSubtitle">${formatPoints(state.weeklyMyPoints)} ${t("points_unit")}</div>` : ""}
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
    const unit = item.currency === "gram" ? "GRAM" : t("points_unit");
    const amountText = isPendingDeposit
      ? t("deposit_pending_amount")
      : `${isPositive ? "+" : ""}${item.currency === "gram" ? formatNumber(item.amount, 9) : formatPoints(item.amount)} ${unit}`;
    const icon = (LEDGER_TYPE_UI[item.type] || {}).icon || "🔸";
    const desc = item.description || t(`history_type_${item.type}`);
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
    state.vipDataLoaded = true;
    return true;
  } catch (error) {
    console.warn("VIP plans failed:", error);
    state.vipError = translateServerMessage(error.code, error.message) || t("vip_error");
    state.vipDataLoaded = false;
    return false;
  } finally {
    state.vipLoading = false;
  }
}

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

function stopVipCountdown() {
  if (vipCountdownTimer) clearInterval(vipCountdownTimer);
  vipCountdownTimer = null;
  vipCountdownRefreshPending = false;
}

async function tickVipCountdowns() {
  if ((state.activeTab !== "profile" && state.activeTab !== "vip") || (state.activeTab === "profile" && profileView !== "vip")) return;
  let shouldRefresh = false;
  document.querySelectorAll("[data-vip-countdown]").forEach(element => {
    const target = Date.parse(element.dataset.vipCountdown || "");
    if (!Number.isFinite(target)) return;
    const remaining = target - (Date.now() + Number(state.vipServerOffsetMs || 0));
    if (remaining <= 0) {
      element.textContent = "00:00:00";
      shouldRefresh = true;
    } else {
      element.textContent = formatVipCountdown(remaining);
    }
  });
  if (!shouldRefresh || vipCountdownRefreshPending) return;
  vipCountdownRefreshPending = true;
  const loaded = await loadVipPlans();
  vipCountdownRefreshPending = false;
  if (loaded && ((state.activeTab === "profile" && profileView === "vip") || state.activeTab === "vip")) {
    const content = $("#content");
    if (content) content.innerHTML = renderProfileVip();
    startVipCountdown();
  }
}

function startVipCountdown() {
  stopVipCountdown();
  if ((state.activeTab !== "profile" && state.activeTab !== "vip") || (state.activeTab === "profile" && profileView !== "vip")) return;
  void tickVipCountdowns();
  vipCountdownTimer = setInterval(tickVipCountdowns, 1000);
}

function renderProfileVip() {
  const plans = state.vipPlans || [];
  const subscriptions = state.vipSubscriptions || [];
  const planCards = plans.map(plan => {
    const available = plan.enabled === true && plan.comingSoon !== true;
    const statusKey = plan.comingSoon ? "vip_status_coming_soon" : available ? "vip_status_active" : "vip_status_inactive";
    const canAfford = Number(state.points) >= Number(plan.pricePoints);
    const buttonLabel = plan.comingSoon ? t("vip_status_coming_soon") : available ? (canAfford ? t("vip_buy") : t("vip_insufficient_points")) : t("vip_status_inactive");
    const planNumber = Number(plan.planNumber);
    const theme = planNumber === 1 ? "bronze" : planNumber === 2 ? "silver" : planNumber === 3 ? "gold" : "future";
    return `
      <article class="vipPlanCard vipPlanCard--${theme}">
        <div class="vipPlanGlow" aria-hidden="true"></div>
        <div class="vipPlanTopline">
          <div class="vipPlanTitleWrap"><span class="vipPlanMark" aria-hidden="true">${theme === "bronze" ? "◈" : theme === "silver" ? "✦" : theme === "gold" ? "♛" : "◇"}</span><div class="vipPlanTitle">${t("vip_plan_title", { n: formatPoints(plan.planNumber) })}</div></div>
          <span class="badge ${available ? "success" : "info"}">${t(statusKey)}</span>
        </div>
        ${`
          <div class="vipPlanStats">
            <div class="vipPlanStat"><span>${t("vip_price", { n: formatPoints(plan.pricePoints) })}</span><b>${formatPoints(plan.pricePoints)}</b></div>
            <div class="vipPlanStat"><span>${t("vip_rate", { n: formatNumber(plan.monthlyRewardPercent, 2) })}</span><b>${formatNumber(plan.monthlyRewardPercent, 2)}%</b></div>
            <div class="vipPlanStat"><span>${t("vip_duration", { n: formatPoints(plan.durationDays) })}</span><b>${formatPoints(plan.durationDays)}</b></div>
          </div>
          <div class="vipPlanReward"><span>${t("vip_total_reward", { n: formatPoints(plan.totalRewardPoints || (Number(plan.pricePoints) * Number(plan.monthlyRewardPercent) / 100)) })}</span><b>${formatPoints(plan.totalRewardPoints || (Number(plan.pricePoints) * Number(plan.monthlyRewardPercent) / 100))}</b></div>
          <div class="vipPlanDaily">${t("vip_daily_average", { n: formatPoints(plan.dailyRewardAveragePoints || (Number(plan.pricePoints) * Number(plan.monthlyRewardPercent) / 100 / Number(plan.durationDays))) })}</div>`}
        <button type="button" class="vipPlanButton ${available ? "vipPlanButton--primary" : "vipPlanButton--secondary"}" ${available && canAfford && !vipPurchasingPlanNumbers.has(Number(plan.planNumber)) ? "" : "disabled"} onclick="purchaseVipPlan(${Number(plan.planNumber)})">${vipPurchasingPlanNumbers.has(Number(plan.planNumber)) ? t("vip_buying") : buttonLabel}</button>
        ${available && !canAfford ? `<div class="vipPlanBalance">${t("vip_balance", { n: formatPoints(state.points) })}</div>` : ""}
      </article>`;
  }).join("");

  const subscriptionCards = subscriptions.map(subscription => {
    const isActive = subscription.status === "active";
    const isCancelled = subscription.status === "cancelled";
    const statusText = isActive ? t("vip_status_active") : isCancelled ? t("vip_status_cancelled") : t("vip_status_completed");
    const nextReward = formatPoints(subscription.nextRewardPoints || 0);
    let claimMarkup = "";
    if (isActive && subscription.canClaim) {
      const claiming = vipClaimingIds.has(subscription.id);
      claimMarkup = `<button type="button" class="primary" ${claiming ? "disabled" : ""} onclick="claimVipReward('${escapeHTML(subscription.id)}')">${claiming ? t("vip_loading") : t("vip_claim_button", { n: nextReward })}</button>`;
    } else if (isActive && subscription.nextClaimAt) {
      const claimTime = Date.parse(subscription.nextClaimAt);
      const serverNow = Date.now() + Number(state.vipServerOffsetMs || 0);
      const hasClaimed = Number(subscription.claimsCompleted) > 0;
      const label = hasClaimed ? `<div class="cardSubtitle">${t("vip_claimed_today")}</div>` : "";
      claimMarkup = `${label}${claimTime > serverNow ? `<div class="cardSubtitle">${t("vip_claim_next", { time: `<span data-vip-countdown="${escapeHTML(subscription.nextClaimAt)}">${formatVipCountdown(claimTime - serverNow)}</span>` })}</div>` : ""}`;
    }
    return `
      <article class="vipSubscriptionCard">
        <div class="vipPlanTopline"><div class="vipPlanTitleWrap"><span class="vipPlanMark" aria-hidden="true">◌</span><div class="vipPlanTitle">${t("vip_plan_title", { n: formatPoints(subscription.planNumber) })}</div></div><span class="badge ${isActive ? "success" : "info"}">${statusText}</span></div>
        <div class="vipSubscriptionGrid">
          <div>${t("vip_days_progress", { done: formatPoints(subscription.daysCompleted), total: formatPoints(subscription.durationDays) })}</div>
          <div>${t("vip_days_remaining", { n: formatPoints(subscription.daysRemaining) })}</div>
          <div>${t("vip_claim_progress", { claimed: formatPoints(subscription.claimsCompleted), total: formatPoints(subscription.totalClaims) })}</div>
          ${isActive ? `<div>${t("vip_todays_reward", { n: nextReward })}</div>` : ""}
          <div>${t("vip_total_earned", { n: formatPoints(subscription.claimedRewardPoints) })}</div>
          <div>${t("vip_total_reward", { n: formatPoints(subscription.totalRewardPoints) })}</div>
          ${isActive ? `<div>${t("vip_principal_note", { n: formatPoints(subscription.pricePoints) })}</div>` : isCancelled ? "" : `<div>${t("vip_status_completed")}</div>`}
        </div>
        ${claimMarkup}
      </article>`;
  }).join("");

  return `
    <style>
      .vipRedesign{--vip-ink:#f7f5ff;--vip-muted:#a8a5b8;--vip-line:rgba(255,255,255,.1);margin:0 -2px;padding:4px 0 24px;background:radial-gradient(circle at 86% 0%,rgba(124,58,237,.2),transparent 35%),linear-gradient(180deg,rgba(11,8,22,.24),transparent 70%);color:var(--vip-ink)}
      .vipRedesign .sectionHeader{margin-bottom:14px}.vipRedesign .sectionTitle{letter-spacing:-.2px}.vipRedesign .sectionMore{color:#c4b5fd}
      .vipHero{padding:18px;border:1px solid rgba(167,139,250,.2);border-radius:24px;background:linear-gradient(145deg,rgba(76,29,149,.28),rgba(16,13,29,.84));box-shadow:0 18px 42px rgba(30,16,70,.25);margin-bottom:18px}.vipHero .cardSubtitle{color:var(--vip-muted);line-height:1.8}
      .vipPlanCard,.vipSubscriptionCard{position:relative;isolation:isolate;overflow:hidden;margin:12px 0;padding:17px;border:1px solid var(--vip-line);border-radius:24px;background:linear-gradient(145deg,rgba(255,255,255,.09),rgba(17,15,28,.9) 58%);box-shadow:0 15px 35px rgba(0,0,0,.22)}.vipPlanGlow{position:absolute;z-index:-1;width:160px;height:160px;right:-75px;top:-90px;border-radius:50%;filter:blur(3px);opacity:.7}.vipPlanCard--bronze{border-color:rgba(205,127,50,.38)}.vipPlanCard--bronze .vipPlanGlow{background:rgba(180,83,9,.35)}.vipPlanCard--silver{border-color:rgba(203,213,225,.35)}.vipPlanCard--silver .vipPlanGlow{background:rgba(148,163,184,.28)}.vipPlanCard--gold{border-color:rgba(250,204,21,.45);background:linear-gradient(145deg,rgba(120,72,12,.25),rgba(25,19,24,.92) 62%)}.vipPlanCard--gold .vipPlanGlow{background:rgba(234,179,8,.4)}.vipPlanCard--future{opacity:.9}
      .vipPlanTopline{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:16px}.vipPlanTitleWrap{display:flex;align-items:center;gap:9px;min-width:0}.vipPlanMark{display:grid;place-items:center;width:34px;height:34px;flex:0 0 34px;border-radius:12px;color:#e9d5ff;background:rgba(139,92,246,.18);font-size:20px}.vipPlanCard--bronze .vipPlanMark{color:#fdba74;background:rgba(180,83,9,.2)}.vipPlanCard--silver .vipPlanMark{color:#e2e8f0;background:rgba(148,163,184,.2)}.vipPlanCard--gold .vipPlanMark{color:#fde68a;background:rgba(234,179,8,.2)}.vipPlanTitle{font-size:16px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.vipPlanCard .badge,.vipSubscriptionCard .badge{flex:0 0 auto}
      .vipPlanStats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:10px}.vipPlanStat{min-width:0;padding:10px 8px;border:1px solid rgba(255,255,255,.07);border-radius:15px;background:rgba(0,0,0,.16);text-align:center}.vipPlanStat span{display:block;min-height:28px;color:var(--vip-muted);font-size:9px;line-height:1.5}.vipPlanStat b{display:block;margin-top:3px;font-size:13px;color:#fff;direction:ltr}.vipPlanReward{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:11px 12px;border-radius:15px;background:rgba(139,92,246,.11);color:var(--vip-muted);font-size:10px}.vipPlanReward b{color:#ddd6fe;font-size:14px}.vipPlanDaily,.vipPlanBalance{margin-top:9px;color:var(--vip-muted);font-size:10px}.vipPlanButton{width:100%;min-height:44px;margin-top:14px;padding:11px 14px;border-radius:14px;font-size:12px;font-weight:900;transition:transform .18s ease,box-shadow .18s ease,opacity .18s ease}.vipPlanButton:active{transform:scale(.98)}.vipPlanButton--primary{color:#fff;background:linear-gradient(135deg,#a78bfa,#7c3aed);box-shadow:0 9px 22px rgba(124,58,237,.28)}.vipPlanButton--secondary{color:#c4b5fd;background:rgba(139,92,246,.1);border:1px solid rgba(167,139,250,.25)}.vipPlanButton:disabled{opacity:.48;box-shadow:none}.vipSubscriptionGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.vipSubscriptionGrid>div{padding:9px;border-radius:12px;background:rgba(0,0,0,.14);color:var(--vip-muted);font-size:10px;line-height:1.6}.vipSubscriptionCard button{width:100%;margin-top:12px}
      @media (max-width:420px){.vipPlanCard,.vipSubscriptionCard{padding:14px;border-radius:20px}.vipPlanStats{gap:5px}.vipPlanStat{padding:8px 4px}.vipPlanStat span{font-size:8px}.vipPlanStat b{font-size:12px}.vipPlanTitle{font-size:14px}.vipPlanTopline{gap:6px}.vipSubscriptionGrid{gap:6px}}
    </style>
    <div class="vipRedesign">
    <div class="sectionHeader">
      <button class="sectionMore" type="button" onclick="${state.activeTab === "vip" ? "navigate('home')" : "setProfileView('menu')"}">${t("referral_back")}</button>
      <h2 class="sectionTitle">${t("vip_title")}</h2><span></span>
    </div>
    <div class="vipHero vipHeroReference">
      <div class="vipHeroBrand"><img src="img/gramup-logo-new.jpg" alt="Gramup"><div><strong>Gram<span>up</span></strong><small>${state.user?.id ? `ID ${escapeHTML(state.user.id)}` : t("vip_title")}</small></div></div>
      <div class="vipHeroRows"><div><span>${t("vip_current_balance")}</span><b>${formatPoints(state.points)} Points</b></div><div><span>${t("vip_daily_reward_summary")}</span><b>${formatPoints(subscriptions.reduce((sum, item) => sum + (Number(item.nextRewardPoints) || 0), 0))} Points</b></div></div>
      <button type="button" class="vipHeroButton" onclick="document.querySelector('.vipPlanCard')?.scrollIntoView({behavior:'smooth',block:'start'})">${t("vip_buy")}</button>
    </div>
    ${subscriptions.length ? `<h3 class="sectionTitle" style="margin:16px 4px 8px">${t("vip_active_title")}</h3>${subscriptionCards}` : `<div class="card"><div class="emptyDesc">${t("vip_no_subscriptions")}</div></div>`}
    <h3 class="sectionTitle" style="margin:18px 4px 8px">${t("vip_title")}</h3>
    ${planCards || `<div class="card"><div class="emptyDesc">${t("vip_empty_plans")}</div></div>`}
    </div>
  `;
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

async function claimVipReward(subscriptionId) {
  if (!subscriptionId || vipClaimingIds.has(subscriptionId)) return;
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
    toast(t("vip_claim_success", { n: formatPoints(result.rewardPoints) }), "success");
  } catch (error) {
    clearDefinitiveIdempotencyFailure(scope, error);
    toast(translateServerMessage(error.code, error.message), "error");
    state.vipDataLoaded = false;
    await loadVipPlans();
    if ((state.activeTab === "profile" && profileView === "vip") || state.activeTab === "vip") await renderProfile();
  } finally {
    vipClaimingIds.delete(subscriptionId);
    if ((state.activeTab === "profile" && profileView === "vip") || state.activeTab === "vip") startVipCountdown();
  }
}
window.claimVipReward = claimVipReward;

let profileRenderSequence = 0;
async function renderProfile() {
  const renderRequestId = ++profileRenderSequence;
  const isCurrentProfileRender = () => renderRequestId === profileRenderSequence
    && (state.activeTab === "profile" || (state.activeTab === "vip" && profileView === "vip"));
  const content = $("#content");
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
  try {
    if (tab === "home") {
      await Promise.all([loadUserData(), loadTasks()]);
      if (!isCurrentRender()) return;
      renderHome();
      void loadReferralData();
    } else if (tab === "tasks") {
      await Promise.all([loadTasks(), loadUserData()]);
      if (!isCurrentRender()) return;
      renderTasks();
      void loadReferralData();
    } else if (tab === "vip") {
      await loadUserData();
      if (!isCurrentRender()) return;
      await renderVipTab();
    } else if (tab === "wallet") {
      await loadUserData();
      if (!isCurrentRender()) return;
      renderWallet();
    } else if (tab === "profile") {
      profileView = pendingProfileView || "menu";
      pendingProfileView = null;
      await loadUserData();
      if (!isCurrentRender()) return;
      await renderProfile();
      if (!isCurrentRender()) return;
      if (profileView === "referral") void loadReferralData();
    }
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
  if (typeof window.initGramupWalletConnect === "function") await window.initGramupWalletConnect();
  applyStaticTranslations();

  if (!termsAccepted()) {
    showTerms();
  } else {
    maybeShowOnboarding();
  }

  state.initialized = true;

  // عضویت اجباری: هر بار که مینی‌اپ باز می‌شود، عضویت «فعلی» کاربر از تلگرام بررسی می‌شود
  const allowed = await enforceMembership();
  if (!allowed) return;

  await navigate("home");
}

document.addEventListener("DOMContentLoaded", () => {
  boot();
});
