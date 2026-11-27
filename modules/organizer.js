// modules/organizer.js - Smart folder & filename organization with strict path sanitization

import { normalizeHostname } from "../shared/settings.js";
import { detectFormat, getEffectiveResolution } from "./filter.js";

const GENERIC_NAMES = new Set([
  "video", "stream", "play", "index", "media", "watch",
  "file", "download", "clip", "source", "get", "default", "output",
  "remote_control", "get_file", "player", "embed", "serve", "proxy", "view", "fetch"
]);

const SCRIPT_ENDPOINT_RE = /\.(php|asp|aspx|jsp|cgi|cfm|do|action)$/i;

function shortHash(str) {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").slice(0, 6);
}

export function sanitizeSegment(seg, fallback = "item") {
  if (!seg || typeof seg !== "string") return fallback;
  const cleaned = seg
    .replace(/\.\.+/g, "_")
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, "_")
    .replace(/^\.+|\.+$/g, "")
    .trim()
    .slice(0, 100);
  return cleaned || fallback;
}

export function getDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function extractOriginalName(url, contentType = null, fallbackTitle = null) {
  const format = detectFormat(url, contentType) || "mp4";
  const ext = `.${format}`;
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    let rawName = segments.length ? decodeURIComponent(segments[segments.length - 1]) : "";
    rawName = sanitizeSegment(rawName, "");

    const isScriptEndpoint = SCRIPT_ENDPOINT_RE.test(rawName);
    const extMatch = rawName.match(/\.(mp4|webm|ogg|mov|m4v)$/i);
    if (extMatch) {
      rawName = rawName.slice(0, -extMatch[0].length);
    } else if (isScriptEndpoint) {
      rawName = rawName.replace(SCRIPT_ENDPOINT_RE, "");
    }

    let stem = rawName;
    const isGeneric = !stem || isScriptEndpoint || GENERIC_NAMES.has(stem.toLowerCase());
    if (isGeneric) {
      const cleanTitle = fallbackTitle
        ? sanitizeSegment(fallbackTitle.replace(/\s+/g, "_"), "").slice(0, 60)
        : "";
      if (cleanTitle && !GENERIC_NAMES.has(cleanTitle.toLowerCase())) {
        stem = `${cleanTitle}_${shortHash(url)}`;
      } else {
        const parent = segments.length >= 2 ? sanitizeSegment(decodeURIComponent(segments[segments.length - 2]), "") : "";
        const base = stem && !isScriptEndpoint ? stem : "video";
        stem = parent && !GENERIC_NAMES.has(parent.toLowerCase())
          ? `${parent}_${base}_${shortHash(url)}`
          : `${base}_${shortHash(url)}`;
      }
    } else if (parsed.search) {
      stem = `${stem}_${shortHash(url)}`;
    }
    return { stem: sanitizeSegment(stem, "video"), ext };
  } catch {
    return { stem: `video_${shortHash(String(url))}`, ext };
  }
}

export function buildDownloadPath(videoMeta, settings, pageHostname = "", date = new Date()) {
  const base = sanitizeSegment(settings.baseFolder || "SmartVideoDownloader", "SmartVideoDownloader");
  const site = sanitizeSegment(normalizeHostname(pageHostname) || "unknown-site", "unknown-site");
  const dateStr = getDateString(date);
  const res = getEffectiveResolution(videoMeta);
  const resLabel = res ? `${res}p` : "unknown";
  const { stem, ext } = extractOriginalName(videoMeta.url, videoMeta.contentType, videoMeta.title);

  // Build folder path segments (strictly relative, no path traversal)
  const folderParts = [base];
  switch (settings.folderStructure) {
    case "flat":
      break;
    case "website":
      folderParts.push(site);
      break;
    case "date":
      folderParts.push(dateStr);
      break;
    case "website_date":
      folderParts.push(site, dateStr);
      break;
    case "custom": {
      const rawTemplate = (settings.customFolderTemplate || "{site}/{date}")
        .replace(/\{site\}/gi, site)
        .replace(/\{date\}/gi, dateStr)
        .replace(/\{res\}/gi, resLabel);
      for (const part of rawTemplate.split(/[\\/]+/)) {
        const safe = sanitizeSegment(part, "");
        if (safe) folderParts.push(safe);
      }
      break;
    }
    default:
      folderParts.push(site, dateStr);
  }

  // Build filename stem
  let finalStem = stem;
  switch (settings.filenameMode) {
    case "site_original":
      finalStem = `${site}_${stem}`;
      break;
    case "date_original":
      finalStem = `${dateStr}_${stem}`;
      break;
    case "resolution_original":
      finalStem = `${stem}_${resLabel}`;
      break;
    case "custom": {
      const tpl = (settings.customFilenameTemplate || "{site}_{name}_{res}")
        .replace(/\{site\}/gi, site)
        .replace(/\{date\}/gi, dateStr)
        .replace(/\{name\}/gi, stem)
        .replace(/\{res\}/gi, resLabel);
      finalStem = sanitizeSegment(tpl, stem);
      break;
    }
    case "original":
    default:
      finalStem = stem;
  }

  const filename = `${sanitizeSegment(finalStem, "video")}${ext}`;
  const fullPath = `${folderParts.join("/")}/${filename}`;
  return { fullPath, filename };
}
