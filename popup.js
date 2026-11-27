// popup.js - 6-Tab Smart Video Downloader UI Controller

import { formatBytes, formatDuration, getEffectiveResolution } from "./modules/filter.js";
import { extractOriginalName } from "./modules/organizer.js";
import { normalizeHostname } from "./shared/settings.js";

const $ = (id) => document.getElementById(id);

let activeTabId = null;
let currentHostname = "";
let lastState = null;
let activeTabName = "dashboard";

function switchTab(name) {
  activeTabName = name;
  document.querySelectorAll(".nav-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === name);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `tab-${name}`);
  });
  if (name === "settings" && lastState) populateSettingsForm(lastState.settings);
  if (name === "websites" && lastState) renderWebsitesTab(lastState.settings);
}

function getDisplayName(v) {
  const { stem, ext } = extractOriginalName(v.url, v.contentType, v.title);
  return `${stem}${ext}`;
}

function formatSpeed(bps) {
  if (!bps || bps <= 0) return "";
  return `${formatBytes(bps)}/s`;
}

function renderDashboard(state) {
  const s = state.settings;
  $("modeSelect").value = s.mode;
  $("pauseBtn").textContent = s.paused ? "Resume" : "Pause";
  $("pauseBtn").disabled = s.mode === "disabled";

  const banner = $("statusBanner");
  banner.classList.remove("active", "paused");
  if (s.mode === "disabled") {
    banner.textContent = "Extension is DISABLED";
  } else if (s.paused) {
    banner.textContent = "Downloads are PAUSED";
    banner.classList.add("paused");
  } else if (state.isMetered && s.pauseOnMeteredConnection && !s.overrideMeteredPause) {
    banner.textContent = "Auto-downloads paused (metered network)";
    banner.classList.add("paused");
  } else if (s.mode === "automatic") {
    banner.textContent = "AUTOMATIC mode — downloading qualifying videos";
    banner.classList.add("active");
  } else {
    banner.textContent = "DETECTION ONLY — evaluating without auto-downloading";
  }

  $("statDetected").textContent = String(state.tabStats.detected);
  $("statMatching").textContent = String(state.tabStats.matching);
  const activeDl = state.queue.filter((q) => q.state === "downloading").length;
  $("statActive").textContent = String(activeDl);
  $("statCompleted").textContent = String(state.historyStats.succeeded);
  $("statStorage").textContent = formatBytes(state.historyStats.totalBytes);

  $("tabBadgeVideos").textContent = String(state.tabStats.detected);
  $("tabBadgeQueue").textContent = String(state.queue.filter((q) => q.state === "queued" || q.state === "downloading").length);

  const parts = [];
  if (s.minResolution > 0) parts.push(`≥${s.minResolution}p`);
  if (s.minFileSizeEnabled) parts.push(`≥${s.minFileSizeMB} MB`);
  if (s.maxFileSizeEnabled) parts.push(`≤${s.maxFileSizeMB} MB`);
  if (s.minDurationEnabled) parts.push(`≥${s.minDurationSec}s`);
  if (s.minFps > 0) parts.push(`≥${s.minFps}fps`);
  $("filterSummary").textContent = parts.length ? parts.join(" · ") : "No filters";
}

