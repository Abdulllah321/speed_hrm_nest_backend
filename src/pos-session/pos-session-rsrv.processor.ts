import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { PrismaService } from '../database/prisma.service';
import { PosSessionService } from './pos-session.service';

@Processor('reconciliation-rsrv')
export class PosSessionRsrvProcessor {
  private readonly logger = new Logger(PosSessionRsrvProcessor.name);

  @Process('daily-rsrv-generation')
  async handleDailyRsrv(job: Job): Promise<void> {
    this.logger.log('Starting automated midnight RSRV generation for all locations');
    const prisma = new PrismaService();
    const sessionService = new PosSessionService(
      prisma,
      null as any,
      null as any,
      null as any,
      null as any,
    );

    try {
      const locations = await prisma.location.findMany({
        where: { status: 'active', isDeleted: false },
      });

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const dateStr = yesterday.toISOString().split('T')[0];

      for (const loc of locations) {
        try {
          await sessionService.generateDaywiseReconciliationVoucherForDate(loc.id, dateStr);
          this.logger.log(`Completed automated RSRV for location ${loc.name} (${dateStr})`);
        } catch (err: any) {
          this.logger.error(`Failed automated RSRV for location ${loc.name}: ${err?.message}`);
        }
      }
    } catch (err: any) {
      this.logger.error('Failed executing daily midnight RSRV cron job', err);
    }
  }
}
