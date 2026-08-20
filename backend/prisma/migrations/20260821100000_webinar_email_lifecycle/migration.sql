-- PR-WEBINAR-EMAIL — durable lifecycle queue for confirmation, reminders,
-- and the promised post-webinar Scorecard invitation.

CREATE TYPE "WebinarEmailKind" AS ENUM (
  'CONFIRMATION',
  'REMINDER_24H',
  'REMINDER_1H',
  'REMINDER_10M',
  'SCORECARD_FOLLOWUP'
);

CREATE TYPE "WebinarEmailStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'SENT',
  'FAILED',
  'SKIPPED'
);

CREATE TABLE "webinar_email_deliveries" (
  "id" TEXT NOT NULL,
  "registrationId" TEXT NOT NULL,
  "kind" "WebinarEmailKind" NOT NULL,
  "status" "WebinarEmailStatus" NOT NULL DEFAULT 'PENDING',
  "scheduledFor" TIMESTAMP(3) NOT NULL,
  "nextAttemptAt" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastAttemptAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "providerMessageId" TEXT,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "webinar_email_deliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "webinar_email_deliveries_registrationId_fkey"
    FOREIGN KEY ("registrationId")
    REFERENCES "webinar_registrations"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "webinar_email_deliveries_registrationId_kind_key"
  ON "webinar_email_deliveries"("registrationId", "kind");

CREATE INDEX "webinar_email_deliveries_status_nextAttemptAt_idx"
  ON "webinar_email_deliveries"("status", "nextAttemptAt");

CREATE INDEX "webinar_email_deliveries_scheduledFor_idx"
  ON "webinar_email_deliveries"("scheduledFor");

-- Existing registrations were already promised these operational messages.
-- Seed only still-relevant lifecycle jobs; old sessions are deliberately ignored.
INSERT INTO "webinar_email_deliveries"
  ("id", "registrationId", "kind", "scheduledFor", "nextAttemptAt", "updatedAt")
SELECT
  'wem_' || md5(r."id" || ':CONFIRMATION'),
  r."id",
  'CONFIRMATION'::"WebinarEmailKind",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "webinar_registrations" r
JOIN "webinars" w ON w."id" = r."webinarId"
WHERE w."status" IN ('SCHEDULED', 'LIVE')
  AND w."startsAt" + (w."durationMin" * INTERVAL '1 minute') > CURRENT_TIMESTAMP
ON CONFLICT DO NOTHING;

INSERT INTO "webinar_email_deliveries"
  ("id", "registrationId", "kind", "scheduledFor", "nextAttemptAt", "updatedAt")
SELECT
  'wem_' || md5(r."id" || ':REMINDER_24H'),
  r."id",
  'REMINDER_24H'::"WebinarEmailKind",
  w."startsAt" - INTERVAL '24 hours',
  w."startsAt" - INTERVAL '24 hours',
  CURRENT_TIMESTAMP
FROM "webinar_registrations" r
JOIN "webinars" w ON w."id" = r."webinarId"
WHERE w."status" = 'SCHEDULED'
  AND w."startsAt" - INTERVAL '24 hours' > CURRENT_TIMESTAMP
ON CONFLICT DO NOTHING;

INSERT INTO "webinar_email_deliveries"
  ("id", "registrationId", "kind", "scheduledFor", "nextAttemptAt", "updatedAt")
SELECT
  'wem_' || md5(r."id" || ':REMINDER_1H'),
  r."id",
  'REMINDER_1H'::"WebinarEmailKind",
  w."startsAt" - INTERVAL '1 hour',
  w."startsAt" - INTERVAL '1 hour',
  CURRENT_TIMESTAMP
FROM "webinar_registrations" r
JOIN "webinars" w ON w."id" = r."webinarId"
WHERE w."status" = 'SCHEDULED'
  AND w."startsAt" - INTERVAL '1 hour' > CURRENT_TIMESTAMP
ON CONFLICT DO NOTHING;

INSERT INTO "webinar_email_deliveries"
  ("id", "registrationId", "kind", "scheduledFor", "nextAttemptAt", "updatedAt")
SELECT
  'wem_' || md5(r."id" || ':REMINDER_10M'),
  r."id",
  'REMINDER_10M'::"WebinarEmailKind",
  w."startsAt" - INTERVAL '10 minutes',
  w."startsAt" - INTERVAL '10 minutes',
  CURRENT_TIMESTAMP
FROM "webinar_registrations" r
JOIN "webinars" w ON w."id" = r."webinarId"
WHERE w."status" = 'SCHEDULED'
  AND w."startsAt" - INTERVAL '10 minutes' > CURRENT_TIMESTAMP
ON CONFLICT DO NOTHING;

INSERT INTO "webinar_email_deliveries"
  ("id", "registrationId", "kind", "scheduledFor", "nextAttemptAt", "updatedAt")
SELECT
  'wem_' || md5(r."id" || ':SCORECARD_FOLLOWUP'),
  r."id",
  'SCORECARD_FOLLOWUP'::"WebinarEmailKind",
  w."startsAt" + (w."durationMin" * INTERVAL '1 minute'),
  w."startsAt" + (w."durationMin" * INTERVAL '1 minute'),
  CURRENT_TIMESTAMP
FROM "webinar_registrations" r
JOIN "webinars" w ON w."id" = r."webinarId"
WHERE w."status" IN ('SCHEDULED', 'LIVE')
  AND w."startsAt" + (w."durationMin" * INTERVAL '1 minute') > CURRENT_TIMESTAMP
ON CONFLICT DO NOTHING;
