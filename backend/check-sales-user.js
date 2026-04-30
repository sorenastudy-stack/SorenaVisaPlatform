const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.user.findUnique({ where: { email: 'sales@sorenatest.com' } })
  .then(u => {
    console.log({
      email: u?.email,
      isActive: u?.isActive,
      hashStart: u?.passwordHash?.slice(0, 10),
    });
    return p.$disconnect();
  });