function renderVideos(videos) {
  const list = $("videoList");
  list.innerHTML = "";
  $("videosEmpty").classList.toggle("hidden", videos.length > 0);

  for (const v of videos) {
    const li = document.createElement("li");
    li.className = "item-card";

    const top = document.createElement("div");
    top.className = "item-top";
    const title = document.createElement("span");
    title.className = "item-title";
    title.textContent = getDisplayName(v);
    title.title = v.url;
    const badge = document.createElement("span");
    badge.className = `badge badge-${v.status}`;
    badge.textContent = v.status;
    top.append(title, badge);

    const res = getEffectiveResolution(v);
    const meta = document.createElement("div");
    meta.className = "compact-row muted";
    meta.textContent = `${res ? `${res}p` : "Res ?"} · ${formatBytes(v.fileSizeBytes)} · ${formatDuration(v.duration)} · ${(v.format || "mp4").toUpperCase()}`;

    const reason = document.createElement("div");
    reason.className = "muted";
    reason.textContent = v.reason;

    li.append(top, meta, reason);

    if (!v.unsupported && v.status !== "downloaded") {
      const actions = document.createElement("div");
      actions.className = "item-actions";
      const dlBtn = document.createElement("button");
      dlBtn.className = "btn-xs";
      dlBtn.textContent = v.violations?.length ? "Override & Download" : "Download";
      dlBtn.addEventListener("click", async () => {
        dlBtn.disabled = true;
        dlBtn.textContent = "Queued";
        await chrome.runtime.sendMessage({
          type: "MANUAL_DOWNLOAD",
          tabId: activeTabId,
          url: v.url,
          hostname: currentHostname
        });
        refreshState();
      });
      actions.appendChild(dlBtn);
      li.appendChild(actions);
    }

    list.appendChild(li);
  }
}

function renderQueue(queue) {
  const list = $("queueList");
  list.innerHTML = "";
  $("queueEmpty").classList.toggle("hidden", queue.length > 0);

  for (const q of queue) {
    const li = document.createElement("li");
    li.className = "item-card";

    const top = document.createElement("div");
    top.className = "item-top";
    const title = document.createElement("span");
    title.className = "item-title";
    title.textContent = q.filename;
    title.title = q.fullPath;
    const badge = document.createElement("span");
    badge.className = `badge badge-${q.state}`;
    badge.textContent = q.state;
    top.append(title, badge);
    li.appendChild(top);

    const pct = q.totalBytes > 0 ? Math.min(100, Math.round((q.bytesReceived / q.totalBytes) * 100)) : 0;
    if (q.state === "downloading" || q.state === "paused") {
      const track = document.createElement("div");
      track.className = "progress-track";
      const bar = document.createElement("div");
      bar.className = "progress-bar";
      bar.style.width = `${pct}%`;
      track.appendChild(bar);
      li.appendChild(track);
    }

    const meta = document.createElement("div");
    meta.className = "muted";
    const speedTxt = q.speedBps ? ` · ${formatSpeed(q.speedBps)}` : "";
    const etaTxt = q.etaSec ? ` · ETA ${formatDuration(q.etaSec)}` : "";
    meta.textContent = `${q.website} · ${q.resolution ? `${q.resolution}p` : "?"} · ${formatBytes(q.bytesReceived)} / ${formatBytes(q.totalBytes)}${speedTxt}${etaTxt}`;
    li.appendChild(meta);

    if (q.error) {
      const err = document.createElement("div");
      err.className = "muted";
      err.style.color = "#fca5a5";
      err.textContent = q.error;
      li.appendChild(err);
    }

    const actions = document.createElement("div");
    actions.className = "item-actions";
    const addBtn = (label, action) => {
      const b = document.createElement("button");
      b.className = "btn-xs";
      b.textContent = label;
      b.addEventListener("click", async () => {
        await chrome.runtime.sendMessage({ type: "QUEUE_ACTION", action, id: q.id, downloadId: q.downloadId });
        refreshState();
      });
      actions.appendChild(b);
    };

    if (q.state === "downloading" || q.state === "queued") {
      addBtn("Pause", "pause");
      addBtn("Cancel", "cancel");
    } else if (q.state === "paused") {
      addBtn("Resume", "resume");
      addBtn("Cancel", "cancel");
    } else if (q.state === "failed" || q.state === "cancelled") {
      addBtn("Retry", "retry");
      addBtn("Remove", "remove");
    } else if (q.state === "complete") {
      if (q.downloadId != null) {
        addBtn("Open", "open_file");
        addBtn("Folder", "show_folder");
      }
      addBtn("Remove", "remove");
    }
    li.appendChild(actions);
    list.appendChild(li);
  }
}

