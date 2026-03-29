# ── Stage 1: builder ──────────────────────────────────────────────────────────
# Clones Filestash from GitHub, injects our caption plugin, and compiles the
# Go binary (frontend assets are plain JS already checked in — no build step).
FROM golang:1.24-bullseye AS builder

ARG FILESTASH_REF=master

RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates \
    libbrotli-dev libraw-dev \
    && rm -rf /var/lib/apt/lists/*

# Allow Go to auto-download the toolchain version required by go.mod
ENV GOTOOLCHAIN=auto

WORKDIR /src

# Clone Filestash at the requested ref
RUN git clone --depth 1 --branch "${FILESTASH_REF}" \
    https://github.com/mickael-kerjean/filestash.git .

# Download Go module dependencies before patching (warm cache layer)
RUN go mod download

# ── Inject our plugin ──────────────────────────────────────────────────────────
COPY plugin/plg_caption/ server/plugin/plg_caption/

# Register the plugin: insert blank import after the last existing plugin import.
RUN sed -i \
    's|_ "github.com/mickael-kerjean/filestash/server/plugin/plg_video_transcoder"|_ "github.com/mickael-kerjean/filestash/server/plugin/plg_video_transcoder"\n\t_ "github.com/mickael-kerjean/filestash/server/plugin/plg_caption"|' \
    server/plugin/index.go

# Generate any code that server packages need, then build
RUN go generate -x ./server/... && \
    go build --tags "fts5" -o /filestash cmd/main.go

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM debian:bullseye-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /filestash /app/filestash

VOLUME ["/app/data"]
EXPOSE 8334

CMD ["/app/filestash"]
