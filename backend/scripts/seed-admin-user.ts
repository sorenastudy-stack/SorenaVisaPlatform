import 'reflect-metadata';
import * as dotenv from 'dotenv';
dotenv.config();
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

// PR-BOOKING-ADMIN-A — local seed: a dedicated OWNER (admin-tier) user
// with an email/password login, so the admin panel can be tested in the
// browser without disturbing the LEAD test user (yashoue). Idempotent.

const prisma = new PrismaClient();
const EMAIL = 'owner@sorena.test';
const PASSWORD = 'Sorena!Admin1';

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const u = await prisma.user.upsert({
    where: { email: EMAIL },
    update: { role: 'OWNER', isActive: true, name: 'Sorena Owner', passwordHash },
    create: { email: EMAIL, name: 'Sorena Owner', role: 'OWNER', isActive: true, passwordHash },
    select: { id: true, email: true, role: true },
  });
  console.log('Admin user ready:', u.email, '| role', u.role, '| id', u.id);
  console.log('Login (email/password):', EMAIL, '/', PASSWORD);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
