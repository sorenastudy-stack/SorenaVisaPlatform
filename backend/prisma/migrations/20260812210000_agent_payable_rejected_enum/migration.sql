-- PR-AGENT-PAYABLES (phase 2), part 1 of 2 — the REJECTED state.
--
-- SPLIT DELIBERATELY. Postgres allows ALTER TYPE ... ADD VALUE inside a
-- transaction, but forbids *using* the new value in that same transaction, and
-- prisma migrate deploy wraps each migration file in one. The partial unique
-- index in part 2 has 'REJECTED' in its predicate, so it cannot live here.
-- One migration would fail with "unsafe use of new value of enum type".

ALTER TYPE "AgentPayableStatus" ADD VALUE 'REJECTED';
