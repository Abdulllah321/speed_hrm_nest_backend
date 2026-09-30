import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  // Get the default PrismaService (for the main/speed main db in our current setup, since the single db URL connects directly)
  const prisma = app.get(PrismaService);
  
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

  console.log('Done!');
  await app.close();
}

main().catch(console.error);
