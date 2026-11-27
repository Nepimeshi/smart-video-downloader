// shared/settings.js - Versioned settings schema (v3) with v2 migration & JSON import/export

export const SETTINGS_SCHEMA_VERSION = 3;

export const RESOLUTION_OPTIONS = [0, 144, 240, 360, 480, 720, 1080, 1440, 2160];
export const CONCURRENCY_OPTIONS = [1, 2, 3, 5, 10];
export const FPS_OPTIONS = [0, 24, 30, 50, 60];
export const FORMAT_OPTIONS = ["mp4", "webm", "mov", "ogg", "m4v"];
export const CODEC_OPTIONS = ["any", "h264", "h265", "av1", "vp8", "vp9"];
export const ASPECT_RATIO_OPTIONS = ["any", "16:9", "9:16", "4:3", "1:1", "custom"];

export const DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: SETTINGS_SCHEMA_VERSION,

  // Operating mode: "automatic" | "detection_only" | "disabled"
  mode: "detection_only",
  // Master switch (kept in sync with mode for backward compatibility)
  autoDownload: false,
  paused: false,

  // Detection
  autoScanIntervalSec: 5,

  // Filters
  minResolution: 720,
  minFileSizeEnabled: true,
  minFileSizeMB: 5,
  maxFileSizeEnabled: false,
  maxFileSizeMB: 500,
  minDurationEnabled: false,
  minDurationSec: 10,
  maxDurationEnabled: false,
  maxDurationSec: 3600,
  allowedFormats: ["mp4", "webm", "mov", "ogg", "m4v"],
  minFps: 0,
  codec: "any",
  aspectRatio: "any",
  customAspectRatio: "16:9",

  // Unknown metadata behavior: "reject" | "allow"
  unknownPolicy: {
    resolution: "reject",
    fileSize: "reject",
    duration: "reject",
    fps: "reject",
    codec: "reject"
  },

  // Queue & Network
  maxConcurrentDownloads: 3,
  maxRetries: 2,
  pauseOnMeteredConnection: false,
  overrideMeteredPause: false,

  // Website rules & per-domain profiles
  siteMode: "all", // "all" | "allowlist" | "blocklist"
  allowedSites: [],
  blockedSites: [],
  pausedSites: [],
  // { [hostname]: { enabled: boolean, minResolution?: number, minFileSizeMB?: number|null, maxFileSizeMB?: number|null, allowedFormats?: string[] } }
  siteProfiles: {},

  // File organization
  baseFolder: "SmartVideoDownloader",
  folderStructure: "website_date", // "flat" | "website" | "date" | "website_date" | "custom"
  customFolderTemplate: "{site}/{date}",
  filenameMode: "original", // "original" | "site_original" | "date_original" | "resolution_original" | "custom"
  customFilenameTemplate: "{site}_{name}_{res}",

  // Notifications
  notifications: {
    enabled: true,
    onComplete: true,
    onFail: true,
    onBatchComplete: true,
    onSkipped: false,
    onQueueFinished: true
  },

  // Floating panel
  floatingPanel: {
    enabled: true,
    hiddenSites: [],
    position: { right: 16, bottom: 16 },
    collapsed: true
  },

  // History
  historyRetentionDays: 30,
  historyMaxEntries: 500
});

export function normalizeHostname(input) {
  if (!input || typeof input !== "string") return "";
  let host = input.trim().toLowerCase();
  try {
    if (host.includes("://")) {
      host = new URL(host).hostname.toLowerCase();
    } else {
      host = host.split("/")[0].split(":")[0];
    }
  } catch {
    host = host.split("/")[0].split(":")[0];
  }
  return host.replace(/^www\./, "");
}

function parseOptionalPositive(val, fallback = null) {
  if (val === null || val === undefined || val === "") return fallback;
  const num = Number(val);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

function sanitizeUnknownPolicy(raw = {}) {
  const valid = (v) => (v === "allow" ? "allow" : "reject");
  return {
    resolution: valid(raw.resolution),
    fileSize: valid(raw.fileSize),
    duration: valid(raw.duration),
    fps: valid(raw.fps),
    codec: valid(raw.codec)
  };
}

function sanitizeSiteProfiles(raw = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [key, prof] of Object.entries(raw)) {
    const host = normalizeHostname(key);
    if (!host || !prof || typeof prof !== "object") continue;
    out[host] = {
      enabled: prof.enabled !== false,
      minResolution:
        prof.minResolution !== undefined && RESOLUTION_OPTIONS.includes(Number(prof.minResolution))
          ? Number(prof.minResolution)
          : null,
      minFileSizeMB: parseOptionalPositive(prof.minFileSizeMB, null),
      maxFileSizeMB: parseOptionalPositive(prof.maxFileSizeMB, null),
      allowedFormats: Array.isArray(prof.allowedFormats)
        ? prof.allowedFormats.filter((f) => FORMAT_OPTIONS.includes(f))
        : null
    };
  }
  return out;
}

