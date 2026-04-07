const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const contact = await prisma.contact.findUnique({ where: { email: 'test@sorenatest.com' } });
  console.log('contact', contact ? 'exists' : 'missing');
  const lead = contact ? await prisma.lead.findFirst({ where: { contactId: contact.id } }) : null;
  console.log('lead', lead ? 'exists' : 'missing');
  await prisma.$disconnect();
})();
