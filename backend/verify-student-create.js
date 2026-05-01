const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
async function run() {
  const LEAD_ID = process.argv[2];
  const lead = await p.lead.findUnique({ where: { id: LEAD_ID }, include: { contact: { include: { user: true } } } });
  const contact = lead.contact;
  const caseRow = await p.case.findFirst({ where: { leadId: LEAD_ID } });
  console.log(JSON.stringify({
    contactUserId: contact.userId,
    userExists: !!contact.user,
    userRole: contact.user?.role,
    userEmail: contact.user?.email,
    userIsActive: contact.user?.isActive,
    caseExists: !!caseRow,
    caseId: caseRow?.id,
    caseStage: caseRow?.stage,
    caseStatus: caseRow?.status,
  }, null, 2));
  p.$disconnect();
}
run().catch(e => { console.error(e); process.exit(1); });
