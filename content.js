// content.js - Intelligent video detector + optional Shadow DOM Floating Detection Panel

(() => {
  const reportedSignatures = new Map();

  const AD_OR_TRACKER_PATTERNS = [
    /doubleclick\.net/i,
    /googlesyndication\.com/i,
    /googleadservices\.com/i,
    /adservice\./i,
    /\/ads?\//i,
    /\/vast\b/i,
    /\/vpaid\b/i,
    /\/pixel\b/i,
    /\/track(er|ing)?\b/i,
    /\/analytics\b/i,
    /\/beacon\b/i
  ];

  const NON_VIDEO_EXT_PATTERN = /\.(jpg|jpeg|png|gif|webp|svg|ico|css|js|json|xml|vtt|srt|html?)(\?|$)/i;

  function isLikelyAdOrIrrelevant(url, videoEl) {
    if (!url) return true;
    if (NON_VIDEO_EXT_PATTERN.test(url)) return true;
    for (const pat of AD_OR_TRACKER_PATTERNS) {
      if (pat.test(url)) return true;
    }
    if (videoEl) {
      const idAndClass = `${videoEl.id || ""} ${videoEl.className || ""}`.toLowerCase();
      if (/\b(ad-video|preroll|midroll|sponsor-ad|ima-ad)\b/.test(idAndClass)) return true;
    }
    return false;
  }

  function resolveUrl(raw) {
    if (!raw || typeof raw !== "string") return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (/^(blob:|data:)/i.test(trimmed)) return trimmed;
    try {
      return new URL(trimmed, window.location.href).href;
    } catch {
      return null;
    }
  }

  // Group different quality versions (e.g. clip_720p.mp4 & clip_1080p.mp4) under one identity key
  function computeGroupKey(url) {
    try {
      const u = new URL(url);
      const normalizedPath = u.pathname
        .replace(/([_\-.])?(144|240|360|480|720|1080|1440|2160)p/gi, "")
        .replace(/([_\-.])?(hd|sd|uhd|4k|low|med|high)/gi, "");
      return `${u.origin}${normalizedPath}`;
    } catch {
      return url;
    }
  }

  function scanPage(forceReportAll = false) {
    const videos = document.querySelectorAll("video");
    const payload = [];

    videos.forEach((video) => {
      const isEncrypted = Boolean(video.mediaKeys);
      const videoWidth = Number.isFinite(video.videoWidth) && video.videoWidth > 0 ? video.videoWidth : null;
      const videoHeight = Number.isFinite(video.videoHeight) && video.videoHeight > 0 ? video.videoHeight : null;
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
      const thumbnail = video.poster ? resolveUrl(video.poster) : null;
      const title = video.title || video.getAttribute("aria-label") || document.title || null;

      const candidateUrls = new Set();
      if (video.currentSrc) candidateUrls.add(video.currentSrc);
      if (video.src) candidateUrls.add(video.src);
      video.querySelectorAll("source").forEach((source) => {
        if (source.src) candidateUrls.add(source.src);
      });

      for (const rawUrl of candidateUrls) {
        const url = resolveUrl(rawUrl);
        if (!url || isLikelyAdOrIrrelevant(url, video)) continue;

        const signature = `${videoWidth || 0}x${videoHeight || 0}|${duration ? Math.round(duration) : 0}|${isEncrypted}`;
        const prevSig = reportedSignatures.get(url);

        if (forceReportAll || prevSig !== signature) {
          reportedSignatures.set(url, signature);
          payload.push({
            url,
            groupKey: computeGroupKey(url),
            thumbnail,
            title,
            videoWidth,
            videoHeight,
            duration,
            isEncrypted,
            pageHostname: window.location.hostname
          });
        }
      }
    });

    if (payload.length > 0) {
      chrome.runtime.sendMessage(
        {
          type: "VIDEOS_DETECTED",
          pageHostname: window.location.hostname,
          videos: payload
        },
        () => {
          void chrome.runtime.lastError;
        }
      );
    }

    return payload.length;
  }

  // Throttled scanner (never starves on busy pages)
  let scanTimer = null;
  function scheduleScan(delay = 300) {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scanPage(false);
    }, delay);
  }

  scanPage(false);

  const observer = new MutationObserver(() => scheduleScan(300));
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src"]
  });

  document.addEventListener("loadedmetadata", () => scheduleScan(100), true);
  document.addEventListener("durationchange", () => scheduleScan(200), true);
  window.addEventListener("scroll", () => scheduleScan(600), { passive: true });

  // Periodic auto-scan every 5 seconds
  setInterval(() => scanPage(false), 5000);

  // ============================================================================
  // Floating Detection Panel (Shadow DOM, top frame only)
  // ============================================================================
  let panelHost = null;
  let shadowRoot = null;
  let panelExpanded = false;
  let panelMinimized = false;
  let panelHidden = false;

  function formatSize(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "?";
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function createFloatingPanel(pos = { right: 16, bottom: 16 }) {
    if (panelHost || window !== window.top) return;

    panelHost = document.createElement("div");
    panelHost.id = "svd-floating-panel-host";
    panelHost.style.cssText = `
      position: fixed;
      right: ${pos.right}px;
      bottom: ${pos.bottom}px;
      z-index: 2147483646;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    `;
    shadowRoot = panelHost.attachShadow({ mode: "open" });

    shadowRoot.innerHTML = `
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        .panel {
          background: rgba(15, 23, 42, 0.95);
          color: #f8fafc;
          border: 1px solid rgba(56, 189, 248, 0.35);
          border-radius: 10px;
          box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
          width: 320px;
          backdrop-filter: blur(8px);
          overflow: hidden;
          font-size: 12px;
        }
        .panel.compact { width: auto; }
        .bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 8px 10px;
          background: rgba(30, 41, 59, 0.9);
          cursor: move;
          user-select: none;
        }
        .title {
          display: flex;
          align-items: center;
          gap: 6px;
          font-weight: 600;
          color: #38bdf8;
        }
        .pill {
          background: #0f172a;
          color: #e2e8f0;
          padding: 2px 6px;
          border-radius: 999px;
          font-size: 11px;
        }
        .actions { display: flex; gap: 4px; }
        button {
          background: #334155;
          color: #f8fafc;
          border: none;
          border-radius: 4px;
          padding: 3px 6px;
          font-size: 11px;
          cursor: pointer;
        }
        button:hover { background: #475569; }
        .btn-dl { background: #0284c7; color: #fff; }
        .btn-dl:hover { background: #0369a1; }
        .body {
          max-height: 260px;
          overflow-y: auto;
          padding: 8px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .item {
          background: #1e293b;
          border-radius: 6px;
          padding: 6px 8px;
          display: flex;
          gap: 8px;
          align-items: center;
        }
        .thumb {
          width: 44px;
          height: 28px;
          object-fit: cover;
          border-radius: 4px;
          background: #0f172a;
          flex-shrink: 0;
        }
        .info { flex: 1; min-width: 0; }
        .name {
          font-weight: 500;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .meta { font-size: 10.5px; color: #94a3b8; }
        .reason { font-size: 10px; color: #fbbf24; }
        .reason.ok { color: #4ade80; }
        .hidden { display: none; }
      </style>
      <div class="panel compact" id="panel">
        <div class="bar" id="dragBar">
          <div class="title">
            <span>SVD</span>
            <span class="pill" id="summary">0 videos</span>
          </div>
          <div class="actions">
            <button id="expandBtn" title="Expand/Collapse">▲</button>
            <button id="hideBtn" title="Hide on this site">✕</button>
          </div>
        </div>
        <div class="body hidden" id="body"></div>
      </div>
    `;

    document.documentElement.appendChild(panelHost);

    const panel = shadowRoot.getElementById("panel");
    const body = shadowRoot.getElementById("body");
    const expandBtn = shadowRoot.getElementById("expandBtn");
    const hideBtn = shadowRoot.getElementById("hideBtn");
    const dragBar = shadowRoot.getElementById("dragBar");

    expandBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      panelExpanded = !panelExpanded;
      panel.classList.toggle("compact", !panelExpanded);
      body.classList.toggle("hidden", !panelExpanded);
      expandBtn.textContent = panelExpanded ? "▼" : "▲";
    });

    hideBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      panelHidden = true;
      panelHost.style.display = "none";
      chrome.runtime.sendMessage({
        type: "HIDE_FLOATING_PANEL_SITE",
        hostname: window.location.hostname
      });
    });

    // Dragging support
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startRight = pos.right;
    let startBottom = pos.bottom;

    dragBar.addEventListener("mousedown", (e) => {
      if (e.target.tagName === "BUTTON") return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      startRight = parseInt(panelHost.style.right, 10) || 16;
      startBottom = parseInt(panelHost.style.bottom, 10) || 16;
    });

    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const dx = startX - e.clientX;
      const dy = startY - e.clientY;
      panelHost.style.right = `${Math.max(8, startRight + dx)}px`;
      panelHost.style.bottom = `${Math.max(8, startBottom + dy)}px`;
    });

    window.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      const right = parseInt(panelHost.style.right, 10) || 16;
      const bottom = parseInt(panelHost.style.bottom, 10) || 16;
      chrome.runtime.sendMessage({
        type: "UPDATE_SETTINGS",
        settings: { floatingPanel: { enabled: true, position: { right, bottom } } }
      });
    });
  }

  function updateFloatingPanel() {
    if (window !== window.top || panelHidden) return;
    chrome.runtime.sendMessage({ type: "GET_FULL_STATE" }, (state) => {
      if (chrome.runtime.lastError || !state) return;
      const fp = state.settings?.floatingPanel;
      const host = window.location.hostname.replace(/^www\./, "").toLowerCase();
      if (!fp?.enabled || fp.hiddenSites?.includes(host) || state.settings?.mode === "disabled") {
        if (panelHost) panelHost.style.display = "none";
        return;
      }

      if ((state.videos?.length || 0) === 0 && !panelHost) return;
      if (!panelHost) createFloatingPanel(fp.position);
      if (!panelHost || !shadowRoot) return;
      panelHost.style.display = "block";

      const summary = shadowRoot.getElementById("summary");
      const activeDl = (state.queue || []).filter((q) => q.state === "downloading").length;
      summary.textContent = `${state.tabStats.detected} det · ${state.tabStats.matching} match${activeDl ? ` · ${activeDl} dl` : ""}`;

      if (!panelExpanded) return;
      const body = shadowRoot.getElementById("body");
      body.innerHTML = "";

      for (const v of state.videos || []) {
        const row = document.createElement("div");
        row.className = "item";

        if (v.thumbnail) {
          const img = document.createElement("img");
          img.className = "thumb";
          img.src = v.thumbnail;
          row.appendChild(img);
        }

        const info = document.createElement("div");
        info.className = "info";
        const name = document.createElement("div");
        name.className = "name";
        name.textContent = v.title || v.url.split("/").pop() || "Video";
        const meta = document.createElement("div");
        meta.className = "meta";
        meta.textContent = `${v.videoHeight ? `${v.videoHeight}p` : "?"} · ${formatSize(v.fileSizeBytes)} · ${(v.format || "mp4").toUpperCase()}`;
        const reason = document.createElement("div");
        reason.className = `reason ${v.status === "matching" || v.status === "downloaded" ? "ok" : ""}`;
        reason.textContent = v.reason;

        info.appendChild(name);
        info.appendChild(meta);
        info.appendChild(reason);
        row.appendChild(info);

        if (!v.unsupported && v.status !== "downloaded") {
          const btn = document.createElement("button");
          btn.className = "btn-dl";
          btn.textContent = "DL";
          btn.addEventListener("click", () => {
            btn.disabled = true;
            btn.textContent = "...";
            chrome.runtime.sendMessage({
              type: "MANUAL_DOWNLOAD",
              url: v.url,
              hostname: window.location.hostname
            });
          });
          row.appendChild(btn);
        }

        body.appendChild(row);
      }
    });
  }

  if (window === window.top) {
    setInterval(updateFloatingPanel, 2500);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "SCAN_PAGE") {
      const count = scanPage(true);
      sendResponse({ ok: true, count });
      return true;
    }
    if (message.type === "TOGGLE_FLOATING_PANEL" && window === window.top) {
      panelHidden = !panelHidden;
      if (!panelHidden) {
        if (!panelHost) createFloatingPanel();
        if (panelHost) panelHost.style.display = "block";
        updateFloatingPanel();
      } else if (panelHost) {
        panelHost.style.display = "none";
      }
      sendResponse({ ok: true });
      return true;
    }
  });
})();
