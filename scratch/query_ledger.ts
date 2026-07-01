import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

async function main() {
  const pool = new Pool({ connectionString: 'postgresql://speedlimit:speedlimit123@localhost:5433/speedlimit' });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    console.log('--- Chart of Accounts with parent ---');
    const childAccounts = await prisma.chartOfAccount.findMany({
      where: { parentId: { not: null } },
      take: 5,
      select: { id: true, code: true, name: true, parentId: true },
    });
    console.log('Sub-accounts sample:', childAccounts);

    console.log('\n--- Opening Balance Transactions ---');
    const openingBalances = await prisma.accountTransaction.findMany({
      where: { sourceType: 'OPENING_BALANCE' },
      take: 10,
      select: { id: true, accountId: true, tagAccountId: true, debit: true, credit: true, sourceRef: true, transactionDate: true },
    });
    console.log('Opening balances sample:', openingBalances);

    // Let's find a parent account with some children and their opening balances
    console.log('\n--- Parent accounts and their children counts ---');
    const parentAccounts = await prisma.chartOfAccount.findMany({
      where: { isGroup: false }, // Let's see
      select: { id: true, code: true, name: true, parentId: true },
    });
    
    // Group children by parentId
    const counts = new Map<string, number>();
    for (const acc of parentAccounts) {
      if (acc.parentId) {
        counts.set(acc.parentId, (counts.get(acc.parentId) || 0) + 1);
      }
    }
    console.log('Parent IDs and their children count:', Array.from(counts.entries()).slice(0, 10));

    // Let's look at one of the parent accounts that has children
    const parentId = Array.from(counts.keys())[0];
    if (parentId) {
      const parent = await prisma.chartOfAccount.findUnique({ where: { id: parentId } });
      const children = await prisma.chartOfAccount.findMany({ where: { parentId } });
      console.log(`\n--- Children of parent ${parent?.code} - ${parent?.name} ---`);
      console.log(children.map(c => ({ id: c.id, code: c.code, name: c.name, balance: c.balance.toString() })));

      // Check transactions for this parent and children
      const txs = await prisma.accountTransaction.findMany({
        where: {
          OR: [
            { accountId: parentId },
            { tagAccountId: { in: children.map(c => c.id) } }
          ]
        },
        take: 20,
        select: { id: true, accountId: true, tagAccountId: true, debit: true, credit: true, sourceType: true, sourceRef: true }
      });
      console.log(`\nTransactions sample for parent ${parent?.name} or its children:`, txs);
    }

  } catch (e) {
    console.error('Error:', e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
