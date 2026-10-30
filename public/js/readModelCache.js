/* Gramup read-only profile/tasks cache. No auth material is accepted or persisted. */
"use strict";
(function attachReadModelCache(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else root.GramupReadModelCache = factory(root);
})(typeof globalThis !== "undefined" ? globalThis : this, function createReadModelCache(root = {}) {

  const VERSION = 1;
  const DEFAULT_TTL_MS = 2 * 60 * 1000;
  const MAX_ENTRIES = 3;
  const MAX_ENTRY_BYTES = 120 * 1024;
  const KEY_PREFIX = "gramup:read-model:v1:";
  const ACTIVE_USER_KEY = `${KEY_PREFIX}active-user`;
  const PROFILE_KEYS = Object.freeze([
    "points", "gramBalance", "rate", "streak", "canCheckIn", "totalCheckins",
    "minWithdrawGram", "nextResetAt", "totalEarnedPoints", "level",
    "withdrawalProgress", "withdrawalRemainingGram", "gramUsdPrice", "firstName"
  ]);
  const TASK_KEYS = Object.freeze([
    "_id", "title", "description", "reward", "url", "verifyType", "type", "taskKind",
    "isSpecialOfDay", "expiresAt", "isSponsored", "vipPlanNumber"
  ]);
  const COMPLETION_KEYS = Object.freeze(["task", "status", "nextAvailableAt", "adminNote"]);
  const LATEST_POST_KEYS = Object.freeze(["task", "openedAt"]);

  function storageFrom(candidate) {
    if (candidate) return candidate;
    try { return root.localStorage || null; } catch { return null; }
  }
  function sessionStorageFrom(candidate) {
    if (candidate) return candidate;
    try { return root.sessionStorage || null; } catch { return null; }
  }
  function safeUserId(value) {
    const id = String(value ?? "").trim();
    return id && id.length <= 64 && /^[A-Za-z0-9:_-]+$/.test(id) ? id : "";
  }
  function cacheKey(userId) {
    const id = safeUserId(userId);
    return id ? `${KEY_PREFIX}${encodeURIComponent(id)}` : "";
  }
  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }
  function copyAllowed(source, keys) {
    if (!source || typeof source !== "object" || Array.isArray(source)) return {};
    const output = {};
    for (const key of keys) {
      const value = source[key];
      if (value === undefined || typeof value === "function" || typeof value === "symbol") continue;
      if (key === "level") {
        if (value && typeof value === "object") {
          output.level = {
            badge: typeof value.badge === "string" ? value.badge.slice(0, 32) : "",
            name: typeof value.name === "string" ? value.name.slice(0, 80) : ""
          };
        }
      } else if (typeof value === "string") output[key] = value.slice(0, 2048);
      else if (typeof value === "boolean") output[key] = value;
      else if (Number.isFinite(Number(value))) output[key] = Number(value);
    }
    return output;
  }
  function sanitizeProfile(profile) { return copyAllowed(profile, PROFILE_KEYS); }
  function sanitizeTasks(model) {
    const source = model && typeof model === "object" ? model : {};
    const tasks = Array.isArray(source.tasks) ? source.tasks.slice(0, 100).map(item => copyAllowed(item, TASK_KEYS)) : [];
    const completions = Array.isArray(source.completions) ? source.completions.slice(0, 200).map(item => copyAllowed(item, COMPLETION_KEYS)) : [];
    const latestPostStates = Array.isArray(source.latestPostStates)
      ? source.latestPostStates.slice(0, 100).map(item => copyAllowed(item, LATEST_POST_KEYS)) : [];
    return {
      tasks,
      completions,
      latestPostStates,
      serverNow: finite(source.serverNow, 0)
    };
  }
  function byteLength(value) {
    try { return new TextEncoder().encode(value).length; }
    catch { return value.length; }
  }
  function safeRemove(storage, key) {
    try { if (storage && key) storage.removeItem(key); } catch { /* unavailable storage */ }
  }
  function readRaw(storage, key) {
    try { return storage && key ? storage.getItem(key) : null; } catch { return null; }
  }
  function listKeys(storage) {
    const result = [];
    try {
      for (let index = 0; index < Number(storage?.length || 0); index += 1) {
        const key = storage.key(index);
        if (key && key.startsWith(KEY_PREFIX) && key !== ACTIVE_USER_KEY) result.push(key);
      }
    } catch { /* unavailable storage */ }
    return result;
  }

  function create(options = {}) {
    const storage = storageFrom(options.storage);
    const sessionStorage = sessionStorageFrom(options.sessionStorage);
    const ttlMs = Math.max(1000, Math.min(Number(options.ttlMs) || DEFAULT_TTL_MS, 24 * 60 * 60 * 1000));
    const now = typeof options.now === "function" ? options.now : () => Date.now();

    function removeExpiredEntries(at = now()) {
      for (const key of listKeys(storage)) {
        const raw = readRaw(storage, key);
        try {
          const entry = JSON.parse(raw || "null");
          if (!entry || entry.version !== VERSION || !Number.isFinite(entry.expiresAt) || entry.expiresAt <= at) safeRemove(storage, key);
        } catch { safeRemove(storage, key); }
      }
    }
    function trimEntries() {
      const entries = listKeys(storage).map(key => {
        try { return { key, createdAt: Number(JSON.parse(readRaw(storage, key) || "{}").createdAt) || 0 }; }
        catch { return { key, createdAt: 0 }; }
      }).sort((a, b) => a.createdAt - b.createdAt);
      while (entries.length > MAX_ENTRIES) safeRemove(storage, entries.shift().key);
    }
    function read(userId, at = now()) {
      const id = safeUserId(userId);
      const key = cacheKey(id);
      if (!key) return null;
      const raw = readRaw(storage, key);
      if (!raw) return null;
      try {
        const entry = JSON.parse(raw);
        if (!entry || entry.version !== VERSION || entry.userId !== id ||
            !Number.isFinite(entry.cachedAt) || !Number.isFinite(entry.expiresAt) ||
            entry.cachedAt > at || entry.expiresAt > entry.cachedAt + ttlMs || entry.expiresAt <= at ||
            !entry.profile || !entry.tasks || byteLength(raw) > MAX_ENTRY_BYTES) {
          safeRemove(storage, key);
          return null;
        }
        return {
          version: VERSION,
          userId: id,
          cachedAt: Number(entry.cachedAt) || 0,
          expiresAt: Number(entry.expiresAt) || 0,
          profile: sanitizeProfile(entry.profile),
          tasks: sanitizeTasks(entry.tasks)
        };
      } catch {
        safeRemove(storage, key);
        return null;
      }
    }
    function write(userId, model, at = now()) {
      const id = safeUserId(userId);
      const key = cacheKey(id);
      if (!key || !model || typeof model !== "object") return false;
      const entry = {
        version: VERSION,
        userId: id,
        cachedAt: at,
        expiresAt: at + ttlMs,
        profile: sanitizeProfile(model.profile),
        tasks: sanitizeTasks(model.tasks)
      };
      let serialized;
      try { serialized = JSON.stringify(entry); } catch { return false; }
      if (byteLength(serialized) > MAX_ENTRY_BYTES) return false;
      try {
        storage.setItem(key, serialized);
        removeExpiredEntries(at);
        trimEntries();
        return true;
      } catch { return false; }
    }
    function clearUser(userId) { safeRemove(storage, cacheKey(userId)); }
    function clearAll() { for (const key of listKeys(storage)) safeRemove(storage, key); }
    function activate(userId) {
      const id = safeUserId(userId);
      if (!id) return false;
      let previous = "";
      try { previous = safeUserId(sessionStorage?.getItem(ACTIVE_USER_KEY)); } catch { /* unavailable */ }
      if (previous && previous !== id) clearUser(previous);
      try { sessionStorage?.setItem(ACTIVE_USER_KEY, id); } catch { /* unavailable */ }
      removeExpiredEntries();
      return true;
    }
    function deactivate() {
      let active = "";
      try { active = safeUserId(sessionStorage?.getItem(ACTIVE_USER_KEY)); } catch { /* unavailable */ }
      if (active) clearUser(active);
      clearAll();
      safeRemove(sessionStorage, ACTIVE_USER_KEY);
    }
    return Object.freeze({
      ttlMs, keyFor: cacheKey, read, write, clearUser, clearAll, activate, deactivate,
      sanitizeProfile, sanitizeTasks,
      limits: Object.freeze({ maxEntries: MAX_ENTRIES, maxEntryBytes: MAX_ENTRY_BYTES })
    });
  }

  return create(root);
});
