// modules/filter.js - Centralized Smart Video Filtering Engine & Website Rules

import { normalizeHostname } from "../shared/settings.js";

const BYTES_PER_MB = 1024 * 1024;

export const UNSUPPORTED_PATTERNS = [
  { test: (url) => /^blob:/i.test(url), reason: "Inaccessible blob/MSE stream not supported" },
  { test: (url) => /^data:/i.test(url), reason: "Inline data URL not supported" },
  { test: (url) => /\.m3u8(\?|$)/i.test(url), reason: "HLS stream (.m3u8) not supported" },
  { test: (url) => /\.mpd(\?|$)/i.test(url), reason: "DASH stream (.mpd) not supported" }
];

export function detectFormat(url, contentType = null) {
  if (contentType) {
    const ct = contentType.toLowerCase();
    if (ct.includes("mp4")) return "mp4";
    if (ct.includes("webm")) return "webm";
    if (ct.includes("quicktime")) return "mov";
    if (ct.includes("ogg")) return "ogg";
    if (ct.includes("m4v")) return "m4v";
  }
  if (url) {
    const match = url.match(/\.(mp4|webm|mov|ogg|m4v)(\?|$)/i);
    if (match) return match[1].toLowerCase();
  }
  return null;
}

export function getEffectiveResolution(videoMeta) {
  const height = Number(videoMeta?.videoHeight);
  const width = Number(videoMeta?.videoWidth);
  if (Number.isFinite(height) && height > 0) {
    if (Number.isFinite(width) && width > 0) {
      return Math.min(height, width);
    }
    return height;
  }
  return null;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "Unknown";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < BYTES_PER_MB) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < BYTES_PER_MB * 1024) return `${(bytes / BYTES_PER_MB).toFixed(1)} MB`;
  return `${(bytes / (BYTES_PER_MB * 1024)).toFixed(2)} GB`;
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "Unknown";
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function parseAspectRatioString(str) {
  if (!str || str === "any") return null;
  const parts = str.split(":").map(Number);
  if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) {
    return parts[0] / parts[1];
  }
  return null;
}

/**
 * Resolves effective settings for a specific website by layering any per-site profile
 * on top of global defaults. Global master disable always takes precedence.
 */
export function getEffectiveSettingsForSite(pageHostname, settings) {
  const host = normalizeHostname(pageHostname);
  const profile = host && settings.siteProfiles ? settings.siteProfiles[host] : null;
  if (!profile) return { effective: settings, profile: null };

  const effective = { ...settings };
  if (profile.minResolution !== null && profile.minResolution !== undefined) {
    effective.minResolution = profile.minResolution;
  }
  if (profile.minFileSizeMB !== null && profile.minFileSizeMB !== undefined) {
    effective.minFileSizeEnabled = true;
    effective.minFileSizeMB = profile.minFileSizeMB;
  }
  if (profile.maxFileSizeMB !== null && profile.maxFileSizeMB !== undefined) {
    effective.maxFileSizeEnabled = true;
    effective.maxFileSizeMB = profile.maxFileSizeMB;
  }
  if (Array.isArray(profile.allowedFormats) && profile.allowedFormats.length > 0) {
    effective.allowedFormats = profile.allowedFormats;
  }
  return { effective, profile };
}

/**
 * Evaluates website rules with clear precedence:
 * 1. Temporary site pause
 * 2. Per-site profile disabled
 * 3. Blocklist / Allowlist mode
 */
export function isSiteAllowed(pageHostname, settings) {
  const host = normalizeHostname(pageHostname);
  if (!host) return { allowed: false, reason: "Unknown website host" };

  if (Array.isArray(settings.pausedSites) && settings.pausedSites.includes(host)) {
    return { allowed: false, reason: `Detection paused on ${host}` };
  }

  const profile = settings.siteProfiles?.[host];
  if (profile && profile.enabled === false) {
    return { allowed: false, reason: `Automatic downloads disabled for ${host}` };
  }

  if (settings.siteMode === "allowlist") {
    const match = (settings.allowedSites || []).some(
      (a) => host === a || host.endsWith(`.${a}`)
    );
    return match
      ? { allowed: true, reason: `Website ${host} is in allowlist` }
      : { allowed: false, reason: `Website ${host} is not in allowlist` };
  }

  if (settings.siteMode === "blocklist") {
    const blocked = (settings.blockedSites || []).some(
      (b) => host === b || host.endsWith(`.${b}`)
    );
    return blocked
      ? { allowed: false, reason: `Website ${host} is blocked` }
      : { allowed: true, reason: `Website ${host} is not blocked` };
  }

  return { allowed: true, reason: "Website allowed" };
}

