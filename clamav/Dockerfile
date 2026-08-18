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
RUN set -eu; \
    clamconf -n > /tmp/conf.out 2>&1 || { echo 'clamconf failed to parse clamd.conf:'; cat /tmp/conf.out; exit 1; }; \
    for expect in 'AlertEncrypted' 'AlertEncryptedArchive' 'AlertEncryptedDoc' 'ScanOLE2' 'OLE2BlockMacros' 'StreamMaxLength' 'AlertExceedsMax'; do \
      grep -qi "^${expect}[[:space:]]*=" /tmp/conf.out || { echo "MISSING from clamd's own parsed config: ${expect}"; cat /tmp/conf.out; exit 1; }; \
    done; \
    echo '── clamd parsed config (non-default values) ──'; cat /tmp/conf.out; rm -f /tmp/conf.out

# ── 2. First-boot seed for the signature volume ────────────────────────────
# Copied at build time, i.e. before any volume is mounted over /var/lib/clamav.
RUN cp -a /var/lib/clamav /var/lib/clamav-seed

COPY seed-and-start.sh /usr/local/bin/seed-and-start.sh
RUN chmod +x /usr/local/bin/seed-and-start.sh

# The upstream entrypoint is /init and there is no CMD; seed-and-start.sh execs
# it verbatim so freshclam + clamd still start exactly as upstream intends.
ENTRYPOINT ["/usr/local/bin/seed-and-start.sh"]
