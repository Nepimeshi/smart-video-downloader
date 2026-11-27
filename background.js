// background.js - MV3 Service Worker for Smart Video Downloader

import {
  loadSettings,
  saveSettings,
  resetSettings,
  exportSettingsJson,
  validateAndParseImport,
  normalizeHostname
} from "./shared/settings.js";
import { evaluateVideo, shouldAutoDownload, detectFormat } from "./modules/filter.js";
import { MetadataCache } from "./modules/downloader.js";
import { DownloadQueue } from "./modules/queue.js";
import { loadHistory, clearHistory, computeHistoryStats } from "./modules/history.js";

const metadataCache = new MetadataCache(500);

function sendNotification(title, message) {
  if (!chrome.notifications?.create) return;
  chrome.notifications.create({
    type: "basic",
    iconUrl: "assets/icons/icon-128.png",
    title,
    message
  });
}

const downloadQueue = new DownloadQueue({ onNotify: sendNotification });
downloadQueue.init();

// tabId -> { hostname: string, videos: Map<url, VideoRecord> }
const tabState = new Map();

function isMeteredConnection() {
  try {
    const conn = navigator?.connection;
    return Boolean(conn && (conn.saveData || conn.type === "cellular"));
  } catch {
    return false;
  }
}

function getOrCreateTab(tabId, hostname = "") {
  if (!tabState.has(tabId)) {
    tabState.set(tabId, { hostname, videos: new Map() });
  }
  const entry = tabState.get(tabId);
  if (hostname) entry.hostname = hostname;
  return entry;
}

function computeTabStats(tabEntry) {
  let detected = 0;
  let matching = 0;
  let downloaded = 0;
  let skipped = 0;

  for (const v of tabEntry.videos.values()) {
    detected++;
    if (v.status === "downloaded") {
      downloaded++;
      matching++;
    } else if (v.status === "matching") {
      matching++;
    } else {
      skipped++;
    }
  }
  return { detected, matching, downloaded, skipped };
}

function updateBadge(tabId, tabEntry) {
  const { detected, matching } = computeTabStats(tabEntry);
  const text = detected > 0 ? String(detected) : "";
  const color = matching > 0 ? "#06b6d4" : "#3b82f6";
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color }).catch(() => {});
}

async function processDetectedVideos(tabId, pageHostname, incomingVideos) {
  const settings = await loadSettings();
  if (settings.mode === "disabled") return;

  await downloadQueue.init();
  const tabEntry = getOrCreateTab(tabId, pageHostname);
  const recordsToEvaluate = [];

  for (const raw of incomingVideos) {
    if (!raw?.url) continue;
    const existing = tabEntry.videos.get(raw.url) || {
      url: raw.url,
      groupKey: raw.groupKey || raw.url,
      thumbnail: raw.thumbnail || null,
      title: raw.title || null,
      videoWidth: null,
      videoHeight: null,
      duration: null,
      fps: null,
      codec: null,
      isEncrypted: false,
      fileSizeBytes: null,
      contentType: null,
      format: detectFormat(raw.url),
      metadataError: null,
      status: "skipped",
      statusCode: "waiting_metadata",
      reason: "Waiting for metadata...",
      violations: [],
      unsupported: false
    };

    if (raw.videoWidth) existing.videoWidth = raw.videoWidth;
    if (raw.videoHeight) existing.videoHeight = raw.videoHeight;
    if (raw.duration) existing.duration = raw.duration;
    if (raw.fps) existing.fps = raw.fps;
    if (raw.codec) existing.codec = raw.codec;
    if (raw.thumbnail) existing.thumbnail = raw.thumbnail;
    if (raw.title) existing.title = raw.title;
    if (raw.isEncrypted) existing.isEncrypted = true;

    tabEntry.videos.set(raw.url, existing);
    recordsToEvaluate.push(existing);
  }

  updateBadge(tabId, tabEntry);

  const metered = isMeteredConnection();

  await Promise.all(
    recordsToEvaluate.map(async (existing) => {
      const preCheck = evaluateVideo(existing, settings, pageHostname);
      if (preCheck.unsupported) {
        existing.unsupported = true;
        existing.status = "unsupported";
        existing.statusCode = preCheck.statusCode;
        existing.reason = preCheck.reason;
        existing.violations = preCheck.violations;
        return;
      }

      if (existing.fileSizeBytes === null && !existing.metadataError) {
        const meta = await metadataCache.fetchMetadata(existing.url);
        existing.fileSizeBytes = meta.fileSizeBytes;
        existing.contentType = meta.contentType;
        existing.metadataError = meta.metadataError;
        if (!existing.format) {
          existing.format = detectFormat(existing.url, meta.contentType);
        }
      }

      const evalResult = evaluateVideo(existing, settings, pageHostname);
      existing.unsupported = evalResult.unsupported;
      existing.statusCode = evalResult.statusCode;
      existing.violations = evalResult.violations;

      if (downloadQueue.hasUrl(existing.url)) {
        existing.status = "downloaded";
        existing.statusCode = "already_downloaded";
        existing.reason = "Queued or downloaded";
      } else if (evalResult.eligible) {
        const autoDecision = shouldAutoDownload(existing, settings, pageHostname, metered);
        if (autoDecision.shouldDownload) {
          const res = await downloadQueue.enqueue(existing, settings, pageHostname);
          if (res.ok) {
            existing.status = "downloaded";
            existing.statusCode = "downloading";
            existing.reason = "Added to download queue";
          } else {
            existing.status = "matching";
            existing.reason = res.error || "Matches filters";
          }
        } else {
          existing.status = "matching";
          existing.statusCode = "meets_filters";
          existing.reason = `Matches filters (${autoDecision.reason})`;
        }
      } else {
        existing.status = "skipped";
        existing.reason = evalResult.reason;
      }
    })
  );

  updateBadge(tabId, tabEntry);
}

