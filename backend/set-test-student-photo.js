const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  const result = await p.contact.updateMany({
    where: { email: 'test@sorenatest.com' },
    data: {
      photoUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&h=200&fit=crop&crop=face',
    },
  });
  console.log('Updated:', result.count, 'contact(s)');
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());
