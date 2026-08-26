# Build context is the repo root (see docker-compose.yml) — this single
# image now serves the built SPA, the app's own API (as pb_hooks), and the
# database, so it needs to build the web app and bundle the label-printer
# Python venv too, not just the pocketbase binary.

FROM node:22-bookworm-slim AS web-builder
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json ./web/package.json
RUN pnpm install --frozen-lockfile
COPY web ./web
RUN pnpm build:web


# Debian, not Alpine — brother_ql pins Pillow to 9.5.0 (see print/requirements.txt),
# which doesn't build against the very new Python 3.14 that Alpine's current
# python3 package ships. Debian bookworm's python3 (3.11) is the same
# interpreter version the old app image already built this venv against
# successfully, so stick with it here too.
FROM debian:bookworm-slim
ARG PB_VERSION=0.39.11
# BuildKit sets this automatically (amd64/arm64) to match the build platform —
# matters here since PocketBase ships separate binaries per arch and this
# gets built natively on both Apple Silicon dev machines and amd64 servers.
ARG TARGETARCH

RUN apt-get update \
    && apt-get install -y --no-install-recommends unzip ca-certificates wget \
    && wget "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${TARGETARCH}.zip" -O /tmp/pb.zip \
    && unzip /tmp/pb.zip -d /pb \
    && rm /tmp/pb.zip

# python3 + libusb are for print/print_label.py (brother_ql) — the label
# printer is LAN-connected (tcp://<host>:9100), but brother_ql still touches
# its USB backend on import, so libusb needs to be present.
RUN apt-get install -y --no-install-recommends python3 python3-venv libusb-1.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY pocketbase/pb_migrations /pb/pb_migrations
COPY pocketbase/pb_hooks /pb/pb_hooks
COPY pocketbase/docker-entrypoint.sh /pb/docker-entrypoint.sh
RUN chmod +x /pb/docker-entrypoint.sh /pb/pocketbase

COPY --from=web-builder /app/web/dist /pb/pb_public

COPY print/print_label.py print/requirements.txt /pb/print/
RUN python3 -m venv /pb/print/venv \
    && /pb/print/venv/bin/pip install --no-cache-dir -r /pb/print/requirements.txt

WORKDIR /pb
EXPOSE 3001
ENTRYPOINT ["/pb/docker-entrypoint.sh"]
