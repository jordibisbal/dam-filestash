# Filestash

Web-based file browser embedded in the dashboard, used to browse the captioner's input images and output clips.

## Accessing

From the dashboard, use the **Filestash** tab:

- **Open** — opens the file browser, auto-authenticated to `/srv/`
- **Admin** — opens the Filestash admin panel; requires the admin password

Both are proxied through `localhost:3001` so they embed inside the dashboard without leaving the tab.

## Logging in (first time or after session expiry)

When the session prompt appears, enter the **admin password** (see `config.json` → `auth.admin` bcrypt hash; the plain-text password is set at deployment time).

The connection is pre-configured as **local `/srv/`**, which maps to:

| Path in Filestash | Host path |
|---|---|
| `/srv/images/` | `$CAPTIONER_IMAGES_DIR` (input images) |
| `/srv/output_clip/` | `dev/captioner/output_clip/` (captioner output) |

## Captioning images

When browsing files, select one or more images (click to select, Ctrl+click for multiple). A green **📸 CAPTION (n)** button appears in the bottom-right corner. Click it to send each image as a caption job to the Kafka pipeline.

The proxy translates Filestash paths before forwarding to the dashboard:

| Filestash sees | Captioner receives |
|---|---|
| `/srv/images/photo.jpg` | `/app/images/photo.jpg` |

The plugin lives in `caption-plugin.js` and is injected into every Filestash HTML page by the proxy (`src/index.ts`). The proxy runs as the `filestash-proxy` container on port 3001.

## Configuration

`config.json` in this directory is bind-mounted read-write into the container at `/app/data/state/config/config.json`. Changes take effect after restarting the container.

Runtime state (database, logs, certs, search index) is stored under `dev/filestash/data/` and is not tracked in version control.
# dam-filestash