function renderHistory(history, stats) {
  const query = ($("historySearch").value || "").trim().toLowerCase();
  const filtered = query
    ? history.filter((h) => (h.filename || "").toLowerCase().includes(query) || (h.website || "").toLowerCase().includes(query))
    : history;

  $("historyStatsBar").textContent = `${stats.total} total (${stats.succeeded} ok, ${stats.failed} failed) · ${formatBytes(stats.totalBytes)} · avg ${formatBytes(stats.averageBytes)}`;
  const list = $("historyList");
  list.innerHTML = "";
  $("historyEmpty").classList.toggle("hidden", filtered.length > 0);

  for (const h of filtered.slice(0, 60)) {
    const li = document.createElement("li");
    li.className = "item-card";
    const top = document.createElement("div");
    top.className = "item-top";
    const title = document.createElement("span");
    title.className = "item-title";
    title.textContent = h.filename;
    const badge = document.createElement("span");
    badge.className = `badge badge-${h.status}`;
    badge.textContent = h.status;
    top.append(title, badge);

    const meta = document.createElement("div");
    meta.className = "muted";
    meta.textContent = `${h.website} · ${h.resolution ? `${h.resolution}p` : "?"} · ${formatBytes(h.fileSizeBytes)} · ${new Date(h.timestamp).toLocaleDateString()}`;
    li.append(top, meta);
    list.appendChild(li);
  }
}

function renderWebsitesTab(s) {
  const host = normalizeHostname(currentHostname);
  $("currentSiteLabel").textContent = host || "—";
  const isPausedSite = host && s.pausedSites.includes(host);
  $("pauseSiteBtn").textContent = isPausedSite ? "Resume Site" : "Pause Site";
  $("pauseSiteBtn").disabled = !host;

  $("siteMode").value = s.siteMode;
  $("siteListBox").classList.toggle("hidden", s.siteMode === "all");
  if (s.siteMode === "allowlist") {
    $("siteListLabel").textContent = "Allowed websites (one per line)";
    $("siteListInput").value = s.allowedSites.join("\n");
  } else if (s.siteMode === "blocklist") {
    $("siteListLabel").textContent = "Blocked websites (one per line)";
    $("siteListInput").value = s.blockedSites.join("\n");
  }

  const list = $("profilesList");
  list.innerHTML = "";
  for (const [domain, prof] of Object.entries(s.siteProfiles || {})) {
    const li = document.createElement("li");
    li.className = "compact-row muted";
    const info = document.createElement("span");
    info.textContent = `${domain}: ${prof.enabled ? "Auto" : "Off"}${prof.minResolution != null ? ` · ≥${prof.minResolution}p` : ""}${prof.minFileSizeMB ? ` · ≥${prof.minFileSizeMB}MB` : ""}`;
    const del = document.createElement("button");
    del.className = "btn-xs";
    del.textContent = "✕";
    del.addEventListener("click", async () => {
      const nextProfiles = { ...s.siteProfiles };
      delete nextProfiles[domain];
      await savePatch({ siteProfiles: nextProfiles });
    });
    li.append(info, del);
    list.appendChild(li);
  }
}

function populateSettingsForm(s) {
  $("minResolution").value = String(s.minResolution);
  $("minFileSizeEnabled").checked = s.minFileSizeEnabled;
  $("minFileSizeMB").value = s.minFileSizeMB ?? "";
  $("maxFileSizeEnabled").checked = s.maxFileSizeEnabled;
  $("maxFileSizeMB").value = s.maxFileSizeMB ?? "";
  $("minDurationEnabled").checked = s.minDurationEnabled;
  $("minDurationSec").value = s.minDurationSec ?? "";
  $("maxDurationEnabled").checked = s.maxDurationEnabled;
  $("maxDurationSec").value = s.maxDurationSec ?? "";
  $("minFps").value = String(s.minFps || 0);
  $("codec").value = s.codec || "any";
  $("aspectRatio").value = s.aspectRatio || "any";
  document.querySelectorAll(".fmt-cb").forEach((cb) => {
    cb.checked = s.allowedFormats.includes(cb.value);
  });
  $("unkRes").value = s.unknownPolicy?.resolution || "reject";
  $("unkSize").value = s.unknownPolicy?.fileSize || "reject";
  $("maxConcurrentDownloads").value = String(s.maxConcurrentDownloads);
  $("maxRetries").value = String(s.maxRetries);
  $("folderStructure").value = s.folderStructure;
  $("filenameMode").value = s.filenameMode;
  $("pauseOnMeteredConnection").checked = s.pauseOnMeteredConnection;
  $("notifEnabled").checked = s.notifications.enabled;
  $("notifComplete").checked = s.notifications.onComplete;
  $("notifFail").checked = s.notifications.onFail;
  $("floatingPanelEnabled").checked = s.floatingPanel.enabled;
}

