const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkTables() {
  try {
    const result = await prisma.`$`queryRaw\
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    \;
    
    console.log('Tables found:', result.length);
    result.forEach(row => console.log(' -', row.table_name));
    
    await prisma.`$`disconnect();
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

checkTables();
