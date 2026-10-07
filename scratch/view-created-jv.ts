import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const dbUrl = 'postgresql://speedlimit:speedlimit123@localhost:5433/tenant_speed_main_mox1gfsi?schema=public';
const pool = new Pool({ connectionString: dbUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter: adapter as any });

async function main() {
  const jv = await prisma.journalVoucher.findUnique({
    where: { jvNo: 'JV-26-27-0239' },
    include: {
      details: {
        include: {
          account: true,
          tagAccount: true
        }
      }
    }
  });
  console.log('--- JV-26-27-0239 ---');
  console.log('JV Header:', {
    jvNo: jv?.jvNo,
    folio: jv?.folio,
    jvDate: jv?.jvDate,
    description: jv?.description,
    status: jv?.status
  });
  console.log('JV Details:');
  for (const d of jv?.details || []) {
    console.log(`[${d.account.code}] ${d.account.name} | Tag: [${d.tagAccount?.code}] ${d.tagAccount?.name} | Dr: ${d.debit} | Cr: ${d.credit} | Narration: ${d.narration} | Ref1: ${d.refBillNo} | Ref2: ${d.refBillNo2}`);
  }
}

main().catch(console.error).finally(async () => {
  await prisma.$disconnect();
  await pool.end();
});
