// modules/history.js - Persistent download history & statistics

const STORAGE_KEY = "downloadHistory";

export async function loadHistory() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
}

export async function saveHistory(entries) {
  await chrome.storage.local.set({ [STORAGE_KEY]: entries });
}

export function pruneHistory(entries, retentionDays = 30, maxEntries = 500) {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  return entries
    .filter((e) => (e.timestamp || 0) >= cutoff)
    .slice(0, maxEntries);
}

export async function addHistoryEntry(entry, settings) {
  const current = await loadHistory();
  const next = [
    {
      id: entry.id || `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      downloadId: entry.downloadId ?? null,
      url: entry.url,
      filename: entry.filename,
      fullPath: entry.fullPath || entry.filename,
      website: entry.website || "unknown",
      resolution: entry.resolution || null,
      fileSizeBytes: entry.fileSizeBytes || 0,
      format: entry.format || "mp4",
      status: entry.status || "complete", // "complete" | "failed"
      error: entry.error || null,
      timestamp: entry.timestamp || Date.now()
    },
    ...current
  ];
  const pruned = pruneHistory(
    next,
    settings?.historyRetentionDays || 30,
    settings?.historyMaxEntries || 500
  );
  await saveHistory(pruned);
  return pruned;
}

export async function clearHistory() {
  await saveHistory([]);
  return [];
}

export function computeHistoryStats(entries) {
  let total = entries.length;
  let succeeded = 0;
  let failed = 0;
  let totalBytes = 0;
  const byWebsite = {};
  const byFormat = {};

  for (const e of entries) {
    if (e.status === "complete") {
      succeeded++;
      if (Number.isFinite(e.fileSizeBytes) && e.fileSizeBytes > 0) {
        totalBytes += e.fileSizeBytes;
      }
    } else {
      failed++;
    }
    const site = e.website || "unknown";
    byWebsite[site] = (byWebsite[site] || 0) + 1;
    const fmt = (e.format || "unknown").toLowerCase();
    byFormat[fmt] = (byFormat[fmt] || 0) + 1;
  }

  return {
    total,
    succeeded,
    failed,
    totalBytes,
    averageBytes: succeeded > 0 ? Math.round(totalBytes / succeeded) : 0,
    byWebsite,
    byFormat
  };
}
