-- PR-AGENT-PORTAL-2 — drop the dead AgentProfile table.
--
-- Confirmed dead before writing this: 0 rows in dev AND production, zero code
-- references in backend or frontend, and semantics from a different idea
-- (agency counsellor, not affiliate agent). The phase-1 doc called for exactly
-- this, in its own change, because reusing a dead model with the wrong meaning
-- is how Application/Commission drifted.
--
-- The guard below is not ceremony: this is the only DESTRUCTIVE migration in
-- this repo's recent history, and "it was empty when I checked" is not the same
-- as "it is empty now". If a row has appeared, the migration fails loudly
-- instead of deleting it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "agent_profiles" LIMIT 1) THEN
    RAISE EXCEPTION 'agent_profiles is not empty — refusing to drop. Investigate before re-running.';
  END IF;
END $$;

-- DropForeignKey
ALTER TABLE "agent_profiles" DROP CONSTRAINT "agent_profiles_userId_fkey";

-- DropTable
DROP TABLE "agent_profiles";

