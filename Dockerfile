# ── Stage 1: builder ──────────────────────────────────────────────────────────
# Clones Filestash from GitHub, injects our caption plugin, and compiles the
# Go binary (frontend assets are plain JS already checked in — no build step).
FROM golang:1.24-bookworm AS builder

ARG FILESTASH_REF=master

RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates cmake \
    libbrotli-dev libraw-dev libgif-dev \
    libjpeg-dev libpng-dev zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

# Build libwebp from source — Bookworm ships 1.2.4 which predates libsharpyuv.
# Filestash links against -l:libsharpyuv.a so we need 1.3+.
RUN git clone --depth 1 --branch v1.4.0 \
        https://github.com/webmproject/libwebp.git /tmp/libwebp && \
    cmake -B /tmp/libwebp/build -S /tmp/libwebp \
        -DCMAKE_BUILD_TYPE=Release \
        -DBUILD_SHARED_LIBS=OFF \
        -DWEBP_BUILD_ANIM_UTILS=OFF -DWEBP_BUILD_CWEBP=OFF \
        -DWEBP_BUILD_DWEBP=OFF    -DWEBP_BUILD_GIF2WEBP=OFF \
        -DWEBP_BUILD_IMG2WEBP=OFF -DWEBP_BUILD_VWEBP=OFF \
        -DWEBP_BUILD_WEBPINFO=OFF -DWEBP_BUILD_WEBPMUX=OFF \
        -DWEBP_BUILD_EXTRAS=OFF && \
    cmake --build /tmp/libwebp/build --parallel $(nproc) && \
    cmake --install /tmp/libwebp/build && \
    rm -rf /tmp/libwebp

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
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates libbrotli1 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /filestash /app/filestash

VOLUME ["/app/data"]
EXPOSE 8334

CMD ["/app/filestash"]
