import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const dbUrl = 'postgresql://speedlimit:speedlimit123@localhost:5433/tenant_speed_main_mox1gfsi?schema=public';
const pool = new Pool({ connectionString: dbUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter: adapter as any });

async function main() {
  const pis = await prisma.purchaseInvoice.findMany({
    select: {
      invoiceNumber: true,
      notes: true,
    },
    orderBy: { invoiceNumber: 'asc' }
  });
  console.log('Purchase Invoices in DB:');
  console.dir(pis, { depth: null });
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
