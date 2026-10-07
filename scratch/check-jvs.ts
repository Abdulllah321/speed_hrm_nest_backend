import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const dbUrl = 'postgresql://speedlimit:speedlimit123@localhost:5433/tenant_speed_main_mox1gfsi?schema=public';
const pool = new Pool({ connectionString: dbUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter: adapter as any });

async function main() {
  const jvs = await prisma.journalVoucher.findMany({
    select: {
      id: true,
      jvNo: true,
      folio: true,
      jvDate: true,
      description: true,
      status: true,
    },
    orderBy: { jvNo: 'asc' },
  });

  console.log('--- Current JVs in DB ---');
  console.log(JSON.stringify(jvs, null, 2));
}

main().catch(console.error).finally(async () => {
  await prisma.$disconnect();
  await pool.end();
});
