import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const dbUrl = 'postgresql://speedlimit:speedlimit123@localhost:5433/tenant_speed_main_mox1gfsi?schema=public';
const pool = new Pool({ connectionString: dbUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter: adapter as any });

async function main() {
  const prs = await prisma.purchaseReturn.findMany({
    select: {
      returnNumber: true,
      reason: true,
      notes: true,
    },
    orderBy: { returnNumber: 'asc' }
  });
  console.log('Purchase Returns in DB:');
  console.dir(prs, { depth: null });
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
