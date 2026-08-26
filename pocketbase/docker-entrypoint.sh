#!/bin/sh
set -e
cd /pb

# Idempotent — creates the account on first boot, updates its password on
# every boot after if PB_SUPERUSER_PASSWORD changed. Safe to run every time.
./pocketbase superuser upsert "$PB_SUPERUSER_EMAIL" "$PB_SUPERUSER_PASSWORD"

exec ./pocketbase serve --http="0.0.0.0:${PORT:-3001}"
