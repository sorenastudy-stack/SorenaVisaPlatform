const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const p = new PrismaClient();
async function run() {
  // Find the STUDENT user
  const user = await p.user.findFirst({ where: { role: 'STUDENT' }, orderBy: { createdAt: 'desc' } });
  if (!user) { console.log('No student user found'); p.$disconnect(); return; }
  console.log(JSON.stringify({ id: user.id, email: user.email, name: user.name, role: user.role, isActive: user.isActive }));
  // We can't reverse the hash - need to reset it
  const newPass = 'TempStudent2026!';
  const hash = await bcrypt.hash(newPass, 10);
  await p.user.update({ where: { id: user.id }, data: { passwordHash: hash } });
  console.log('Password reset to: ' + newPass);
  p.$disconnect();
}
run().catch(e => { console.error(e); process.exit(1); });
