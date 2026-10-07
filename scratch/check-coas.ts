import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const dbUrl = 'postgresql://speedlimit:speedlimit123@localhost:5433/tenant_speed_main_mox1gfsi?schema=public';
const pool = new Pool({ connectionString: dbUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter: adapter as any });

async function main() {
  const codes = ['12070004', '40010013', '40010005', '40010006', '40010002', '40010003', '31070001'];
  const coas = await prisma.chartOfAccount.findMany({
    where: {
      code: { in: codes }
    },
    select: {
      id: true,
      code: true,
      name: true,
      parentId: true,
    }
  });
  console.log('--- COA LIST ---');
  for (const c of coas) {
    console.log(`Code: ${c.code} | Name: ${c.name} | ID: ${c.id}`);
  }

  // Also let's check what Tag accounts exist with code C00001
  const tagAccounts = await prisma.chartOfAccount.findMany({
    where: {
      code: 'C00001'
    },
    select: {
      id: true,
      code: true,
      name: true,
      parentId: true
    }
  });
  console.log('--- C00001 TAG ACCOUNTS ---');
  for (const t of tagAccounts) {
    console.log(`Tag ID: ${t.id} | parentId: ${t.parentId} | name: ${t.name}`);
  }

  // Check sales order of cmshjatr80002ccwydhj0sjsr
  const salesOrder = await prisma.eRPSalesOrder.findFirst({
    where: { id: 'cmshhkxj20000h4wyjdxwxlr0' },
    include: {
      items: true
    }
  });
  console.log('--- SALES ORDER ---', JSON.stringify(salesOrder, null, 2));

  // Check delivery challan
  const dc = await prisma.deliveryChallan.findFirst({
    where: { id: 'cmshjah3g0000ccwyalkj9ct9' }
  });
  console.log('--- DELIVERY CHALLAN ---', JSON.stringify(dc, null, 2));
}

main().catch(console.error).finally(async () => {
  await prisma.$disconnect();
  await pool.end();
});
