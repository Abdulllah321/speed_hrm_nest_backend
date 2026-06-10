import { PrismaService } from '../src/database/prisma.service';
import 'dotenv/config';

const prisma = new PrismaService({
  tenantId: 'debug',
  tenantDbUrl: process.env.DATABASE_URL || 'postgresql://speedlimit:speedlimit123@localhost:5433/speedlimit'
});

async function main() {
  console.log('--- FETCHING LAST PAYMENT VOUCHERS ---');
  const pvs = await prisma.paymentVoucher.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
    include: {
      details: {
        include: {
          account: true,
          tagAccount: true,
        },
      },
    },
  });

  for (const pv of pvs) {
    console.log(`\nPV ID: ${pv.id} | PV No: ${pv.pvNo} | Status: ${pv.status} | Date: ${pv.pvDate}`);
    console.log(`Credit Account ID: ${pv.creditAccountId} | Credit Amount: ${pv.creditAmount}`);
    console.log('--- DETAILS ---');
    for (const d of pv.details) {
      console.log(`  Detail ID: ${d.id}`);
      console.log(`    Account: ${d.account?.code} - ${d.account?.name}`);
      console.log(`    Tag Account: ${d.tagAccount?.code} - ${d.tagAccount?.name} (${d.tagAccountId})`);
      console.log(`    Debit: ${d.debit} | Credit: ${d.credit}`);
    }

    console.log('--- GENERAL LEDGER TRANSACTIONS ---');
    const txs = await prisma.accountTransaction.findMany({
      where: { sourceId: pv.id },
      include: {
        account: true,
        tagAccount: true,
      },
    });
    for (const tx of txs) {
      console.log(`  Tx ID: ${tx.id} | Date: ${tx.transactionDate}`);
      console.log(`    Account: ${tx.account?.code} - ${tx.account?.name}`);
      console.log(`    Tag Account: ${tx.tagAccount?.code} - ${tx.tagAccount?.name} (${tx.tagAccountId})`);
      console.log(`    Debit: ${tx.debit} | Credit: ${tx.credit} | BalanceAfter: ${tx.balanceAfter}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