async function savePatch(patch) {
  const res = await chrome.runtime.sendMessage({
    type: "UPDATE_SETTINGS",
    tabId: activeTabId,
    settings: patch
  });
  if (res?.settings && lastState) {
    lastState.settings = res.settings;
  }
  await refreshState();
}

function collectAndSaveSettings() {
  const allowedFormats = Array.from(document.querySelectorAll(".fmt-cb"))
    .filter((cb) => cb.checked)
    .map((cb) => cb.value);

  savePatch({
    minResolution: Number($("minResolution").value),
    minFileSizeEnabled: $("minFileSizeEnabled").checked,
    minFileSizeMB: Number($("minFileSizeMB").value) || 5,
    maxFileSizeEnabled: $("maxFileSizeEnabled").checked,
    maxFileSizeMB: Number($("maxFileSizeMB").value) || 500,
    minDurationEnabled: $("minDurationEnabled").checked,
    minDurationSec: Number($("minDurationSec").value) || 10,
    maxDurationEnabled: $("maxDurationEnabled").checked,
    maxDurationSec: Number($("maxDurationSec").value) || 3600,
    minFps: Number($("minFps").value),
    codec: $("codec").value,
    aspectRatio: $("aspectRatio").value,
    allowedFormats: allowedFormats.length ? allowedFormats : ["mp4"],
    unknownPolicy: {
      ...(lastState?.settings?.unknownPolicy || {}),
      resolution: $("unkRes").value,
      fileSize: $("unkSize").value
    },
    maxConcurrentDownloads: Number($("maxConcurrentDownloads").value),
    maxRetries: Number($("maxRetries").value),
    folderStructure: $("folderStructure").value,
    filenameMode: $("filenameMode").value,
    pauseOnMeteredConnection: $("pauseOnMeteredConnection").checked,
    notifications: {
      ...(lastState?.settings?.notifications || {}),
      enabled: $("notifEnabled").checked,
      onComplete: $("notifComplete").checked,
      onFail: $("notifFail").checked
    },
    floatingPanel: {
      ...(lastState?.settings?.floatingPanel || {}),
      enabled: $("floatingPanelEnabled").checked
    }
  });
}

