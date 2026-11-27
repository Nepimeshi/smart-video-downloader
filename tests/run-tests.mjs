// tests/run-tests.mjs - Comprehensive validation suite for Smart Video Downloader v3.0.0
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {
  DEFAULT_SETTINGS,
  sanitizeSettings,
  exportSettingsJson,
  validateAndParseImport
} from "../shared/settings.js";
import { evaluateVideo, shouldAutoDownload, isSiteAllowed } from "../modules/filter.js";
import { MetadataCache } from "../modules/downloader.js";
import { buildDownloadPath } from "../modules/organizer.js";
import { computeHistoryStats, pruneHistory } from "../modules/history.js";

const MB = 1024 * 1024;
let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL: ${name}\n        ${err.message}`);
    process.exitCode = 1;
  }
}

console.log("Running Smart Video Downloader v3.0.0 validation suite...\n");

// 1. Core resolution, size, unknown metadata filtering
await test("Default filters: 1080p/20MB & 720p/8MB pass; 480p/20MB, 1080p/3MB, and unknowns skip", () => {
  assert.equal(
    evaluateVideo({ url: "https://a.com/v.mp4", videoWidth: 1920, videoHeight: 1080, fileSizeBytes: 20 * MB }, DEFAULT_SETTINGS).eligible,
    true
  );
  assert.equal(
    evaluateVideo({ url: "https://a.com/v.webm", videoWidth: 1280, videoHeight: 720, fileSizeBytes: 8 * MB }, DEFAULT_SETTINGS).eligible,
    true
  );
  const lowRes = evaluateVideo({ url: "https://a.com/v.mp4", videoWidth: 854, videoHeight: 480, fileSizeBytes: 20 * MB }, DEFAULT_SETTINGS);
  assert.equal(lowRes.eligible, false);
  assert.equal(lowRes.statusCode, "below_resolution");

  const small = evaluateVideo({ url: "https://a.com/v.mp4", videoWidth: 1920, videoHeight: 1080, fileSizeBytes: 3 * MB }, DEFAULT_SETTINGS);
  assert.equal(small.eligible, false);
  assert.equal(small.statusCode, "below_min_size");

  const unkRes = evaluateVideo({ url: "https://a.com/v.mp4", videoHeight: null, fileSizeBytes: 20 * MB }, DEFAULT_SETTINGS);
  assert.equal(unkRes.eligible, false);
  assert.equal(unkRes.statusCode, "unknown_metadata");
});

// 2. Advanced filters: format, FPS, codec, aspect ratio, duration
await test("Advanced filters: format, FPS, codec, aspect ratio, and duration", () => {
  const s = sanitizeSettings({
    ...DEFAULT_SETTINGS,
    allowedFormats: ["mp4"],
    minFps: 30,
    codec: "h264",
    aspectRatio: "16:9",
    minDurationEnabled: true,
    minDurationSec: 15
  });

  const wrongFmt = evaluateVideo(
    { url: "https://a.com/v.webm", videoWidth: 1920, videoHeight: 1080, fileSizeBytes: 10 * MB, duration: 30, fps: 60, codec: "h264" },
    s
  );
  assert.equal(wrongFmt.eligible, false);
  assert.equal(wrongFmt.statusCode, "unsupported_format");

  const unkFps = evaluateVideo(
    { url: "https://a.com/v.mp4", videoWidth: 1920, videoHeight: 1080, fileSizeBytes: 10 * MB, duration: 30, fps: null, codec: "h264" },
    s
  );
  assert.equal(unkFps.eligible, false);
  assert.equal(unkFps.statusCode, "unknown_metadata");

  const good = evaluateVideo(
    { url: "https://a.com/v.mp4", videoWidth: 1920, videoHeight: 1080, fileSizeBytes: 10 * MB, duration: 30, fps: 60, codec: "h264" },
    s
  );
  assert.equal(good.eligible, true);
});

// 3. Unsupported streams & DRM
await test("Unsupported streams (HLS, DASH, blob, DRM) are skipped", () => {
  assert.equal(evaluateVideo({ url: "https://a.com/live.m3u8" }, DEFAULT_SETTINGS).unsupported, true);
  assert.equal(evaluateVideo({ url: "https://a.com/live.mpd" }, DEFAULT_SETTINGS).unsupported, true);
  assert.equal(evaluateVideo({ url: "blob:https://a.com/abc" }, DEFAULT_SETTINGS).unsupported, true);
  assert.equal(evaluateVideo({ url: "https://a.com/v.mp4", isEncrypted: true }, DEFAULT_SETTINGS).unsupported, true);
});

// 4. Operating modes, metered pause, and per-website profiles
await test("Operating modes, metered pause, website profiles, and global override", () => {
  const v720 = { url: "https://a.com/v.mp4", videoWidth: 1280, videoHeight: 720, fileSizeBytes: 10 * MB };
  const v1080 = { url: "https://a.com/v2.mp4", videoWidth: 1920, videoHeight: 1080, fileSizeBytes: 10 * MB };

  // Detection Only mode never auto-downloads
  assert.equal(shouldAutoDownload(v1080, sanitizeSettings({ mode: "detection_only" }), "a.com").shouldDownload, false);

  // Metered pause
  const meteredSettings = sanitizeSettings({ mode: "automatic", pauseOnMeteredConnection: true });
  assert.equal(shouldAutoDownload(v1080, meteredSettings, "a.com", true).shouldDownload, false);
  assert.equal(shouldAutoDownload(v1080, meteredSettings, "a.com", false).shouldDownload, true);

  // Per-website profile requiring 1080p on a.com
  const profiled = sanitizeSettings({
    mode: "automatic",
    siteProfiles: { "a.com": { enabled: true, minResolution: 1080 } }
  });
  assert.equal(shouldAutoDownload(v720, profiled, "a.com").shouldDownload, false);
  assert.equal(shouldAutoDownload(v1080, profiled, "a.com").shouldDownload, true);

  // Temporary site pause
  const pausedSite = sanitizeSettings({ mode: "automatic", pausedSites: ["a.com"] });
  assert.equal(isSiteAllowed("a.com", pausedSite).allowed, false);
});

// 5. Smart file organization & path-traversal safety
await test("File organization builds safe relative paths and blocks traversal", () => {
  const s = sanitizeSettings({ folderStructure: "website_date", filenameMode: "resolution_original" });
  const date = new Date("2026-11-27T12:00:00Z");
  const { fullPath } = buildDownloadPath(
    { url: "https://cdn.example.com/../../etc/passwd/demo_video.mp4", videoWidth: 1920, videoHeight: 1080 },
    s,
    "example.com",
    date
  );
  assert.equal(fullPath.includes(".."), false);
  assert.equal(fullPath, "SmartVideoDownloader/example.com/2026-11-27/demo_video_1080p.mp4");
});

// 6. History stats & retention pruning
await test("History statistics and retention pruning", () => {
  const now = Date.now();
  const entries = [
    { status: "complete", fileSizeBytes: 10 * MB, website: "a.com", format: "mp4", timestamp: now },
    { status: "complete", fileSizeBytes: 20 * MB, website: "b.com", format: "webm", timestamp: now },
    { status: "failed", fileSizeBytes: 0, website: "a.com", format: "mp4", timestamp: now - 40 * 86400000 }
  ];
  const stats = computeHistoryStats(entries);
  assert.equal(stats.total, 3);
  assert.equal(stats.succeeded, 2);
  assert.equal(stats.failed, 1);
  assert.equal(stats.totalBytes, 30 * MB);
  assert.equal(stats.averageBytes, 15 * MB);

  const pruned = pruneHistory(entries, 30, 500);
  assert.equal(pruned.length, 2);
});

// 7. Settings v2 migration & JSON import/export
await test("Settings v2 migration and JSON export/import validation", () => {
  const migrated = sanitizeSettings({ autoDownload: true, minResolution: 1080, minFileSizeMB: 10 });
  assert.equal(migrated.mode, "automatic");
  assert.equal(migrated.minResolution, 1080);

  const json = exportSettingsJson(migrated);
  const imported = validateAndParseImport(json);
  assert.equal(imported.ok, true);
  assert.equal(imported.settings.minResolution, 1080);
  assert.equal(validateAndParseImport("{bad json").ok, false);
});

// 8. Live HTTP HEAD & Range 0-0 fallback metadata probing
await test("MetadataCache supports HEAD and Range 0-0 fallback with caching", async () => {
  let reqCount = 0;
  const server = http.createServer((req, res) => {
    reqCount++;
    if (req.url === "/head.mp4" && req.method === "HEAD") {
      res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": String(12 * MB) });
      res.end();
    } else if (req.url === "/range.webm") {
      if (req.method === "HEAD") {
        res.writeHead(405);
        res.end();
      } else {
        res.writeHead(206, { "Content-Type": "video/webm", "Content-Range": `bytes 0-0/${8 * MB}` });
        res.end("x");
      }
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  const cache = new MetadataCache();
  try {
    const m1 = await cache.fetchMetadata(`http://127.0.0.1:${port}/head.mp4`);
    const m1c = await cache.fetchMetadata(`http://127.0.0.1:${port}/head.mp4`);
    assert.equal(m1.fileSizeBytes, 12 * MB);
    assert.equal(m1c.fileSizeBytes, 12 * MB);
    assert.equal(reqCount, 1);

    const m2 = await cache.fetchMetadata(`http://127.0.0.1:${port}/range.webm`);
    assert.equal(m2.fileSizeBytes, 8 * MB);
    assert.equal(m2.contentType, "video/webm");
  } finally {
    server.close();
  }
});

// 9. Icon PNG validation
await test("Generated PNG icons exist and have valid PNG headers & dimensions", () => {
  const iconDir = path.resolve("C:/Users/mis/.gemini/antigravity/scratch/auto-video-downloader/assets/icons");
  assert.equal(fs.existsSync(path.join(iconDir, "icon.svg")), true);
  for (const size of [16, 32, 48, 128]) {
    const buf = fs.readFileSync(path.join(iconDir, `icon-${size}.png`));
    assert.equal(buf[0], 137);
    assert.equal(buf.toString("ascii", 1, 4), "PNG");
    assert.equal(buf.readUInt32BE(16), size);
    assert.equal(buf.readUInt32BE(20), size);
  }
});

console.log(`\nCompleted: ${passed} tests passed.`);
