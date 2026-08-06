-- PR-EXPLORE — map coordinates for the student Explore map.
--
-- Purely additive: four nullable columns, nothing altered or dropped.
--
-- latitude/longitude are nullable BY DESIGN. An institution that cannot be
-- geocoded confidently keeps null and is shown in the results list without a
-- map pin — it is never dropped from results, and a coordinate is never
-- guessed. geocodedAt + geocodeSource record when and by what the lookup ran,
-- so a later pass can retry only the misses instead of re-geocoding all 95.

ALTER TABLE "education_providers" ADD COLUMN "latitude" DOUBLE PRECISION;
ALTER TABLE "education_providers" ADD COLUMN "longitude" DOUBLE PRECISION;
ALTER TABLE "education_providers" ADD COLUMN "geocodedAt" TIMESTAMP(3);
ALTER TABLE "education_providers" ADD COLUMN "geocodeSource" TEXT;
