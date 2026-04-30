const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const hash = await bcrypt.hash('Sorena2026!', 10);
  await prisma.user.update({
    where: { email: 'sales@sorenatest.com' },
    data: { passwordHash: hash },
  });
  console.log('OK — password reset to Sorena2026!');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
