# Filestash Caption Plugin — Research & Approach

## Goal

Add two pieces of native Filestash functionality:

1. **CAPTION action** — a button in the file-browser toolbar that sends selected images to the captioner via Kafka.
2. **Info-panel caption** — when an image is opened, its generated caption is displayed in the metadata/info panel.

"Native" means compiled into the Filestash binary as a Go plugin, not injected via an external proxy.

---

## Filestash Plugin Architecture (research findings)

### How plugins work

- All plugins live under `server/plugin/plg_*/`.
- Each plugin registers itself through side-effects in an `init()` function.
- The central loader `server/plugin/index.go` blank-imports every plugin:
  ```go
  import _ "github.com/mickael-kerjean/filestash/server/plugin/plg_caption"
  ```
- To add our plugin we must: add the package, add the blank import, and rebuild from source.

### Key hook registrations (from `server/common/plugin.go`)

| Hook | Purpose | Signature |
|------|---------|-----------|
| `Hooks.Register.HttpEndpoint` | Add routes to the Gorilla Mux router | `func(*mux.Router) error` |
| `Hooks.Register.FrontendOverrides` | **Register a JS URL the frontend auto-loads** — this is how we add native UI buttons | `url string` |
| `Hooks.Register.CSS` | Inject CSS into the frontend | `stylesheet string` |
| `Hooks.Register.Static` | Serve an `fs.FS` as static files (uses HttpEndpoint internally) | `www fs.FS, chroot string` |
| `Hooks.Register.Metadata` | Register an `IMetadata` implementation for the info panel | `m IMetadata` |
| `Hooks.Register.XDGOpen` | Inject JS strings for file-open handlers | `jsString string` |
| `Hooks.Register.Onload` | Run a function after all plugins load | `func()` |

### `FrontendOverrides` — the key for native UI injection

The Filestash frontend automatically loads every URL registered via `FrontendOverrides` as a `<script>`. This is how `plg_video_transcoder` injects `/overrides/video-transcoder.js` without touching the JS bundle.

Our plugin will:
1. Embed `caption-plugin.js` with `//go:embed`.
2. Serve it at `/api/plugin/caption/plugin.js` via `HttpEndpoint`.
3. Register that URL via `FrontendOverrides`.

The JS file runs inside the Filestash SPA and has full DOM access. We already know the exact selector for selected files from debugging:
```
a.component_thing.selected[data-path]   →  data-path = /images/subdir/file.png
```

### `IMetadata` — info panel

```go
// server/common/types.go
type IMetadata interface {
    Get(ctx *App, path string) ([]FormElement, error)
    Set(ctx *App, path string, value []FormElement) error
    Search(ctx *App, path string, facets map[string]any) (map[string][]FormElement, error)
}
```

`FormElement` is used throughout Filestash for both form inputs and display fields. From context (e.g., `plg_backend_local`) it has at minimum:

```go
type FormElement struct {
    Name        string      `json:"name"`
    Type        string      `json:"type"`        // "text", "hidden", "password", "long_text", …
    Value       interface{} `json:"value,omitempty"`
    Placeholder string      `json:"placeholder,omitempty"`
    // likely also: Label, Description, ReadOnly, …
}
```

**TODO**: Confirm exact `FormElement` struct by reading source during the Docker build step (the struct is in `server/common/`, likely `model_formElement.go` or similar).

### `App` struct

```go
type App struct {
    Backend       IBackend
    Body          map[string]interface{}
    Session       map[string]string
    Share         Share
    Context       context.Context
    Authorization string
    Languages     []string
}
```

The plugin doesn't need most of these fields; `ctx` is passed for completeness.

---

## Caption data storage format

The captioner already writes output to `/app/output_clip/` (mounted as `/srv/output_clip/` in Filestash). We extend it to also write a sidecar JSON file:

```
/srv/output_clip/<same relative path as input image, extension replaced with .json>
```

Example:
- Input image (Filestash `data-path`): `/images/ライコ/photo.png`
- Caption file: `/srv/output_clip/ライコ/photo.json`
- Content:
  ```json
  {
    "job_id": "caption-1234-abcd",
    "image_path": "/app/images/ライコ/photo.png",
    "caption": "An anime character with blue hair standing in a garden.",
    "timestamp": "2026-03-28T12:00:00Z"
  }
  ```

The plugin's `IMetadata.Get` implementation:
1. Receives `path = "/images/ライコ/photo.png"`.
2. Strips the `/images/` prefix → `ライコ/photo.png`.
3. Replaces extension with `.json` → `ライコ/photo.json`.
4. Reads `/srv/output_clip/ライコ/photo.json`.
5. Returns the caption as a read-only `FormElement`.

---

## Build approach

Filestash has no plug-and-play `.so` plugin loading — the plugin must be compiled into the binary. This requires building from source.

### Dockerfile strategy

```
┌─────────────────────────────────────┐
│  Stage 1: builder (golang + node)   │
│  - git clone filestash              │
│  - COPY plugin/ → server/plugin/    │
│  - patch server/plugin/index.go     │
│  - make build (go + frontend)       │
├─────────────────────────────────────┤
│  Stage 2: runtime (debian slim)     │
│  - COPY binary from builder         │
│  - expose 8334                      │
└─────────────────────────────────────┘
```

The build requires internet access inside Docker (to clone the repo and `go mod download`). Docker daemon networking can reach GitHub even when the WSL shell cannot.

### Files in this project

```
dam/filestash/
├── Dockerfile              ← updated: build from source
├── proxy.Dockerfile        ← filestash-proxy service (Node.js)
├── plugin/
│   └── plg_caption/
│       ├── index.go        ← Go plugin (HttpEndpoint + FrontendOverrides + IMetadata)
│       └── caption-plugin.js  ← embedded JS: adds CAPTION button via FrontendOverrides
├── caption-plugin.js       ← (legacy proxy injection, superseded)
├── config.json
├── README.md
└── plugin.approach.md      ← this file
```

---

## Outstanding unknowns / risks

| Item | Status | Mitigation |
|------|--------|-----------|
| Exact `FormElement` struct fields | Unknown (404 on source fetch) | Inspect during Docker build; worst case write a test and check compilation errors |
| How frontend loads `FrontendOverrides` scripts | Confirmed as `<script>` tags from plugin.go comment + video-transcoder pattern | Should work; test with a `console.log` probe first |
| Frontend selector stability | Confirmed: `a.component_thing.selected[data-path]` | Tested via debug session |
| Docker build internet access | Untested for this machine | Test with a `FROM golang:alpine` + `apk add curl` probe |
| Captioner writing sidecar JSON | Not yet implemented | Needs a small change to the captioner |

---

## Next steps

1. Verify Docker can reach GitHub during build (simple test build).
2. Write `plugin/plg_caption/index.go` and `plugin/plg_caption/caption-plugin.js`.
3. Update `Dockerfile` to build from source.
4. Update captioner to write sidecar `.json` files alongside clip output.
5. Test info-panel display and toolbar button end-to-end.
