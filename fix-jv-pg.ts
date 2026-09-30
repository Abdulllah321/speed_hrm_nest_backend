import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

async function main() {
  const dbUrl = 'postgresql://postgres:root@localhost:5432/tenant_speed_main_mox1gfsi?schema=public';
  const pool = new Pool({ connectionString: dbUrl });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter: adapter as any });
  
  await prisma.$connect();

  const jvNos = [
    'JV-26-27-0037',
    'JV-26-27-0039',
    'JV-26-27-0043',
    'JV-26-27-0044',
    'JV-26-27-0045',
    'JV-26-27-0046',
    'JV-26-27-0047',
    'JV-26-27-0048',
    'JV-26-27-0049',
    'JV-26-27-0058'
  ];

  for (const jvNo of jvNos) {
    const jv = await prisma.journalVoucher.findUnique({
      where: { jvNo },
      include: { details: true }
    });

    if (!jv) {
      console.log(`[${jvNo}] NOT FOUND IN SYSTEM`);
      continue;
    }

    console.log(`[${jvNo}] STATUS: ${jv.status}`);

    const txs = await prisma.accountTransaction.findMany({
      where: { sourceId: jv.id, sourceType: 'JOURNAL_VOUCHER' }
    });

    console.log(`[${jvNo}] FOUND ${txs.length} AccountTransactions`);

    if (txs.length > 0) {
      console.log(`[${jvNo}] DELETING ${txs.length} AccountTransactions...`);
      const res = await prisma.accountTransaction.deleteMany({
        where: { sourceId: jv.id, sourceType: 'JOURNAL_VOUCHER' }
      });
      console.log(`[${jvNo}] DELETED ${res.count} AccountTransactions.`);
    }

    if (jv.status !== 'unapproved' && jv.status !== 'rejected') {
      console.log(`[${jvNo}] CHANGING STATUS TO rejected`);
      await prisma.journalVoucher.update({
        where: { id: jv.id },
        data: { status: 'rejected' }
      });
    }
  }

  // Find all affected accounts
  // Usually when deleting transactions we should rebuild balances for the affected accounts
  // But we can rely on standard balance update later if needed

  console.log('Done!');
  await prisma.$disconnect();
  await pool.end();
}

main().catch(console.error);
