-- PR-SCORECARD-2 — Marketing / affiliate link tracking + scorecard drafts.
--
-- Three new tables (affiliate_agents, tracking_links, tracking_link_clicks),
-- two new attribution columns on leads, two new draft columns on
-- scorecard_submissions, and three new enums.
--
-- Schema decisions:
--   * `short_code` is plain ASCII alphanumeric (lowercase) — UNIQUE so
--     collisions are loud at insert time. The service generates 6-char
--     codes with a 5-retry collision-resolution loop.
--   * `click_count` is denormalised on tracking_links — incremented in
--     the same transaction that writes the per-click row. The per-click
--     table is the source of truth for forensics; the counter is for
--     fast index-page rendering.
--   * `leads.tracking_link_id` and `leads.attributed_agent_id` are
--     populated at scorecard-submit time. First-attribution-wins is
--     enforced in code (never overwrite when already set).
--   * `scorecard_submissions.is_draft` defaults to FALSE so EXISTING
--     submitted rows (from PR-SCORECARD-1) remain "submitted" — the
--     draft path is only used by users actively filling the form.

-- ─── Enums ──────────────────────────────────────────────────────────

CREATE TYPE "MarketingChannelType" AS ENUM (
  'INSTAGRAM',
  'LINKEDIN',
  'YOUTUBE',
  'TWITTER',
  'WHATSAPP',
  'EMAIL',
  'WIX_HOMEPAGE',
  'TELEGRAM',
  'TIKTOK',
  'FACEBOOK',
  'DIRECT',
  'OTHER'
);

CREATE TYPE "AffiliateAgentStatus" AS ENUM (
  'ACTIVE',
  'PAUSED',
  'TERMINATED'
);

CREATE TYPE "TrackingLinkStatus" AS ENUM (
  'ACTIVE',
  'ARCHIVED'
);

-- ─── affiliate_agents ──────────────────────────────────────────────

CREATE TABLE "affiliate_agents" (
  "id"            TEXT                   NOT NULL,
  "fullName"      VARCHAR(200)           NOT NULL,
  "email"         VARCHAR(200),
  "phone"         VARCHAR(64),
  "status"        "AffiliateAgentStatus" NOT NULL DEFAULT 'ACTIVE',
  "notes"         TEXT,
  "createdById"   TEXT                   NOT NULL,
  "createdAt"     TIMESTAMP(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3)           NOT NULL,

  CONSTRAINT "affiliate_agents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "affiliate_agents_status_fullName_idx"
  ON "affiliate_agents"("status", "fullName");

ALTER TABLE "affiliate_agents"
  ADD CONSTRAINT "affiliate_agents_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

-- ─── tracking_links ────────────────────────────────────────────────

CREATE TABLE "tracking_links" (
  "id"            TEXT                   NOT NULL,
  "shortCode"     VARCHAR(16)            NOT NULL,
  "channel"       "MarketingChannelType" NOT NULL,
  "agentId"       TEXT,
  "campaignLabel" VARCHAR(200),
  "destination"   TEXT                   NOT NULL,
  "status"        "TrackingLinkStatus"   NOT NULL DEFAULT 'ACTIVE',
  "clickCount"    INTEGER                NOT NULL DEFAULT 0,
  "createdById"   TEXT                   NOT NULL,
  "createdAt"     TIMESTAMP(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archivedAt"    TIMESTAMP(3),

  CONSTRAINT "tracking_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tracking_links_shortCode_key"
  ON "tracking_links"("shortCode");

CREATE INDEX "tracking_links_channel_createdAt_idx"
  ON "tracking_links"("channel", "createdAt");

CREATE INDEX "tracking_links_agentId_createdAt_idx"
  ON "tracking_links"("agentId", "createdAt");

CREATE INDEX "tracking_links_status_createdAt_idx"
  ON "tracking_links"("status", "createdAt");

ALTER TABLE "tracking_links"
  ADD CONSTRAINT "tracking_links_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "tracking_links"
  ADD CONSTRAINT "tracking_links_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "affiliate_agents"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── tracking_link_clicks ──────────────────────────────────────────

CREATE TABLE "tracking_link_clicks" (
  "id"         TEXT         NOT NULL,
  "linkId"     TEXT         NOT NULL,
  "clickedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ipAddress"  VARCHAR(64),
  "userAgent"  TEXT,
  "referer"    TEXT,

  CONSTRAINT "tracking_link_clicks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tracking_link_clicks_linkId_clickedAt_idx"
  ON "tracking_link_clicks"("linkId", "clickedAt");

ALTER TABLE "tracking_link_clicks"
  ADD CONSTRAINT "tracking_link_clicks_linkId_fkey"
  FOREIGN KEY ("linkId") REFERENCES "tracking_links"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── leads — attribution columns ───────────────────────────────────

ALTER TABLE "leads"
  ADD COLUMN "trackingLinkId"    TEXT,
  ADD COLUMN "attributedAgentId" TEXT;

CREATE INDEX "leads_attributedAgentId_idx" ON "leads"("attributedAgentId");
CREATE INDEX "leads_trackingLinkId_idx"    ON "leads"("trackingLinkId");

ALTER TABLE "leads"
  ADD CONSTRAINT "leads_trackingLinkId_fkey"
  FOREIGN KEY ("trackingLinkId") REFERENCES "tracking_links"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "leads"
  ADD CONSTRAINT "leads_attributedAgentId_fkey"
  FOREIGN KEY ("attributedAgentId") REFERENCES "affiliate_agents"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── scorecard_submissions — draft columns ─────────────────────────

ALTER TABLE "scorecard_submissions"
  ADD COLUMN "isDraft"          BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN "draftLastSavedAt" TIMESTAMP(3);

-- Composite index for the "find the user's open draft" lookup.
CREATE INDEX "scorecard_submissions_userId_isDraft_idx"
  ON "scorecard_submissions"("userId", "isDraft");
