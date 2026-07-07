import 'reflect-metadata';
import * as dotenv from 'dotenv';
dotenv.config();
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

// Piece #3 — local seed: a dedicated FINANCE (accountant) user with an
// email/password login, so the "Payments to confirm" surface can be tested in
// the browser. Mirrors seed-admin-user.ts. Idempotent.

const prisma = new PrismaClient();
const EMAIL = 'finance@sorena.test';
const PASSWORD = 'Sorena!Finance1';

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const u = await prisma.user.upsert({
    where: { email: EMAIL },
    update: { role: 'FINANCE', isActive: true, name: 'Sorena Finance', passwordHash },
    create: { email: EMAIL, name: 'Sorena Finance', role: 'FINANCE', isActive: true, passwordHash },
    select: { id: true, email: true, role: true },
  });
  console.log('Finance user ready:', u.email, '| role', u.role, '| id', u.id);
  console.log('Login (email/password):', EMAIL, '/', PASSWORD);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
