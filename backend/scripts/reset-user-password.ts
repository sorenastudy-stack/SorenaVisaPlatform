/* eslint-disable no-console */
/**
 * Throwaway — reset the bcrypt password hash on a single User row.
 * Test-account maintenance only.
 *
 * Uses the SAME bcrypt config as backend/src/auth/auth.service.ts
 * (`bcrypt.hash(password, 10)`) so the new hash is verifiable by
 * the existing login flow via `bcrypt.compare(...)`.
 *
 * Usage:
 *   npm run reset:user-password -- <email> <new-password>
 *
 * Example:
 *   npm run reset:user-password -- test@sorenatest.com SorenaTest2026!
 */

import 'reflect-metadata';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

const SALT_ROUNDS = 10; // matches auth.service.ts:49

async function main() {
  const email = process.argv[2];
  const password = process.argv[3];
  if (!email || !password) {
    console.error('Usage: npm run reset:user-password -- <email> <new-password>');
    console.error('Example: npm run reset:user-password -- sheilarose@sorenavisa.com SorenaLia2026!');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, role: true },
    });
    if (!user) {
      console.error(`[reset] no user with email ${email} — nothing changed.`);
      process.exit(1);
    }

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    await prisma.user.update({
      where: { id: user.id },
      data:  { passwordHash: hash },
    });

    console.log('');
    console.log('─────────────────────────────────────────────');
    console.log(`Password reset for ${user.email}`);
    console.log(`  user id : ${user.id}`);
    console.log(`  role    : ${user.role}`);
    console.log('─────────────────────────────────────────────');
    console.log('');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[reset] fatal:', err);
  process.exit(1);
});
