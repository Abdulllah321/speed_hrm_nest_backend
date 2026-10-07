import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const dbUrl = 'postgresql://speedlimit:speedlimit123@localhost:5433/tenant_speed_main_mox1gfsi?schema=public';
const pool = new Pool({ connectionString: dbUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter: adapter as any });

async function main() {
  await prisma.eRPSalesInvoice.update({
    where: { id: 'cmshjatr80002ccwydhj0sjsr' },
    data: { status: 'PENDING' }
  });
  console.log('Reset invoice cmshjatr80002ccwydhj0sjsr to PENDING status');
}

main().catch(console.error).finally(async () => {
  await prisma.$disconnect();
  await pool.end();
});
