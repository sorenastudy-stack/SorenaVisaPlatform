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

# ── 2. Volume seeding — NOT here ───────────────────────────────────────────
# An earlier revision copied the baked-in signature database to
# /var/lib/clamav-seed so a freshly attached (empty) volume could be populated
# without a cold ~350 MB download. That doubled the image and the container
# stopped starting at all — INITIALIZING straight to REMOVED, no log output,
# with and without a custom entrypoint. Image size is the difference between
# this and the stock image that works, so it is the suspect.
#
# The hardening is what this change is for, and it is proven at build time.
# Seeding is an optimisation; it comes back only once it can be shown to boot.
