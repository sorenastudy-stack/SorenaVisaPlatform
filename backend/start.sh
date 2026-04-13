#!/bin/sh
set -e

echo "Starting application..."
echo "DATABASE_URL is set: $([ -z "$DATABASE_URL" ] && echo "NO" || echo "YES")"

echo ""
echo "=== Running Prisma migrations ==="
npx prisma migrate deploy --skip-generate || {
  echo "❌ Migration failed!"
  exit 1
}

echo ""
echo "=== Generating Prisma Client ==="
npx prisma generate

echo ""
echo "=== Starting NestJS application ==="
node dist/main.js
