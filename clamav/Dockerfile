# PR-AV slice 2 — the platform's malware scanner.
#
# Built from the stock image rather than replacing it: the upstream image knows
# how to run clamd and freshclam together, and reproducing that is not a thing
# we want to own. All this adds is a hardened config and a first-boot seed for
# the signature volume.
#
# Deployed as the `clamav` service on Railway, private network only, no ingress.
# Railway builds this from the repo with root directory `clamav/`.
FROM clamav/clamav:stable

# ── 1. Hardening ───────────────────────────────────────────────────────────
# Surgical: delete any existing line for each directive we set, then append our
# block. Replacing the whole clamd.conf would also drop the socket, user and
# logging settings the container needs to boot.
COPY hardening.conf /tmp/hardening.conf
RUN set -eu; \
    conf=/etc/clamav/clamd.conf; \
    grep -oE '^[A-Za-z][A-Za-z0-9]*' /tmp/hardening.conf | sort -u | while read -r directive; do \
      sed -i -E "/^[[:space:]]*${directive}[[:space:]]+/d" "$conf"; \
    done; \
    cat /tmp/hardening.conf >> "$conf"; \
    rm -f /tmp/hardening.conf

# Fail the BUILD, not the deploy, if the config is unparseable or a directive
# did not take. A clamd that will not start is a platform-wide upload outage,
# because every upload fails closed — that is worth catching here, where the
# previous deployment simply keeps serving.
#
# Asserted against `clamconf` in FULL, not `clamconf -n`. The -n form prints
# only values that DIFFER from the built-in defaults, so a directive we set to
# a default — ScanOLE2, and the four limits pinned at their current values — is
# correctly absent from it. The first version of this check used -n and failed
# the build claiming ScanOLE2 was missing when it was simply already correct.
# Name AND value are compared, which is what we actually care about.
COPY expected-config.txt /tmp/expected-config.txt
RUN set -eu; \
    clamconf > /tmp/conf.out 2>&1 || { echo 'clamconf failed to parse the config:'; cat /tmp/conf.out; exit 1; }; \
    fail=0; \
    while IFS='=' read -r name value; do \
      case "$name" in ''|\#*) continue ;; esac; \
      if grep -qE "^${name}[[:space:]]*=[[:space:]]*\"?${value}\"?[[:space:]]*$" /tmp/conf.out; then \
        echo "  ok   ${name} = ${value}"; \
      else \
        echo "  FAIL ${name}: expected ${value}, clamd reports: $(grep -E "^${name}[[:space:]]*=" /tmp/conf.out || echo '<absent>')"; \
        fail=1; \
      fi; \
    done < /tmp/expected-config.txt; \
    [ "$fail" -eq 0 ] || { echo '--- clamd full parsed config ---'; cat /tmp/conf.out; exit 1; }; \
    rm -f /tmp/conf.out /tmp/expected-config.txt

# ── 2. First-boot seed for the signature volume ────────────────────────────
# A Railway volume mounted at /var/lib/clamav starts EMPTY and masks the
# database the image ships with. Without this, the first boot after attaching it
# has clamd waiting on freshclam to pull ~350 MB before answering — and since
# every upload now fails closed, that wait is a platform-wide upload outage
# rather than a slow start.
#
# So the database is copied aside at build time (before any volume exists), and
# seed-and-start.sh moves it into the volume the single time the volume is
# empty. Every later deploy finds it populated and does nothing, which is the
# whole point of attaching it.
#
# (An earlier attempt at this appeared to break container start. It did not —
# the deployments were failing on the backend's railway.json being applied to
# this service, which is fixed in clamav/railway.json.)
RUN cp -a /var/lib/clamav /var/lib/clamav-seed

COPY seed-and-start.sh /usr/local/bin/seed-and-start.sh
RUN chmod +x /usr/local/bin/seed-and-start.sh

# The upstream entrypoint is /init and there is no CMD; seed-and-start.sh execs
# it verbatim so freshclam + clamd still start exactly as upstream intends.
ENTRYPOINT ["/usr/local/bin/seed-and-start.sh"]
