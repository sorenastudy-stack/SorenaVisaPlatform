const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
async function run() {
  const leads = await p.lead.findMany({
    where: { leadStatus: { not: 'QUALIFIED' } },
    include: { contact: true }
  });
  const noUser = leads.find(lead => !lead.contact.userId && lead.contact.email);
  const target = noUser || leads[0];
  if (!target) { console.log('NO LEADS FOUND'); p.$disconnect(); return; }
  console.log(JSON.stringify({
    leadId: target.id,
    leadStatus: target.leadStatus,
    contact: {
      id: target.contact.id,
      email: target.contact.email,
      fullName: target.contact.fullName,
      userId: target.contact.userId
    }
  }, null, 2));
  p.$disconnect();
}
run().catch(e => { console.error(e); process.exit(1); });
