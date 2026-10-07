import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const dbUrl = 'postgresql://speedlimit:speedlimit123@localhost:5433/tenant_speed_main_mox1gfsi?schema=public';
const pool = new Pool({ connectionString: dbUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter: adapter as any });

async function main() {
  await prisma.journalVoucher.deleteMany({
    where: { description: { contains: 'INV-2026-0001' } }
  });
  await prisma.eRPSalesInvoice.update({
    where: { id: 'cmshjatr80002ccwydhj0sjsr' },
    data: { status: 'PENDING' }
  });
  console.log('Reset complete!');
}

main().catch(console.error).finally(async () => {
  await prisma.$disconnect();
  await pool.end();
});
