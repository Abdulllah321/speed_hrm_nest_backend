import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PosSessionService } from '../src/pos-session/pos-session.service';
import { PrismaService } from '../src/database/prisma.service';
import { PrismaMasterService } from '../src/database/prisma-master.service';
import { EncryptionService } from '../src/common/utils/encryption.service';

async function bootstrap() {
  console.log('Starting application context...');
  const app = await NestFactory.createApplicationContext(AppModule);

  const prismaMaster = app.get(PrismaMasterService);
  const prismaService = app.get(PrismaService);
  const posSessionService = app.get(PosSessionService);
  const encryptionService = app.get(EncryptionService);

  const dates = [
    '2026-09-30',
    '2026-10-01',
    '2026-10-02',
    '2026-10-03',
    '2026-10-04',
    '2026-10-05',
  ];

  const companies = await prismaMaster.company.findMany({
    where: {
      status: 'active',
    },
    include: { tenant: true },
  });

  if (companies.length === 0) {
    console.log('No active companies found.');
    await app.close();
    return;
  }

  for (const company of companies) {
    let dbUrl = company.dbUrl;

    if (company.dbPassword) {
      try {
        const plainPassword = encryptionService.decrypt(company.dbPassword);
        const encodedPassword = encodeURIComponent(String(plainPassword));
        if (company.dbUser && company.dbHost && company.dbName) {
          const port = company.dbPort || 5432;
          const encodedUser = encodeURIComponent(company.dbUser);
          const encodedHost = company.dbHost;
          const encodedDbName = encodeURIComponent(company.dbName);
          dbUrl = `postgresql://${encodedUser}:${encodedPassword}@${encodedHost}:${port}/${encodedDbName}?schema=public`;
        }
      } catch (decErr: any) {
        console.error(
          `Failed to decrypt DB password for company ${company.name}`,
        );
        continue;
      }
    }

    if (!dbUrl) {
      console.warn(`No database URL found for company ${company.name}`);
      continue;
    }

    const tenantId = company.tenantId || company.tenant?.id || company.id;

    await PrismaService.asyncLocalStorage.run(
      {
        tenantId,
        companyId: company.id,
        dbUrl,
      },
      async () => {
        console.log(`\n===========================================`);
        console.log(`Processing company: ${company.name} (${company.code})`);

        // 1. Delete Existing
        const existingRvs = await prismaService.receiptVoucher.findMany({
          where: {
            type: 'rs_rv',
            rvDate: {
              gte: new Date('2026-10-01T00:00:00.000Z'),
              lte: new Date('2026-10-05T23:59:59.999Z'),
            },
          },
        });

        console.log(`Found ${existingRvs.length} existing RSRVs to delete.`);
        const rvIds = existingRvs.map((rv) => rv.id);

        if (rvIds.length > 0) {
          await prismaService.receiptVoucherDetail.deleteMany({
            where: { receiptVoucherId: { in: rvIds } },
          });
          await prismaService.receiptVoucher.deleteMany({
            where: { id: { in: rvIds } },
          });
          console.log('Deleted existing RSRVs successfully.');
        }

        // 2. Generate New
        const locations = await prismaService.location.findMany({
          where: { status: 'active', isDeleted: false },
          orderBy: { name: 'asc' },
        });

        for (const dateStr of dates) {
          console.log(`\n--- Generating RSRV for Date: ${dateStr} ---`);
          for (const loc of locations) {
            try {
              await posSessionService.generateDaywiseReconciliationVoucherForDate(
                loc.id,
                dateStr,
              );
              console.log(
                `Success: RSRV generated for ${loc.name} on ${dateStr}`,
              );
            } catch (err: any) {
              console.error(
                `Failed: RSRV generation for ${loc.name} on ${dateStr}:`,
                err?.message,
              );
            }
          }
        }
      },
    );
  }

  console.log('\nAll done! RSRV Regeneration Complete for all companies.');
  await app.close();
}

bootstrap().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
