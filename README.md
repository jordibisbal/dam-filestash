# Filestash

Web-based file browser embedded in the dashboard, used to browse the captioner's input images and output clips.

## Architecture

Two containers work together:

| Container | Port | Role |
|---|---|---|
| `filestash` | 8334 (internal) | Vanilla Filestash binary built from source with the caption plugin compiled in |
| `filestash-proxy` | 3001 | Node.js reverse proxy that patches Filestash for iframe embedding |

The dashboard iframe always points to port 3001 (the proxy), never directly to 8334.

## Accessing

From the dashboard, use the **Filestash** tab. The iframe loads `http://localhost:3001/`.

Direct access to `http://localhost:3001/` also works and shows the same patched UI.

## Logging in

When the session prompt appears, enter the **admin password** (see `config.json` → `auth.admin` bcrypt hash; the plain-text password is set at deployment time).

The connection is pre-configured as **local `/srv/`**, which maps to:

| Path in Filestash | Host path |
|---|---|
| `/srv/images/` | `$CAPTIONER_IMAGES_DIR` (input images) |
| `/srv/output_clip/` | `dev/captioner/output_clip/` (captioner output) |

## Captioning images

When browsing files, select one or more images (click to select, Ctrl+click for multiple). A green **📸 CAPTION (n)** button appears in the bottom-right corner. Click it to send each image as a caption job to the Kafka pipeline.

The plugin lives in `plugin/plg_caption/caption-plugin.js`, compiled into the Filestash binary via `FrontendOverrides`. The proxy also injects a `<script src="/api/plugin/caption/plugin.js">` tag into every HTML page as a fallback.

## Proxy: what it does and why (`src/index.ts`)

Filestash was not designed to be embedded in an iframe. The proxy works around all the restrictions:

### 1. Security header stripping
Filestash sets `X-Frame-Options` and `Content-Security-Policy` headers that prevent iframe embedding. The proxy deletes these from every response.

### 2. `accept-encoding: identity`
The proxy forces uncompressed responses so it can read and rewrite response bodies without having to decompress them first.

### 3. CSS injection via MutationObserver (HTML responses)
An inline `<script>` is appended before `</body>` on every HTML page. It:
- Creates a `<style id="__dam_override">` element and appends it to `<head>`.
- Watches for new `<style>` tags added by Filestash's component system (which injects CSS dynamically) via `MutationObserver`, and re-appends our style after each one — ensuring our `!important` rules always win.

CSS rules injected:
- **Remove `max-width: 815px` cap** — Filestash applies this to the content area when the sidebar has class `.hidden` or is `:empty`. Without the override the content is ~800px wide even on a wide screen.
- **Hide `.xmp` sidecar files** — `[data-path$=".xmp" i]` hides XMP metadata files in all view modes.

### 4. JavaScript rewriting (JS responses)
The proxy rewrites strings in every JavaScript response (equivalent to Nginx `sub_filter`):

| Original string | Replaced with | Why |
|---|---|---|
| `window.self !== window.top` | `false` | Filestash's `ctrlSidebar` returns early with no-op when this is true (i.e. when inside an iframe), leaving the sidebar div permanently empty. Replacing with `false` makes Filestash always render the full sidebar. |
| `window.self!==window.top` | `false` | Same check, minified form. |
| `new URL(location.toString()).searchParams.get("nav") === "false"` | `false` | Another early-return guard in `ctrlSidebar` gating on a URL param; neutralised for consistency. |

> **Cache note:** Browsers aggressively cache JS bundles. After rebuilding the proxy, a hard-refresh (Ctrl+Shift+R) or opening a new private window is needed to pick up the rewritten bundle.

### 5. `allow="fullscreen"` on the iframe
The dashboard's `public/tabs/filestash.html` sets `allow="fullscreen"` on the `<iframe>` element. Without this the browser's Permissions Policy blocks fullscreen requests from inside an iframe, causing a JS violation error when opening images in fullscreen mode.

## Configuration

`config.json` in this directory is bind-mounted read-write into the container at `/app/data/state/config/config.json`. Changes take effect after restarting the container.

Runtime state (database, logs, certs, search index) is stored under `dev/filestash/data/` and is not tracked in version control.