/**
 * Centralized smart filter engine.
 * Returns { eligible, unsupported, statusCode, reason, violations[] }
 */
export function evaluateVideo(videoMeta, settings, pageHostname = "") {
  const { effective } = getEffectiveSettingsForSite(pageHostname, settings);
  const policy = effective.unknownPolicy || {};

  if (!videoMeta || !videoMeta.url) {
    return { eligible: false, unsupported: true, statusCode: "unsupported", reason: "Missing video URL", violations: ["Missing video URL"] };
  }

  if (videoMeta.isEncrypted || videoMeta.isDrm) {
    return {
      eligible: false,
      unsupported: true,
      statusCode: "unsupported",
      reason: "DRM / encrypted media not supported",
      violations: ["DRM / encrypted media not supported"]
    };
  }

  for (const rule of UNSUPPORTED_PATTERNS) {
    if (rule.test(videoMeta.url)) {
      return { eligible: false, unsupported: true, statusCode: "unsupported", reason: rule.reason, violations: [rule.reason] };
    }
  }

  if (!/^https?:\/\//i.test(videoMeta.url)) {
    return { eligible: false, unsupported: true, statusCode: "unsupported", reason: "Unsupported URL protocol", violations: ["Unsupported URL protocol"] };
  }

  const violations = [];
  let primaryStatus = "meets_filters";

  const fail = (statusCode, msg) => {
    if (primaryStatus === "meets_filters") primaryStatus = statusCode;
    violations.push(msg);
  };

  // 1. Format filter
  const format = videoMeta.format || detectFormat(videoMeta.url, videoMeta.contentType);
  if (Array.isArray(effective.allowedFormats) && effective.allowedFormats.length > 0) {
    if (format && !effective.allowedFormats.includes(format)) {
      fail("unsupported_format", `Format .${format} excluded by settings`);
    }
  }

  // 2. Resolution filter
  if (effective.minResolution && effective.minResolution > 0) {
    const res = getEffectiveResolution(videoMeta);
    if (res === null) {
      if (policy.resolution !== "allow") {
        fail("unknown_metadata", `Unknown resolution (minimum ${effective.minResolution}p required)`);
      }
    } else if (res < effective.minResolution) {
      fail("below_resolution", `Resolution ${res}p below minimum ${effective.minResolution}p`);
    }
  }

  // 3. Minimum File Size
  if (effective.minFileSizeEnabled && effective.minFileSizeMB > 0) {
    const size = videoMeta.fileSizeBytes;
    if (!Number.isFinite(size) || size <= 0) {
      if (policy.fileSize !== "allow") {
        const extra = videoMeta.metadataError ? ` (${videoMeta.metadataError})` : "";
        fail("unknown_metadata", `Unknown file size${extra} (minimum ${effective.minFileSizeMB} MB required)`);
      }
    } else if (size < effective.minFileSizeMB * BYTES_PER_MB) {
      fail("below_min_size", `File size ${formatBytes(size)} below minimum ${effective.minFileSizeMB} MB`);
    }
  }

  // 4. Maximum File Size
  if (effective.maxFileSizeEnabled && effective.maxFileSizeMB > 0) {
    const size = videoMeta.fileSizeBytes;
    if (!Number.isFinite(size) || size <= 0) {
      if (policy.fileSize !== "allow") {
        fail("unknown_metadata", `Unknown file size (maximum ${effective.maxFileSizeMB} MB enabled)`);
      }
    } else if (size > effective.maxFileSizeMB * BYTES_PER_MB) {
      fail("above_max_size", `File size ${formatBytes(size)} exceeds maximum ${effective.maxFileSizeMB} MB`);
    }
  }

  // 5. Minimum Duration
  if (effective.minDurationEnabled && effective.minDurationSec > 0) {
    const dur = videoMeta.duration;
    if (!Number.isFinite(dur) || dur <= 0) {
      if (policy.duration !== "allow") {
        fail("unknown_metadata", `Unknown duration (minimum ${effective.minDurationSec}s required)`);
      }
    } else if (dur < effective.minDurationSec) {
      fail("duration_rejected", `Duration ${formatDuration(dur)} below minimum ${effective.minDurationSec}s`);
    }
  }

  // 6. Maximum Duration
  if (effective.maxDurationEnabled && effective.maxDurationSec > 0) {
    const dur = videoMeta.duration;
    if (!Number.isFinite(dur) || dur <= 0) {
      if (policy.duration !== "allow") {
        fail("unknown_metadata", `Unknown duration (maximum ${effective.maxDurationSec}s enabled)`);
      }
    } else if (dur > effective.maxDurationSec) {
      fail("duration_rejected", `Duration ${formatDuration(dur)} exceeds maximum ${effective.maxDurationSec}s`);
    }
  }

  // 7. Minimum FPS (only enforced when enabled; distinguishes unknown FPS from low FPS)
  if (effective.minFps && effective.minFps > 0) {
    const fps = Number(videoMeta.fps);
    if (!Number.isFinite(fps) || fps <= 0) {
      if (policy.fps !== "allow") {
        fail("unknown_metadata", `Unknown frame rate (minimum ${effective.minFps} FPS required)`);
      }
    } else if (fps < effective.minFps) {
      fail("below_fps", `Frame rate ${fps} FPS below minimum ${effective.minFps} FPS`);
    }
  }

  // 8. Codec filter
  if (effective.codec && effective.codec !== "any") {
    const codec = (videoMeta.codec || "").toLowerCase();
    if (!codec) {
      if (policy.codec !== "allow") {
        fail("unknown_metadata", `Unknown codec (${effective.codec.toUpperCase()} required)`);
      }
    } else if (!codec.includes(effective.codec.toLowerCase())) {
      fail("codec_rejected", `Codec ${codec} does not match ${effective.codec}`);
    }
  }

  // 9. Aspect Ratio filter
  if (effective.aspectRatio && effective.aspectRatio !== "any") {
    const targetStr = effective.aspectRatio === "custom" ? effective.customAspectRatio : effective.aspectRatio;
    const targetRatio = parseAspectRatioString(targetStr);
    if (targetRatio) {
      const w = Number(videoMeta.videoWidth);
      const h = Number(videoMeta.videoHeight);
      if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
        if (policy.resolution !== "allow") {
          fail("unknown_metadata", `Unknown aspect ratio (${targetStr} required)`);
        }
      } else {
        const actual = w / h;
        if (Math.abs(actual - targetRatio) > 0.12) {
          fail("aspect_rejected", `Aspect ratio ${(actual).toFixed(2)} does not match ${targetStr}`);
        }
      }
    }
  }

  if (violations.length > 0) {
    return {
      eligible: false,
      unsupported: false,
      statusCode: primaryStatus,
      reason: violations[0],
      violations
    };
  }

  return {
    eligible: true,
    unsupported: false,
    statusCode: "meets_filters",
    reason: "Matches all filters",
    violations: []
  };
}

/**
 * Full check for whether a video should be automatically queued right now.
 * Global mode/master switch always overrides per-website settings.
 */
export function shouldAutoDownload(videoMeta, settings, pageHostname, isMetered = false) {
  if (settings.mode === "disabled") {
    return { shouldDownload: false, reason: "Extension is disabled" };
  }
  if (settings.mode === "detection_only" || !settings.autoDownload) {
    return { shouldDownload: false, reason: "Detection Only mode" };
  }
  if (settings.paused) {
    return { shouldDownload: false, reason: "Downloads are paused" };
  }
  if (isMetered && settings.pauseOnMeteredConnection && !settings.overrideMeteredPause) {
    return { shouldDownload: false, reason: "Paused on metered connection" };
  }
  const siteCheck = isSiteAllowed(pageHostname, settings);
  if (!siteCheck.allowed) {
    return { shouldDownload: false, reason: siteCheck.reason };
  }
  const evalResult = evaluateVideo(videoMeta, settings, pageHostname);
  if (!evalResult.eligible) {
    return { shouldDownload: false, reason: evalResult.reason };
  }
  return { shouldDownload: true, reason: "Matches all filters and site rules" };
}
