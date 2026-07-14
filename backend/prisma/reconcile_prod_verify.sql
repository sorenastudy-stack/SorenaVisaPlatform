-- =====================================================================
-- POST-RECONCILIATION VERIFICATION — re-runs the 4 drift diff queries.
-- Read-only. Run AFTER reconcile_prod_drift.sql. Expected results are noted
-- next to each query; anything short of those means the apply was incomplete.
-- Run with psql (prints rows): `psql "$URL" -f reconcile_prod_verify.sql`
-- =====================================================================

\echo '=== (1) COLUMNS now present — EXPECT 16 rows ==='
SELECT table_name, column_name
FROM information_schema.columns
WHERE (table_name='users' AND column_name IN
        ('languages','timezone','bookableSessionTypes','bookingActive','staffRole',
         'jobDescription','jobDescriptionSetById','jobDescriptionSetAt'))
   OR (table_name='consultations' AND column_name IN
        ('durationMinutes','scheduledEndAt','bookingTimezone','holdExpiresAt','meetingLink','paidWith'))
   OR (table_name='refunds' AND column_name IN ('consultationId','stripeRefundId'))
ORDER BY 1,2;

\echo '=== (2) TABLES now present — EXPECT 6 rows ==='
SELECT table_name
FROM information_schema.tables
WHERE table_name IN
  ('staff_availability','staff_leave','staff_contract','wallet','wallet_transaction','policy_acceptance')
ORDER BY 1;

\echo '=== (3) ENUM TYPES now present — EXPECT 5 rows ==='
SELECT typname
FROM pg_type
WHERE typname IN ('StaffRole','PaymentMethod','WalletTransactionType','StaffLeaveStatus','StaffLeaveKind')
ORDER BY 1;

\echo '=== (4) ConsultationType values — EXPECT ADMISSION, LIA, FREE_15, GAP_CLOSING (4 rows) ==='
SELECT enumlabel
FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid
WHERE t.typname='ConsultationType'
ORDER BY enumlabel;

\echo '=== (5) BONUS — enum-referencing columns resolve to their types (sanity) ==='
SELECT c.table_name, c.column_name, c.udt_name
FROM information_schema.columns c
WHERE (c.table_name='users'         AND c.column_name IN ('staffRole','bookableSessionTypes'))
   OR (c.table_name='consultations' AND c.column_name = 'paidWith')
ORDER BY 1,2;
