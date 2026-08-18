#!/bin/sh
# PR-AV slice 2 — seed the signature volume, then hand over to the image's own
# init unchanged.
#
# Why this exists. A Railway volume mounted at /var/lib/clamav starts EMPTY,
# which masks the signature database the image ships with. Without this, the
# very first boot after attaching the volume has clamd waiting on freshclam to
# pull ~350 MB before it will answer at all — and because every upload on the
# platform now fails closed, that wait is a platform-wide upload outage rather
# than a slow start.
#
# So: the Dockerfile copies the baked-in database aside at build time, and this
# copies it into the volume the one time the volume is empty. freshclam then
# does an incremental update from a recent baseline instead of a cold download.
# On every later deploy the volume already has the database and this is a no-op,
# which is the whole point of attaching it.
set -eu

SEED=/var/lib/clamav-seed
DB=/var/lib/clamav

if [ -d "$SEED" ] && [ -z "$(ls -A "$DB" 2>/dev/null || true)" ]; then
  echo "[seed] $DB is empty — seeding from the image's baked-in database"
  cp -a "$SEED/." "$DB/" || echo "[seed] WARNING: seeding failed; freshclam will download from scratch"
  echo "[seed] seeded: $(ls -1 "$DB" 2>/dev/null | tr '\n' ' ')"
else
  echo "[seed] $DB already populated — leaving it alone"
fi

exec /init "$@"
