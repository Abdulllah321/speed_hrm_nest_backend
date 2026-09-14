import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { PrismaService } from '../database/prisma.service';
import { PrismaMasterService } from '../database/prisma-master.service';
import { EncryptionService } from '../common/utils/encryption.service';
import { PosSessionService } from './pos-session.service';

@Processor('reconciliation-rsrv')
export class PosSessionRsrvProcessor {
  private readonly logger = new Logger(PosSessionRsrvProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly prismaMaster: PrismaMasterService,
    private readonly encryptionService: EncryptionService,
    private readonly posSessionService: PosSessionService,
  ) {}

  @Process('daily-rsrv-generation')
  async handleDailyRsrv(job: Job): Promise<void> {
    this.logger.log('Starting automated midnight RSRV generation for all locations');

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0];

    // Case 1: Job specifically targets a tenant
    if (job.data?.companyId && job.data?.tenantDbUrl) {
      await this.processCompanyRsrv(
        {
          id: job.data.companyId,
          tenantId: job.data.tenantId,
          name: job.data.companyName || 'Target Company',
          code: job.data.companyCode || 'TARGET',
          dbUrl: job.data.tenantDbUrl,
        },
        dateStr,
      );
      return;
    }

    // Case 2: Multi-tenant automated execution - Query all active companies from master DB
    try {
      const companies = await this.prismaMaster.company.findMany({
        where: {
          status: 'active',
          tenant: { isActive: true },
        },
        include: { tenant: true },
      });

      if (companies.length === 0) {
        this.logger.warn('No active companies found for daily midnight RSRV generation');
        return;
      }

      this.logger.log(`Found ${companies.length} active company(ies) for daily midnight RSRV generation`);

      for (const company of companies) {
        await this.processCompanyRsrv(company, dateStr);
      }
    } catch (err: any) {
      // Fallback: If master DB is unavailable or single-tenant direct DATABASE_URL is in use
      if (!process.env.DATABASE_URL_MANAGEMENT && process.env.DATABASE_URL) {
        this.logger.log('Executing RSRV generation using direct DATABASE_URL fallback');
        await PrismaService.asyncLocalStorage.run(
          {
            tenantId: 'default',
            companyId: 'default',
            dbUrl: process.env.DATABASE_URL,
          },
          async () => {
            const locations = await this.prisma.location.findMany({
              where: { status: 'active', isDeleted: false },
            });
            for (const loc of locations) {
              try {
                await this.posSessionService.generateDaywiseReconciliationVoucherForDate(loc.id, dateStr);
                this.logger.log(`Completed automated RSRV for location ${loc.name} (${dateStr})`);
              } catch (locErr: any) {
                this.logger.error(`Failed automated RSRV for location ${loc.name}: ${locErr?.message}`);
              }
            }
          },
        );
      } else {
        this.logger.error(`Failed executing daily midnight RSRV cron job: ${err?.message}`, err?.stack);
      }
    }
  }

  private async processCompanyRsrv(
    company: {
      id: string;
      tenantId?: string | null;
      tenant?: { id: string; isActive: boolean } | null;
      name: string;
      code: string;
      dbUrl?: string | null;
      dbPassword?: string | null;
      dbUser?: string | null;
      dbHost?: string | null;
      dbPort?: number | string | null;
      dbName?: string | null;
    },
    dateStr: string,
  ): Promise<void> {
    try {
      let dbUrl = company.dbUrl;

      if (company.dbPassword) {
        try {
          const plainPassword = this.encryptionService.decrypt(company.dbPassword);
          const encodedPassword = encodeURIComponent(String(plainPassword));
          if (company.dbUser && company.dbHost && company.dbName) {
            const port = company.dbPort || 5432;
            const encodedUser = encodeURIComponent(company.dbUser);
            const encodedHost = company.dbHost;
            const encodedDbName = encodeURIComponent(company.dbName);
            dbUrl = `postgresql://${encodedUser}:${encodedPassword}@${encodedHost}:${port}/${encodedDbName}?schema=public`;
          }
        } catch (decErr: any) {
          this.logger.error(
            `Failed to decrypt DB password for company ${company.name} (${company.code}): ${decErr?.message}`,
          );
          return;
        }
      }

      if (!dbUrl) {
        this.logger.warn(`No database URL found for company ${company.name} (${company.code})`);
        return;
      }

      const tenantId = company.tenantId || company.tenant?.id || company.id;

      await PrismaService.asyncLocalStorage.run(
        {
          tenantId,
          companyId: company.id,
          dbUrl,
        },
        async () => {
          this.logger.log(`[RSRV Cron] Processing company: ${company.name} (${company.code}) for date: ${dateStr}`);

          const locations = await this.prisma.location.findMany({
            where: { status: 'active', isDeleted: false },
          });

          for (const loc of locations) {
            try {
              await this.posSessionService.generateDaywiseReconciliationVoucherForDate(loc.id, dateStr);
              this.logger.log(`[RSRV Cron] Completed automated RSRV for ${company.code} - ${loc.name} (${dateStr})`);
            } catch (err: any) {
              this.logger.error(
                `[RSRV Cron] Failed automated RSRV for ${company.code} - ${loc.name}: ${err?.message}`,
              );
            }
          }
        },
      );
    } catch (err: any) {
      this.logger.error(
        `[RSRV Cron] Error processing company ${company.name} (${company.code}): ${err?.message}`,
        err?.stack,
      );
    }
  }
}
