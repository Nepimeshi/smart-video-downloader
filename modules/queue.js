// modules/queue.js - Persistent, concurrency-scheduled download queue with retry & MV3 reconciliation

import { buildDownloadPath } from "./organizer.js";
import { detectFormat, getEffectiveResolution } from "./filter.js";
import { addHistoryEntry } from "./history.js";

const QUEUE_STORAGE_KEY = "downloadQueue";

const NON_RECOVERABLE_ERRORS = new Set([
  "USER_CANCELED",
  "FILE_ACCESS_DENIED",
  "FILE_NO_SPACE",
  "FILE_NAME_TOO_LONG",
  "FILE_TOO_LARGE",
  "FILE_VIRUS_INFECTED",
  "SERVER_FORBIDDEN",
  "SERVER_UNAUTHORIZED",
  "SERVER_BAD_CONTENT"
]);

export class DownloadQueue {
  constructor({ onNotify = null } = {}) {
    this.items = []; // Array of queue items
    this.onNotify = onNotify;
    this.initialized = false;
    this._batchCompletedCount = 0;
  }

  async init() {
    if (this.initialized) return;
    this.initialized = true;
    const stored = await chrome.storage.local.get(QUEUE_STORAGE_KEY);
    if (Array.isArray(stored[QUEUE_STORAGE_KEY])) {
      this.items = stored[QUEUE_STORAGE_KEY];
    }
    await this.reconcileWithChrome();
  }

  async persist() {
    await chrome.storage.local.set({ [QUEUE_STORAGE_KEY]: this.items.slice(0, 100) });
  }

  async reconcileWithChrome() {
    if (typeof chrome === "undefined" || !chrome.downloads?.search) return;
    const activeIds = this.items
      .filter((i) => i.downloadId != null && (i.state === "downloading" || i.state === "paused"))
      .map((i) => i.downloadId);

    if (activeIds.length === 0) return;

    const chromeItems = await chrome.downloads.search({});
    const byId = new Map(chromeItems.map((c) => [c.id, c]));

    let changed = false;
    for (const item of this.items) {
      if (item.downloadId == null) continue;
      const c = byId.get(item.downloadId);
      if (!c) continue;
      if (c.state === "complete" && item.state !== "complete") {
        item.state = "complete";
        item.bytesReceived = c.totalBytes || c.bytesReceived || item.fileSizeBytes || 0;
        item.totalBytes = c.totalBytes || item.fileSizeBytes || 0;
        item.speedBps = 0;
        item.etaSec = 0;
        changed = true;
      } else if (c.state === "interrupted" && item.state !== "failed" && item.state !== "cancelled") {
        item.state = c.error === "USER_CANCELED" ? "cancelled" : "failed";
        item.error = c.error || "Interrupted";
        item.speedBps = 0;
        changed = true;
      } else if (c.state === "in_progress") {
        item.state = c.paused ? "paused" : "downloading";
        item.bytesReceived = c.bytesReceived || 0;
        item.totalBytes = c.totalBytes || item.fileSizeBytes || 0;
        changed = true;
      }
    }
    if (changed) await this.persist();
  }

  hasUrl(url) {
    return this.items.some(
      (i) => i.url === url && ["queued", "downloading", "paused", "complete"].includes(i.state)
    );
  }

  getActiveCount() {
    return this.items.filter((i) => i.state === "downloading").length;
  }

