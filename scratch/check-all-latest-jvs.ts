import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const dbUrl = 'postgresql://speedlimit:speedlimit123@localhost:5433/tenant_speed_main_mox1gfsi?schema=public';
const pool = new Pool({ connectionString: dbUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter: adapter as any });

async function main() {
  const jvs = await prisma.journalVoucher.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
    include: { details: true }
  });
  console.log('--- LATEST 10 JVS ---');
  for (const jv of jvs) {
    console.log(`JV: ${jv.jvNo} | Folio: ${jv.folio} | Date: ${jv.jvDate.toISOString().slice(0, 10)} | Desc: ${jv.description} | Status: ${jv.status}`);
  }
}

main().catch(console.error).finally(async () => {
  await prisma.$disconnect();
  await pool.end();
});