async function reevaluateTab(tabId, triggerAutoDownload = false) {
  const tabEntry = tabState.get(tabId);
  if (!tabEntry) return;
  const settings = await loadSettings();
  const metered = isMeteredConnection();

  for (const record of tabEntry.videos.values()) {
    if (record.unsupported) continue;
    const evalResult = evaluateVideo(record, settings, tabEntry.hostname);
    record.statusCode = evalResult.statusCode;
    record.violations = evalResult.violations;

    if (downloadQueue.hasUrl(record.url)) {
      record.status = "downloaded";
      record.statusCode = "already_downloaded";
      record.reason = "Queued or downloaded";
    } else if (evalResult.eligible) {
      const autoDecision = shouldAutoDownload(record, settings, tabEntry.hostname, metered);
      if (triggerAutoDownload && autoDecision.shouldDownload) {
        const res = await downloadQueue.enqueue(record, settings, tabEntry.hostname);
        record.status = res.ok ? "downloaded" : "matching";
        record.reason = res.ok ? "Added to download queue" : res.error;
      } else {
        record.status = "matching";
        record.statusCode = "meets_filters";
        record.reason = `Matches filters (${autoDecision.reason})`;
      }
    } else {
      record.status = "skipped";
      record.reason = evalResult.reason;
    }
  }
  updateBadge(tabId, tabEntry);
}

// Chrome Downloads events
chrome.downloads.onChanged.addListener(async (delta) => {
  const settings = await loadSettings();
  await downloadQueue.handleDownloadDelta(delta, settings);
});

// Tab lifecycle cleanup
chrome.tabs.onRemoved.addListener((tabId) => {
  tabState.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    tabState.delete(tabId);
    chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
  }
});

// Keyboard shortcuts (chrome.commands)
if (chrome.commands?.onCommand) {
  chrome.commands.onCommand.addListener(async (command) => {
    const settings = await loadSettings();
    if (command === "toggle-auto-download") {
      const nextMode = settings.mode === "automatic" ? "detection_only" : "automatic";
      await saveSettings({ mode: nextMode });
      sendNotification("Smart Video Downloader", `Mode switched to ${nextMode.replace("_", " ")}`);
    } else if (command === "toggle-pause") {
      const nextPaused = !settings.paused;
      const updated = await saveSettings({ paused: nextPaused });
      if (!nextPaused) await downloadQueue.schedule(updated);
      sendNotification("Smart Video Downloader", nextPaused ? "Downloads paused" : "Downloads resumed");
    } else if (command === "toggle-detection-only") {
      const nextMode = settings.mode === "detection_only" ? "automatic" : "detection_only";
      await saveSettings({ mode: nextMode });
    } else if (command === "toggle-floating-panel") {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id != null) {
        chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_FLOATING_PANEL" }).catch(() => {});
      }
    }
  });
}

async function ensureContentScriptAndScan(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "SCAN_PAGE" });
    return { ok: true };
  } catch {
    // Content script not connected (e.g. tab was open before extension reload) — inject it now
    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ["content.js"]
      });
      return { ok: true };
    } catch {
      return { ok: false, error: "Cannot scan this page (restricted Chrome page)" };
    }
  }
}

