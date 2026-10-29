#!/bin/sh
# Runs PocketBase locally against this repo's hooks and migrations, for
# `pnpm dev:web` to proxy to. Downloads the same version the Dockerfile pins
# into .pb/ the first time. Data lives in .pb/pb_data (gitignored).
#
#   scripts/dev-pocketbase.sh            # serve on :3001
#   scripts/dev-pocketbase.sh superuser upsert you@example.com 'a-long-password'
set -e
cd "$(dirname "$0")/.."

PB_VERSION=$(sed -n 's/^ARG PB_VERSION=//p' pocketbase/Dockerfile)
BIN=.pb/pocketbase-$PB_VERSION

if [ ! -x "$BIN" ]; then
  case "$(uname -s)" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    *) echo "Unsupported OS: $(uname -s)" >&2; exit 1 ;;
  esac
  case "$(uname -m)" in
    arm64 | aarch64) arch=arm64 ;;
    x86_64 | amd64) arch=amd64 ;;
    *) echo "Unsupported CPU: $(uname -m)" >&2; exit 1 ;;
  esac
  mkdir -p .pb
  echo "Downloading PocketBase $PB_VERSION ($os/$arch)…"
  curl -fsSL -o .pb/pb.zip "https://github.com/pocketbase/pocketbase/releases/download/v$PB_VERSION/pocketbase_${PB_VERSION}_${os}_${arch}.zip"
  unzip -o -q .pb/pb.zip pocketbase -d .pb
  mv .pb/pocketbase "$BIN"
  rm .pb/pb.zip
fi

# PDFs are drawn by print/r2_pdf.py and labels sent by print/print_label.py,
# so give them a venv the first time.
VENV=.pb/venv
if [ ! -x "$VENV/bin/python" ]; then
  if command -v python3 >/dev/null 2>&1; then
    echo "Setting up Python for PDFs in $VENV…"
    python3 -m venv "$VENV" && "$VENV/bin/pip" install --quiet -r print/requirements-pdf.txt \
      || echo "Couldn't set up Python; PDF downloads won't work locally (everything else will)."
  else
    echo "No python3 found; PDF downloads won't work locally (everything else will)."
  fi
fi
# Label printing: brother_ql without its pinned Pillow 9.5, which won't
# install on new Pythons — print_label.py makes it work with the current
# Pillow. Also done for venvs made before printing was set up here.
if [ -x "$VENV/bin/python" ] && ! "$VENV/bin/python" -c "import brother_ql" >/dev/null 2>&1; then
  echo "Setting up label printing in $VENV…"
  grep -v -i '^pillow' print/requirements.txt | "$VENV/bin/pip" install --quiet --no-deps -r /dev/stdin \
    || echo "Couldn't set up label printing; PDFs still work."
fi
export R2_PYTHON="$PWD/$VENV/bin/python"
export R2_PRINT_DIR="$PWD/print"
# No mail server locally to verify addresses with, so let invitations be
# accepted without (production checks the address is verified).
export R2_DEV_TRUST_EMAILS=1
# Links in emails point at the Vite dev server, which proxies to this one.
export R2_APP_URL="${R2_APP_URL:-http://localhost:5173}"

FLAGS="--dir .pb/pb_data --hooksDir pocketbase/pb_hooks --migrationsDir pocketbase/pb_migrations"
if [ $# -gt 0 ]; then
  exec "$BIN" "$@" $FLAGS
fi

# Without a superuser, PocketBase opens its "create a superuser" page in the
# browser every time it starts. Make one for this local database instead,
# saved in .pb/superuser.txt (`pnpm seed:demo` reads it from there).
SUPERUSER_FILE=.pb/superuser.txt
if [ ! -f "$SUPERUSER_FILE" ]; then
  EMAIL="${PB_SUPERUSER_EMAIL:-dev@example.com}"
  PASSWORD="${PB_SUPERUSER_PASSWORD:-$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 20)}"
  "$BIN" superuser upsert "$EMAIL" "$PASSWORD" $FLAGS >/dev/null
  printf '%s %s\n' "$EMAIL" "$PASSWORD" >"$SUPERUSER_FILE"
  echo "Local PocketBase superuser: $EMAIL / $PASSWORD (saved in $SUPERUSER_FILE)"
fi

# Hooks aren't reloaded on save: on macOS, PocketBase loading the hook files
# itself fires the "changed" events its watcher listens for, so with the
# watcher on it restarts itself every few seconds, forever. Restart this
# script after editing anything in pocketbase/pb_hooks.
exec "$BIN" serve --hooksWatch=false --http "127.0.0.1:${PORT:-3001}" $FLAGS
