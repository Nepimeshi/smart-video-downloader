# Smart Video Downloader

A Manifest V3 Chrome extension for selectively detecting, filtering, organizing, and downloading direct HTML5 videos (`.mp4`, `.webm`, `.mov`, `.ogg`, `.m4v`).

## Features

- **Intelligent Video Detection**: Scans HTML5 `<video>` and `<source>` elements (including iframes and dynamically/scroll-loaded videos), filters out ads/trackers, groups quality variants, and auto-scans every 5 seconds.
- **Advanced Filtering Engine**: Filter by minimum resolution (`Any`–`2160p`, default `720p`), min/max file size (default `≥5 MB`), min/max duration, allowed formats, minimum FPS, codec, aspect ratio, and configurable unknown-metadata policies (reject by default).
- **Three Operating Modes**: **Automatic**, **Detection Only**, and **Disabled**, plus manual download with filter-violation visibility.
- **Persistent Download Queue**: Configurable concurrency (`1`, `2`, `3`, `5`, `10`), pause/resume/cancel/retry, speed & ETA tracking, open file / show in folder, and MV3 service-worker state reconciliation.
- **Website Profiles & Rules**: Global allowlist/blocklist modes, temporary per-site pause, and per-domain resolution/size/auto-download profiles.
- **Floating Detection Panel**: Optional draggable, collapsible Shadow DOM panel on webpages.
- **Smart File Organization**: Organize into flat, by-website, by-date, by-website-and-date, or custom folder structures with safe filename templates.
- **Download History & Stats**: Searchable history with retention limits and storage statistics (clearing history never deletes downloaded files).
- **Backup & Restore**: Versioned JSON settings export/import and reset-to-defaults.
- **Notifications & Shortcuts**: Configurable desktop notifications and Chrome keyboard shortcuts.

## Installation (Chrome)

Chrome loads unpacked extensions from a **folder** containing `manifest.json` (not a single `.crx` or `.zip` file).

### Step 1: Download the Extension
1. At the top of this GitHub page, click the green **`<> Code`** button.
2. Click **Download ZIP**.
3. Locate the downloaded `smart-video-downloader-main.zip` file on your computer and **extract (unzip)** it to a permanent folder (do not delete this folder after installing, or Chrome will unload the extension).

### Step 2: Load into Chrome
1. Open Google Chrome and go to `chrome://extensions/`.
2. In the top-right corner, turn ON **Developer mode**.
3. In the top-left corner, click **Load unpacked**.
4. Select the extracted folder that contains `manifest.json` (for example, `smart-video-downloader-main`).
5. Click the **Extensions** puzzle icon in Chrome's toolbar and pin **Smart Video Downloader** for quick access.

### Step 3: Start Using It
- Click the **Smart Video Downloader** icon in your toolbar.
- By default it starts in **Detection Only** mode so it won't download anything unexpectedly.
- Switch to **Automatic** mode in the top-right dropdown when you want matching videos to download automatically, or open the **Settings** tab to customize resolution, file size, format, and website rules.

## Default Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Alt+Shift+A` | Toggle Automatic / Detection Only mode |
| `Alt+Shift+P` | Pause or resume all downloads |
| `Alt+Shift+D` | Toggle Detection Only mode |
| `Alt+Shift+F` | Toggle floating video detection panel |

Shortcuts can be customized at `chrome://extensions/shortcuts`.

## Limitations

- Works with **direct HTML5 video files** (`MP4`, `WebM`, `MOV`, `OGG`, `M4V`).
- Does **not** bypass DRM, encrypted media (EME), or download adaptive/segmented streams (HLS `.m3u8`, DASH `.mpd`, or inaccessible `blob:` MediaSource streams such as YouTube or Netflix). Unsupported resources are clearly labeled and skipped.

## Running Tests

Requires Node.js 18+:

```bash
npm test
```

## License

This project is licensed under the [MIT License](LICENSE).