// Message router for popup & content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "VIDEOS_DETECTED" && sender.tab?.id != null) {
    processDetectedVideos(sender.tab.id, message.pageHostname || "", message.videos || [])
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "GET_FULL_STATE") {
    (async () => {
      await downloadQueue.init();
      await downloadQueue.refreshProgress();
      const settings = await loadSettings();
      const history = await loadHistory();
      const historyStats = computeHistoryStats(history);

      const tabId = message.tabId ?? sender.tab?.id;
      let tabEntry = tabId != null ? tabState.get(tabId) : null;
      if (!tabEntry && tabId != null && !sender.tab) {
        await ensureContentScriptAndScan(tabId);
        tabEntry = tabState.get(tabId);
      }

      const safeEntry = tabEntry || { hostname: "", videos: new Map() };
      sendResponse({
        settings,
        hostname: safeEntry.hostname,
        isMetered: isMeteredConnection(),
        tabStats: computeTabStats(safeEntry),
        videos: Array.from(safeEntry.videos.values()),
        queue: downloadQueue.items,
        history,
        historyStats
      });
    })();
    return true;
  }

  if (message.type === "UPDATE_SETTINGS") {
    (async () => {
      const updated = await saveSettings(message.settings || {});
      if (!updated.paused) {
        await downloadQueue.schedule(updated);
      }
      if (message.tabId != null) {
        await reevaluateTab(message.tabId, updated.mode === "automatic" && !updated.paused);
      }
      sendResponse({ ok: true, settings: updated });
    })();
    return true;
  }

  if (message.type === "RESET_SETTINGS") {
    resetSettings().then((settings) => sendResponse({ ok: true, settings }));
    return true;
  }

  if (message.type === "EXPORT_SETTINGS") {
    loadSettings().then((s) => sendResponse({ ok: true, json: exportSettingsJson(s) }));
    return true;
  }

  if (message.type === "IMPORT_SETTINGS") {
    const parsed = validateAndParseImport(message.json || "");
    if (!parsed.ok) {
      sendResponse(parsed);
      return true;
    }
    saveSettings(parsed.settings).then((settings) => sendResponse({ ok: true, settings }));
    return true;
  }

  if (message.type === "SCAN_TAB") {
    ensureContentScriptAndScan(message.tabId).then((res) => sendResponse(res));
    return true;
  }

  if (message.type === "MANUAL_DOWNLOAD") {
    (async () => {
      const settings = await loadSettings();
      const tabId = message.tabId ?? sender.tab?.id;
      const tabEntry = tabId != null ? tabState.get(tabId) : null;
      const record = tabEntry?.videos.get(message.url) || { url: message.url };
      const res = await downloadQueue.enqueue(record, settings, tabEntry?.hostname || message.hostname || "");
      if (record && res.ok) {
        record.status = "downloaded";
        record.statusCode = "downloading";
        record.reason = "Manually queued";
      }
      sendResponse(res);
    })();
    return true;
  }

  if (message.type === "QUEUE_ACTION") {
    (async () => {
      const settings = await loadSettings();
      const { action, id, downloadId } = message;
      let res = { ok: false };
      if (action === "pause") res = await downloadQueue.pauseItem(id);
      else if (action === "resume") res = await downloadQueue.resumeItem(id, settings);
      else if (action === "cancel") res = await downloadQueue.cancelItem(id, settings);
      else if (action === "retry") res = await downloadQueue.retryItem(id, settings);
      else if (action === "remove") res = await downloadQueue.removeItem(id);
      else if (action === "clear_completed") res = await downloadQueue.clearCompleted();
      else if (action === "open_file") { downloadQueue.openFile(downloadId); res = { ok: true }; }
      else if (action === "show_folder") { downloadQueue.showInFolder(downloadId); res = { ok: true }; }
      sendResponse(res);
    })();
    return true;
  }

  if (message.type === "CLEAR_HISTORY") {
    clearHistory().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === "HIDE_FLOATING_PANEL_SITE") {
    (async () => {
      const settings = await loadSettings();
      const host = normalizeHostname(message.hostname || sender.tab?.url || "");
      if (host && !settings.floatingPanel.hiddenSites.includes(host)) {
        const hiddenSites = [...settings.floatingPanel.hiddenSites, host];
        await saveSettings({ floatingPanel: { ...settings.floatingPanel, hiddenSites } });
      }
      sendResponse({ ok: true });
    })();
    return true;
  }
});