  async enqueue(videoMeta, settings, pageHostname = "") {
    await this.init();
    if (this.hasUrl(videoMeta.url)) {
      return { ok: false, duplicate: true, error: "Already in queue or downloaded" };
    }

    const { fullPath, filename } = buildDownloadPath(videoMeta, settings, pageHostname);
    const item = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      downloadId: null,
      url: videoMeta.url,
      filename,
      fullPath,
      website: pageHostname || "unknown",
      resolution: getEffectiveResolution(videoMeta),
      fileSizeBytes: videoMeta.fileSizeBytes || 0,
      duration: videoMeta.duration || null,
      format: videoMeta.format || detectFormat(videoMeta.url, videoMeta.contentType) || "mp4",
      state: "queued", // queued | downloading | paused | complete | failed | cancelled
      bytesReceived: 0,
      totalBytes: videoMeta.fileSizeBytes || 0,
      speedBps: 0,
      etaSec: null,
      lastSampleBytes: 0,
      lastSampleTime: Date.now(),
      retries: 0,
      error: null,
      createdAt: Date.now()
    };

    this.items.unshift(item);
    await this.persist();
    await this.schedule(settings);
    return { ok: true, item };
  }

  async schedule(settings) {
    if (settings.paused) return;
    const limit = Number(settings.maxConcurrentDownloads) || 3;
    let active = this.getActiveCount();

    // Start oldest queued items first (FIFO)
    const queued = [...this.items].reverse().filter((i) => i.state === "queued");
    for (const item of queued) {
      if (active >= limit) break;
      const started = await this._startChromeDownload(item, settings);
      if (started) active++;
    }
    await this.persist();
  }

  _startChromeDownload(item, settings) {
    item.state = "downloading";
    item.error = null;
    item.lastSampleTime = Date.now();
    item.lastSampleBytes = 0;

    return new Promise((resolve) => {
      chrome.downloads.download(
        {
          url: item.url,
          filename: item.fullPath,
          conflictAction: "uniquify",
          saveAs: false
        },
        async (downloadId) => {
          if (chrome.runtime.lastError || downloadId === undefined) {
            item.state = "failed";
            item.error = chrome.runtime.lastError?.message || "Failed to start download";
            await addHistoryEntry({ ...item, status: "failed" }, settings);
            this._notify("onFail", "Download Failed", `${item.filename}: ${item.error}`, settings);
            await this.persist();
            resolve(false);
            return;
          }
          item.downloadId = downloadId;
          await this.persist();
          resolve(true);
        }
      );
    });
  }

  async handleDownloadDelta(delta, settings) {
    await this.init();
    const item = this.items.find((i) => i.downloadId === delta.id);
    if (!item) return;

    if (delta.paused?.current !== undefined) {
      item.state = delta.paused.current ? "paused" : "downloading";
    }

    if (delta.state?.current === "complete") {
      item.state = "complete";
      item.speedBps = 0;
      item.etaSec = 0;
      if (item.totalBytes > 0) item.bytesReceived = item.totalBytes;
      this._batchCompletedCount++;

      await addHistoryEntry({ ...item, status: "complete" }, settings);
      this._notify("onComplete", "Download Completed", `${item.filename} saved.`, settings);
      await this.persist();
      await this.schedule(settings);

      // Check if queue finished
      const remaining = this.items.filter((i) => i.state === "queued" || i.state === "downloading").length;
      if (remaining === 0) {
        if (this._batchCompletedCount > 1) {
          this._notify(
            "onBatchComplete",
            "Batch Downloads Completed",
            `${this._batchCompletedCount} videos finished downloading.`,
            settings
          );
        } else {
          this._notify("onQueueFinished", "Queue Finished", "All queued downloads have completed.", settings);
        }
        this._batchCompletedCount = 0;
      }
      return;
    }

    if (delta.state?.current === "interrupted") {
      const errCode = delta.error?.current || "INTERRUPTED";
      item.speedBps = 0;
      item.etaSec = null;

      if (errCode === "USER_CANCELED") {
        item.state = "cancelled";
        item.error = "Cancelled by user";
        await this.persist();
        await this.schedule(settings);
        return;
      }

      const maxRetries = settings.maxRetries ?? 2;
      if (!NON_RECOVERABLE_ERRORS.has(errCode) && item.retries < maxRetries) {
        item.retries++;
        item.state = "queued";
        item.downloadId = null;
        item.error = `Retrying (${item.retries}/${maxRetries}) after ${errCode}`;
        await this.persist();
        await this.schedule(settings);
        return;
      }

      item.state = "failed";
      item.error = errCode;
      await addHistoryEntry({ ...item, status: "failed" }, settings);
      this._notify("onFail", "Download Failed", `${item.filename}: ${errCode}`, settings);
      await this.persist();
      await this.schedule(settings);
    }
  }

  async refreshProgress() {
    await this.init();
    const active = this.items.filter((i) => i.state === "downloading" && i.downloadId != null);
    if (active.length === 0) return;

    const results = await chrome.downloads.search({ state: "in_progress" });
    const byId = new Map(results.map((r) => [r.id, r]));
    const now = Date.now();

    for (const item of active) {
      const c = byId.get(item.downloadId);
      if (!c) continue;
      const dtSec = Math.max(0.25, (now - (item.lastSampleTime || now)) / 1000);
      const dBytes = Math.max(0, (c.bytesReceived || 0) - (item.lastSampleBytes || 0));
      item.bytesReceived = c.bytesReceived || 0;
      item.totalBytes = c.totalBytes > 0 ? c.totalBytes : item.totalBytes;
      item.speedBps = Math.round(dBytes / dtSec);
      if (item.speedBps > 0 && item.totalBytes > item.bytesReceived) {
        item.etaSec = Math.round((item.totalBytes - item.bytesReceived) / item.speedBps);
      } else {
        item.etaSec = null;
      }
      item.lastSampleBytes = item.bytesReceived;
      item.lastSampleTime = now;
    }
  }

  async pauseItem(id) {
    const item = this.items.find((i) => i.id === id);
    if (!item) return { ok: false };
    if (item.downloadId != null && item.state === "downloading") {
      await new Promise((r) => chrome.downloads.pause(item.downloadId, r));
      item.state = "paused";
    } else if (item.state === "queued") {
      item.state = "paused";
    }
    await this.persist();
    return { ok: true };
  }

  async resumeItem(id, settings) {
    const item = this.items.find((i) => i.id === id);
    if (!item) return { ok: false };
    if (item.downloadId != null && item.state === "paused") {
      await new Promise((r) => chrome.downloads.resume(item.downloadId, r));
      item.state = "downloading";
    } else if (item.state === "paused") {
      item.state = "queued";
      await this.schedule(settings);
    }
    await this.persist();
    return { ok: true };
  }

  async cancelItem(id, settings) {
    const item = this.items.find((i) => i.id === id);
    if (!item) return { ok: false };
    if (item.downloadId != null && (item.state === "downloading" || item.state === "paused")) {
      await new Promise((r) => chrome.downloads.cancel(item.downloadId, r));
    }
    item.state = "cancelled";
    item.error = "Cancelled by user";
    item.speedBps = 0;
    await this.persist();
    await this.schedule(settings);
    return { ok: true };
  }

  async retryItem(id, settings) {
    const item = this.items.find((i) => i.id === id);
    if (!item) return { ok: false };
    item.state = "queued";
    item.downloadId = null;
    item.error = null;
    item.retries = 0;
    await this.persist();
    await this.schedule(settings);
    return { ok: true };
  }

  async removeItem(id) {
    this.items = this.items.filter((i) => i.id !== id);
    await this.persist();
    return { ok: true };
  }

  async clearCompleted() {
    this.items = this.items.filter((i) => i.state !== "complete" && i.state !== "cancelled");
    await this.persist();
    return { ok: true };
  }

  openFile(downloadId) {
    if (downloadId != null) chrome.downloads.open(downloadId);
  }

  showInFolder(downloadId) {
    if (downloadId != null) chrome.downloads.show(downloadId);
  }

  _notify(category, title, message, settings) {
    if (!this.onNotify || !settings?.notifications?.enabled) return;
    if (!settings.notifications[category]) return;
    this.onNotify(title, message);
  }
}
