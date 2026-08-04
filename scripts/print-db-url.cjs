// Helper: print this Railway env's public DB URL to stdout (used with
// `railway run -e <env> -s Postgres -- node scripts/print-db-url.cjs` to
// capture a URL into a shell var without inline-eval shell mangling).
process.stdout.write(process.env.DATABASE_PUBLIC_URL || '');