export function sanitizeSettings(raw = {}) {
  // Backward compatibility with v2.0.0 settings
  let mode = raw.mode;
  if (!["automatic", "detection_only", "disabled"].includes(mode)) {
    mode = raw.autoDownload ? "automatic" : "detection_only";
  }
  const autoDownload = mode === "automatic";

  const minResolution = RESOLUTION_OPTIONS.includes(Number(raw.minResolution))
    ? Number(raw.minResolution)
    : DEFAULT_SETTINGS.minResolution;

  const minFileSizeEnabled =
    raw.minFileSizeEnabled !== undefined
      ? Boolean(raw.minFileSizeEnabled)
      : raw.minFileSizeMB !== null;

  const maxFileSizeEnabled =
    raw.maxFileSizeEnabled !== undefined
      ? Boolean(raw.maxFileSizeEnabled)
      : Boolean(raw.maxFileSizeMB);

  const minDurationEnabled =
    raw.minDurationEnabled !== undefined
      ? Boolean(raw.minDurationEnabled)
      : Boolean(raw.minDurationSec);

  const maxDurationEnabled =
    raw.maxDurationEnabled !== undefined
      ? Boolean(raw.maxDurationEnabled)
      : Boolean(raw.maxDurationSec);

  const allowedFormats = Array.isArray(raw.allowedFormats)
    ? [...new Set(raw.allowedFormats.filter((f) => FORMAT_OPTIONS.includes(f)))]
    : [...DEFAULT_SETTINGS.allowedFormats];

  const maxConcurrentDownloads = CONCURRENCY_OPTIONS.includes(Number(raw.maxConcurrentDownloads))
    ? Number(raw.maxConcurrentDownloads)
    : DEFAULT_SETTINGS.maxConcurrentDownloads;

  const siteMode = ["all", "allowlist", "blocklist"].includes(raw.siteMode)
    ? raw.siteMode
    : DEFAULT_SETTINGS.siteMode;

  const folderStructure = ["flat", "website", "date", "website_date", "custom"].includes(raw.folderStructure)
    ? raw.folderStructure
    : DEFAULT_SETTINGS.folderStructure;

  const filenameMode = ["original", "site_original", "date_original", "resolution_original", "custom"].includes(raw.filenameMode)
    ? raw.filenameMode
    : DEFAULT_SETTINGS.filenameMode;

  const notifRaw = raw.notifications || {};
  const fpRaw = raw.floatingPanel || {};

  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    mode,
    autoDownload,
    paused: Boolean(raw.paused),
    autoScanIntervalSec: Math.max(2, Math.min(60, Number(raw.autoScanIntervalSec) || 5)),

    minResolution,
    minFileSizeEnabled,
    minFileSizeMB: parseOptionalPositive(raw.minFileSizeMB, DEFAULT_SETTINGS.minFileSizeMB),
    maxFileSizeEnabled,
    maxFileSizeMB: parseOptionalPositive(raw.maxFileSizeMB, DEFAULT_SETTINGS.maxFileSizeMB),
    minDurationEnabled,
    minDurationSec: parseOptionalPositive(raw.minDurationSec, DEFAULT_SETTINGS.minDurationSec),
    maxDurationEnabled,
    maxDurationSec: parseOptionalPositive(raw.maxDurationSec, DEFAULT_SETTINGS.maxDurationSec),
    allowedFormats: allowedFormats.length ? allowedFormats : [...DEFAULT_SETTINGS.allowedFormats],
    minFps: FPS_OPTIONS.includes(Number(raw.minFps)) ? Number(raw.minFps) : 0,
    codec: CODEC_OPTIONS.includes(raw.codec) ? raw.codec : "any",
    aspectRatio: ASPECT_RATIO_OPTIONS.includes(raw.aspectRatio) ? raw.aspectRatio : "any",
    customAspectRatio: typeof raw.customAspectRatio === "string" ? raw.customAspectRatio.trim() : "16:9",
    unknownPolicy: sanitizeUnknownPolicy(raw.unknownPolicy),

    maxConcurrentDownloads,
    maxRetries: Math.max(0, Math.min(5, Number(raw.maxRetries ?? DEFAULT_SETTINGS.maxRetries))),
    pauseOnMeteredConnection: Boolean(raw.pauseOnMeteredConnection),
    overrideMeteredPause: Boolean(raw.overrideMeteredPause),

    siteMode,
    allowedSites: Array.isArray(raw.allowedSites)
      ? [...new Set(raw.allowedSites.map(normalizeHostname).filter(Boolean))]
      : [],
    blockedSites: Array.isArray(raw.blockedSites)
      ? [...new Set(raw.blockedSites.map(normalizeHostname).filter(Boolean))]
      : [],
    pausedSites: Array.isArray(raw.pausedSites)
      ? [...new Set(raw.pausedSites.map(normalizeHostname).filter(Boolean))]
      : [],
    siteProfiles: sanitizeSiteProfiles(raw.siteProfiles),

    baseFolder:
      typeof raw.baseFolder === "string" && raw.baseFolder.trim()
        ? raw.baseFolder.replace(/[<>:"/\\|?*\x00-\x1f.]+/g, "_").trim()
        : DEFAULT_SETTINGS.baseFolder,
    folderStructure,
    customFolderTemplate:
      typeof raw.customFolderTemplate === "string" && raw.customFolderTemplate.trim()
        ? raw.customFolderTemplate.trim()
        : DEFAULT_SETTINGS.customFolderTemplate,
    filenameMode,
    customFilenameTemplate:
      typeof raw.customFilenameTemplate === "string" && raw.customFilenameTemplate.trim()
        ? raw.customFilenameTemplate.trim()
        : DEFAULT_SETTINGS.customFilenameTemplate,

    notifications: {
      enabled: notifRaw.enabled !== false,
      onComplete: notifRaw.onComplete !== false,
      onFail: notifRaw.onFail !== false,
      onBatchComplete: notifRaw.onBatchComplete !== false,
      onSkipped: Boolean(notifRaw.onSkipped),
      onQueueFinished: notifRaw.onQueueFinished !== false
    },

    floatingPanel: {
      enabled: fpRaw.enabled !== false,
      hiddenSites: Array.isArray(fpRaw.hiddenSites)
        ? [...new Set(fpRaw.hiddenSites.map(normalizeHostname).filter(Boolean))]
        : [],
      position: {
        right: Number.isFinite(Number(fpRaw.position?.right)) ? Number(fpRaw.position.right) : 16,
        bottom: Number.isFinite(Number(fpRaw.position?.bottom)) ? Number(fpRaw.position.bottom) : 16
      },
      collapsed: fpRaw.collapsed !== false
    },

    historyRetentionDays: Math.max(1, Math.min(365, Number(raw.historyRetentionDays) || 30)),
    historyMaxEntries: Math.max(50, Math.min(2000, Number(raw.historyMaxEntries) || 500))
  };
}

export function exportSettingsJson(settings) {
  const clean = sanitizeSettings(settings);
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      settings: clean
    },
    null,
    2
  );
}

