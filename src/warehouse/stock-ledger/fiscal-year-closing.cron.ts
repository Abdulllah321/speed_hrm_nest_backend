import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { FiscalYearClosingService } from './fiscal-year-closing.service';

@Injectable()
export class FiscalYearClosingCron {
  private readonly logger = new Logger(FiscalYearClosingCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fiscalClosingService: FiscalYearClosingService,
  ) {}

  /**
   * Runs automatically at 01:00 AM on July 1st every year (or 23:55 PM June 30th).
   * Cron Expression: 0 1 1 7 * (At 01:00 AM on July 1st)
   */
  @Cron('0 1 1 7 *')
  async handleAnnualFiscalClose() {
    this.logger.log('Annual Fiscal Year-End Closing Cron Triggered');
    try {
      const now = new Date();
      const closingYear = now.getFullYear();
      const prevYear = closingYear - 1;
      const fiscalYearName = `FY_${prevYear}_${closingYear}`;

      // Closing date is June 30th 23:59:59 of previous night
      const closingDate = new Date(closingYear, 5, 30, 23, 59, 59);

      this.logger.log(`Executing automated year-end close for ${fiscalYearName} as of ${closingDate.toISOString()}`);
      
      const result = await this.fiscalClosingService.executeYearEndClose(this.prisma, {
        fiscalYearName,
        closingDate,
      });

      this.logger.log(`Automated Fiscal Close Completed: ${result.message}`);
    } catch (err: any) {
      this.logger.error(`Automated Fiscal Close Failed: ${err.message}`, err.stack);
    }
  }
}
