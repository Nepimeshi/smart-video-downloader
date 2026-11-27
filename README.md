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

## Installation (Load Unpacked in Chrome)

1. Download or clone this repository.
2. Open `chrome://extensions/` in Google Chrome.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select this project folder.
5. Pin **Smart Video Downloader** to your toolbar.

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

MIT — see [LICENSE](LICENSE).