export function validateAndParseImport(jsonString) {
  let parsed;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    return { ok: false, error: "Invalid JSON format" };
  }
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, error: "Configuration must be a JSON object" };
  }
  const candidate = parsed.settings && typeof parsed.settings === "object" ? parsed.settings : parsed;
  if (candidate.schemaVersion && Number(candidate.schemaVersion) > SETTINGS_SCHEMA_VERSION) {
    return { ok: false, error: `Unsupported schema version ${candidate.schemaVersion}` };
  }
  return { ok: true, settings: sanitizeSettings(candidate) };
}

export async function loadSettings() {
  const stored = await chrome.storage.local.get("settings");
  return sanitizeSettings(stored.settings || {});
}

export async function saveSettings(partialOrFull) {
  const current = await loadSettings();
  const next = { ...current, ...partialOrFull };
  // Keep mode and autoDownload synchronized
  if (partialOrFull.autoDownload !== undefined && partialOrFull.mode === undefined) {
    next.mode = partialOrFull.autoDownload ? "automatic" : (current.mode === "disabled" ? "disabled" : "detection_only");
  }
  if (partialOrFull.mode !== undefined) {
    next.autoDownload = partialOrFull.mode === "automatic";
  }
  const merged = sanitizeSettings(next);
  await chrome.storage.local.set({ settings: merged });
  return merged;
}

export async function resetSettings() {
  const fresh = sanitizeSettings(DEFAULT_SETTINGS);
  await chrome.storage.local.set({ settings: fresh });
  return fresh;
}