async function refreshState() {
  if (activeTabId == null) return;
  const state = await chrome.runtime.sendMessage({ type: "GET_FULL_STATE", tabId: activeTabId });
  if (!state) return;
  lastState = state;
  if (state.hostname) {
    currentHostname = state.hostname;
    $("siteBadge").textContent = currentHostname;
  }
  renderDashboard(state);
  renderVideos(state.videos);
  renderQueue(state.queue);
  renderHistory(state.history, state.historyStats);
  if (activeTabName === "websites") renderWebsitesTab(state.settings);
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id != null) {
    activeTabId = tab.id;
    try {
      currentHostname = new URL(tab.url).hostname;
      $("siteBadge").textContent = currentHostname;
    } catch {
      $("siteBadge").textContent = "Restricted page";
    }
  }

  document.querySelectorAll(".nav-tab").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  $("modeSelect").addEventListener("change", () => savePatch({ mode: $("modeSelect").value }));
  $("pauseBtn").addEventListener("click", () => savePatch({ paused: !lastState?.settings?.paused }));
  $("quickFiltersBtn").addEventListener("click", () => switchTab("settings"));

  const triggerScan = async () => {
    await chrome.runtime.sendMessage({ type: "SCAN_TAB", tabId: activeTabId });
    setTimeout(refreshState, 350);
  };
  $("scanBtn").addEventListener("click", triggerScan);
  $("rescanBtn2").addEventListener("click", triggerScan);

  $("clearCompletedBtn").addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "QUEUE_ACTION", action: "clear_completed" });
    refreshState();
  });

  $("historySearch").addEventListener("input", () => {
    if (lastState) renderHistory(lastState.history, lastState.historyStats);
  });
  $("clearHistoryBtn").addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "CLEAR_HISTORY" });
    refreshState();
  });

  // Website controls
  $("pauseSiteBtn").addEventListener("click", () => {
    const host = normalizeHostname(currentHostname);
    if (!host || !lastState) return;
    const set = new Set(lastState.settings.pausedSites);
    if (set.has(host)) set.delete(host);
    else set.add(host);
    savePatch({ pausedSites: [...set] });
  });

  $("siteMode").addEventListener("change", () => savePatch({ siteMode: $("siteMode").value }));
  $("siteListInput").addEventListener("change", () => {
    const list = $("siteListInput").value.split(/\r?\n/).map(normalizeHostname).filter(Boolean);
    if ($("siteMode").value === "allowlist") savePatch({ allowedSites: list });
    else if ($("siteMode").value === "blocklist") savePatch({ blockedSites: list });
  });
  $("addCurrentToListBtn").addEventListener("click", () => {
    const host = normalizeHostname(currentHostname);
    if (!host) return;
    const lines = $("siteListInput").value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.includes(host)) lines.push(host);
    $("siteListInput").value = lines.join("\n");
    $("siteListInput").dispatchEvent(new Event("change"));
  });

  $("saveProfileBtn").addEventListener("click", () => {
    const host = normalizeHostname($("profileHost").value || currentHostname);
    if (!host || !lastState) return;
    const profiles = { ...(lastState.settings.siteProfiles || {}) };
    profiles[host] = {
      enabled: $("profileEnabled").checked,
      minResolution: $("profileRes").value === "" ? null : Number($("profileRes").value),
      minFileSizeMB: $("profileMinSize").value === "" ? null : Number($("profileMinSize").value)
    };
    $("profileHost").value = "";
    savePatch({ siteProfiles: profiles });
  });

  // Auto-save all settings inputs immediately on change
  $("tab-settings").addEventListener("change", (e) => {
    if (e.target.id === "importFile") return;
    collectAndSaveSettings();
  });

  // Export / Import / Reset
  $("exportBtn").addEventListener("click", async () => {
    const res = await chrome.runtime.sendMessage({ type: "EXPORT_SETTINGS" });
    if (!res?.ok) return;
    const blob = new Blob([res.json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "smart-video-downloader-settings.json";
    a.click();
    URL.revokeObjectURL(url);
    $("settingsMsg").textContent = "Settings exported!";
  });

  $("importBtn").addEventListener("click", () => $("importFile").click());
  $("importFile").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const res = await chrome.runtime.sendMessage({ type: "IMPORT_SETTINGS", json: text });
    $("settingsMsg").textContent = res?.ok ? "Settings imported!" : `Import failed: ${res?.error}`;
    if (res?.ok) {
      await refreshState();
      populateSettingsForm(res.settings);
    }
  });

  $("resetBtn").addEventListener("click", async () => {
    const res = await chrome.runtime.sendMessage({ type: "RESET_SETTINGS" });
    if (res?.ok) {
      $("settingsMsg").textContent = "Reset to defaults!";
      await refreshState();
      populateSettingsForm(res.settings);
    }
  });

  await refreshState();
  setInterval(() => {
    if (activeTabName !== "settings" && activeTabName !== "websites") {
      refreshState();
    }
  }, 1000);
}

init();
