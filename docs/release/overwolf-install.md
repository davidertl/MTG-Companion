# MancuTG-ArenaC (Overwolf, Windows)

This is the **Windows-first** windowed MVP for MancuTG-ArenaC. It pairs:

1. **Rust sidecar** — `mancutg-arenac serve` (loopback HTTP on `127.0.0.1`, default port **17890**).
2. **Overwolf web app** — `apps/overwolf/` (Main window plus one focused Overwolf window per side-nav topic).

There is **no in-game overlay** in this MVP.

The app **opens the Main window first** (`main.html`), which shows your last matches plus the live toolbar. Each side-nav entry opens **its own focused Overwolf window** — `imports.html`, `collection.html`, `inventory.html`, `draft.html`, `decks.html`, `diagnostics.html`, `privacy.html`, `settings.html`, plus the existing `setup.html`. The side nav is shared across windows so you can hop between topics from any of them. Use **Connection & log path wizard** inside the Settings window when you need to change the loopback URL or `Player.log` path manually.

## Prerequisites

- Windows 10/11
- [Overwolf](https://www.overwolf.com/) installed
- MTG Arena with **Detailed Logs** enabled (in-game settings), for useful parser output
- Node.js 22+ and Rust stable (for building from source)

## Run from source (developer)

1. Start the sidecar (from repo root):

   ```bash
   cargo run -p mancutg-arenac -- serve
   ```

   Optional: `serve --data-dir "C:\Path\To\Data"` and `MANCUTG_ARENAC_DATA_DIR`.

   On success it writes `mancutg-arenac-service.json` into the data directory with the actual `baseUrl` if the default port was busy.

2. Build the Overwolf bundle:

   ```bash
   npm ci --prefix apps/overwolf
   npm run build --prefix apps/overwolf
   ```

3. Load in Overwolf (development / sideload):

   - Zip the contents of `apps/overwolf/dist` **plus** `mancutg-arenac.exe` (release build from `target/release/`) into one folder, **or** run `scripts/package-overwolf.ps1` to produce `mancutg-arenac-overwolf-0.1.0.zip`.
   - In Overwolf, use **Load unpacked extension** (wording may vary by Overwolf version) and point at the folder that contains `manifest.json`, all per-topic HTML files (`main.html`, `setup.html`, `imports.html`, `collection.html`, `inventory.html`, `draft.html`, `decks.html`, `diagnostics.html`, `privacy.html`, `settings.html`), and `mancutg-arenac.exe`.

4. Launch MTG Arena (optional for UI; required for log activity). Open the app from Overwolf; the **Main** dashboard opens first. Enable **Detailed Logs** in Arena, acknowledge it in the Setup checklist on Main, then use **Start live watcher** if it is not already running (it auto-starts when the sidecar is healthy).

## User-facing notes

- **Player.log** on Windows is usually under:
  `%USERPROFILE%\AppData\LocalLow\Wizards Of The Coast\MTGA\Player.log` (older installs may use an `MTG Arena` folder instead; the sidecar checks common paths).
- The **Setup** window (still shipped as `setup.html`) calls `GET /v1/detect-player-log` on the sidecar to prefill this path when possible.
- **Live watcher** in the Main window polls `POST /v1/watch/tick` every 2 seconds while running; it **starts automatically** when the sidecar responds on the configured URL and a log path is available (you can stop it with **Stop live watcher**).
- **iOS single-file import** uploads log text via `POST /v1/import/log-text` (no server-local path required).
- **iOS folder import** uses `POST /v1/import/ios-folder` and needs a **real folder path** on disk (prompt in UI).

## Uninstall / data

- SQLite DB and settings live under the sidecar data directory (default: `%LOCALAPPDATA%\MancuTG-ArenaC\`).
- Removing the Overwolf app does not automatically delete that data; use **Wipe local data** in the UI or delete the folder manually.

## Code signing

Production `.opk` / installer signing is **out of band** (operator certificate). CI may publish **unsigned** artifacts for testing.

## Smoke test

From repo root (requires `cargo`):

```bash
npm run overwolf:smoke
```
