import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PosSessionService } from '../src/pos-session/pos-session.service';
import { PrismaService } from '../src/database/prisma.service';

async function bootstrap() {
  console.log('Starting application context...');
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const posSessionService = app.get(PosSessionService);

  const dates = [
    '2026-10-01',
    '2026-10-02',
    '2026-10-03',
    '2026-10-04',
    '2026-10-05',
  ];

  await PrismaService.asyncLocalStorage.run(
    {
      tenantId: 'default',
      companyId: 'default',
      dbUrl: process.env.DATABASE_URL as string,
    },
    async () => {
      console.log('Connected to DB...');

      const existingRvQuery = {
        type: 'rs_rv',
        rvDate: {
          gte: new Date('2026-10-01T00:00:00.000Z'),
          lte: new Date('2026-10-05T23:59:59.999Z'),
        },
      };

      const existingRvs = await prisma.receiptVoucher.findMany({
        where: existingRvQuery,
      });

      console.log(
        `Found ${existingRvs.length} existing RSRVs between Oct 1 and Oct 5.`,
      );

      const rvIds = existingRvs.map((rv) => rv.id);

      if (rvIds.length > 0) {
        console.log('Deleting existing RSRV details...');
        await prisma.receiptVoucherDetail.deleteMany({
          where: { receiptVoucherId: { in: rvIds } },
        });

        console.log('Deleting existing RSRVs...');
        await prisma.receiptVoucher.deleteMany({
          where: { id: { in: rvIds } },
        });
        console.log('Deletion successful.');
      }

      const locations = await prisma.location.findMany({
        where: { status: 'active', isDeleted: false },
      });

      console.log(`Found ${locations.length} active locations.`);

      for (const dateStr of dates) {
        console.log(`\n--- Generating RSRV for Date: ${dateStr} ---`);
        for (const loc of locations) {
          try {
            await posSessionService.generateDaywiseReconciliationVoucherForDate(
              loc.id,
              dateStr,
            );
            console.log(`Success: RSRV for ${loc.name} on ${dateStr}`);
          } catch (err: any) {
            console.error(
              `Failed: RSRV for ${loc.name} on ${dateStr}:`,
              err?.message,
            );
          }
        }
      }

      console.log('\nAll done! RSRV Regeneration Complete.');
    },
  );

  await app.close();
}

bootstrap().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
