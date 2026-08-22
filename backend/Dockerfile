FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl
COPY package*.json ./
COPY tsconfig*.json ./
COPY nest-cli.json ./
COPY prisma ./prisma/
RUN npm ci
RUN npx prisma generate
COPY src ./src/
RUN npm run build

# PR-PHASE40 — pg_dump for the pre-migration backup.
#
# Production Postgres is 18.4, and pg_dump refuses to dump a server newer than
# itself, so 18 is the floor. Alpine's stable branches only package up to
# postgresql17-client, so the binary is lifted out of the official postgres:18
# image rather than pulled from alpine edge — mixing an edge repo into a stable
# base can drag musl along with it and break node.
FROM postgres:18-alpine AS pgtools

FROM node:22-alpine AS production
WORKDIR /app
# libpq's runtime dependencies. icu/zstd/lz4 are the obvious ones; krb5-libs
# and openldap are the ones that are easy to miss, because libpq links GSSAPI
# and LDAP support unconditionally even though this app uses neither — a first
# attempt without them failed the build on ldap_* and gss_* relocation errors.
RUN apk add --no-cache openssl icu-libs zstd-libs lz4-libs krb5-libs openldap
COPY --from=pgtools /usr/local/bin/pg_dump /usr/local/bin/pg_dump
COPY --from=pgtools /usr/local/lib/libpq.so.5 /usr/local/lib/libpq.so.5
# Runs pg_dump at BUILD time. If a shared library is missing, this fails the
# image build — which leaves the currently-running deploy untouched — instead of
# failing preDeployCommand later and blocking every deploy with a broken image.
RUN pg_dump --version
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci --only=production
RUN npx prisma generate
COPY --from=builder /app/dist ./dist
# Operational maintenance tooling is excluded from the compiled Nest `dist/`
# tree by design. Copy this single reviewed, dependency-free production script
# explicitly; do not copy the whole development scripts directory.
COPY scripts/backfill-lead-attribution.js ./scripts/backfill-lead-attribution.js
# Runtime static assets — engagement-letter PDF + Caladea TTF that
# stampLiaIdentity() reads at every contract send, plus any other
# fixtures under assets/. Without this COPY the container starts
# cleanly but every contract send crashes with ENOENT at first request.
COPY assets ./assets/
# Prove the fonts survived the COPY, at BUILD time — same reasoning as the
# pg_dump check above. A missing or truncated TTF would otherwise start cleanly
# and only surface when a Persian client downloads a readiness report, as an
# ENOENT (or, worse, a PDF of empty boxes). This opens each face with the very
# library pdfkit embeds fonts through and asserts real Persian coverage, so a
# corrupted binary fails the image build and leaves the running deploy alone.
RUN node -e "const fk=require('fontkit');\
for (const f of ['regular','bold','light']) {\
  const p='assets/fonts/vazirmatn-'+f+'.ttf';\
  const n=fk.openSync(p).layout('گزارش آمادگی شما').glyphs.filter(g=>g.id===0).length;\
  if(n) throw new Error(p+': '+n+' missing glyphs');\
  console.log('ok '+p);\
}"
COPY start.sh ./start.sh
RUN chmod +x ./start.sh
CMD ["./start.sh"]
