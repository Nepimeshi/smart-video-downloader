// modules/downloader.js - Cached metadata probing (HEAD + optional Range 0-0 fallback)

import { extractOriginalName } from "./organizer.js";

export class MetadataCache {
  constructor(maxEntries = 500) {
    this.cache = new Map();
    this.pending = new Map();
    this.maxEntries = maxEntries;
  }

  async fetchMetadata(url, fetchImpl = fetch) {
    if (this.cache.has(url)) return this.cache.get(url);
    if (this.pending.has(url)) return this.pending.get(url);

    const promise = (async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      try {
        const response = await fetchImpl(url, { method: "HEAD", signal: controller.signal });
        clearTimeout(timeoutId);

        if (response.ok) {
          const contentLengthHeader = response.headers.get("content-length");
          const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
          const parsedLength = contentLengthHeader ? Number(contentLengthHeader) : null;
          const fileSizeBytes = Number.isFinite(parsedLength) && parsedLength > 0 ? parsedLength : null;

          if (fileSizeBytes) {
            const result = { fileSizeBytes, contentType: contentType || null, metadataError: null };
            this._set(url, result);
            return result;
          }
        }

        // Fallback: supported 1-byte Range request to read Content-Range total size without downloading video
        const rangeCtrl = new AbortController();
        const rangeTimeout = setTimeout(() => rangeCtrl.abort(), 4000);
        try {
          const rangeRes = await fetchImpl(url, {
            method: "GET",
            headers: { Range: "bytes=0-0" },
            signal: rangeCtrl.signal
          });
          clearTimeout(rangeTimeout);
          if (rangeRes.status === 206 || rangeRes.ok) {
            const cr = rangeRes.headers.get("content-range") || "";
            const match = cr.match(/\/(\d+)$/);
            const contentType = (rangeRes.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
            const total = match ? Number(match[1]) : Number(rangeRes.headers.get("content-length"));
            const fileSizeBytes = Number.isFinite(total) && total > 0 ? total : null;
            const result = { fileSizeBytes, contentType: contentType || null, metadataError: null };
            this._set(url, result);
            return result;
          }
          const result = {
            fileSizeBytes: null,
            contentType: null,
            metadataError: `HTTP ${rangeRes.status}`
          };
          this._set(url, result);
          return result;
        } catch (rangeErr) {
          clearTimeout(rangeTimeout);
          const result = {
            fileSizeBytes: null,
            contentType: null,
            metadataError:
              rangeErr?.name === "AbortError"
                ? "Metadata request timed out"
                : (!response.ok ? `HTTP ${response.status}` : (rangeErr?.message || "Metadata unavailable"))
          };
          this._set(url, result);
          return result;
        }
      } catch (err) {
        clearTimeout(timeoutId);
        const result = {
          fileSizeBytes: null,
          contentType: null,
          metadataError: err?.name === "AbortError" ? "Metadata request timed out" : (err?.message || "Network or CORS error")
        };
        this._set(url, result);
        return result;
      } finally {
        this.pending.delete(url);
      }
    })();

    this.pending.set(url, promise);
    return promise;
  }

  _set(url, value) {
    if (this.cache.size >= this.maxEntries) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(url, value);
  }

  clear() {
    this.cache.clear();
    this.pending.clear();
  }
}

export function getSafeFilename(url, contentType = null) {
  const { stem, ext } = extractOriginalName(url, contentType);
  return `SmartVideoDownloader/${stem}${ext}`;
}
