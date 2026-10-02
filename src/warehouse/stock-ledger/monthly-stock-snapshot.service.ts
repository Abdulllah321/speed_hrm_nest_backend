import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { startOfMonth, subMonths, endOfMonth } from 'date-fns';

@Injectable()
export class MonthlyStockSnapshotService {
  private readonly logger = new Logger(MonthlyStockSnapshotService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Automatically run on the 1st day of every month at midnight (00:00) to take a snapshot 
   * of the closing balance of the month that just ended.
   */
  @Cron(CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT)
  async generateMonthlySnapshot() {
    this.logger.log('Starting monthly stock snapshot generation...');
    try {
      // The 1st day of the previous month
      const targetDate = startOfMonth(subMonths(new Date(), 1));
      await this.backfillSnapshotForMonth(targetDate);
      this.logger.log(`Successfully generated monthly stock snapshot for ${targetDate.toISOString().split('T')[0]}`);
    } catch (error) {
      this.logger.error('Failed to generate monthly stock snapshot', error);
    }
  }

  /**
   * Backfills or generates a snapshot for a specific month using Raw SQL for maximum performance.
   * targetMonth should be a Date representing the 1st of the month you want to snapshot.
   */
  async backfillSnapshotForMonth(targetMonth: Date) {
    const startOfTargetMonth = startOfMonth(targetMonth);
    const endOfTargetMonth = endOfMonth(targetMonth);
    
    // Clean up any existing snapshot for this month just in case
    await this.prisma.monthlyStockSnapshot.deleteMany({
      where: {
        date: startOfTargetMonth
      }
    });

    const targetDateStr = startOfTargetMonth.toISOString();
    const cutoffDateStr = endOfTargetMonth.toISOString();

    // Use highly optimized INSERT ... SELECT query
    await this.prisma.$executeRawUnsafe(`
      INSERT INTO monthly_stock_snapshots (id, date, item_id, warehouse_id, location_id, closing_qty, unit_cost)
      SELECT 
        gen_random_uuid(),
        '${targetDateStr}'::timestamp,
        s.item_id, 
        s.warehouse_id, 
        s.location_id, 
        SUM(s.qty),
        COALESCE(
            (SELECT COALESCE(unit_cost, rate) FROM stock_ledgers l2 
             WHERE l2.item_id = s.item_id 
             AND l2.created_at <= '${cutoffDateStr}'::timestamp 
             AND (l2.unit_cost > 0 OR l2.rate > 0)
             ORDER BY l2.created_at DESC LIMIT 1), 
             0
        ) as unit_cost
      FROM stock_ledgers s
      WHERE s.created_at <= '${cutoffDateStr}'::timestamp
      GROUP BY s.item_id, s.warehouse_id, s.location_id
      HAVING SUM(s.qty) != 0
    `);
  }
  
  /**
   * Backfills all snapshots by doing it incrementally from the earliest ledger entry.
   * Warning: Only run this manually when initializing the feature for the first time.
   */
  async initializeHistoricalSnapshots() {
    this.logger.log('Initializing historical monthly stock snapshots...');
    
    // Find earliest entry
    const earliestEntry = await this.prisma.stockLedger.findFirst({
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true }
    });
    
    if (!earliestEntry) {
        this.logger.log('No stock ledger entries found.');
        return;
    }
    
    let currentMonth = startOfMonth(earliestEntry.createdAt);
    const thisMonth = startOfMonth(new Date());
    
    while (currentMonth < thisMonth) {
        this.logger.log(`Generating snapshot for ${currentMonth.toISOString().split('T')[0]}...`);
        await this.backfillSnapshotForMonth(currentMonth);
        currentMonth = startOfMonth(new Date(currentMonth.getTime() + 32 * 24 * 60 * 60 * 1000)); // Advance securely to next month
    }
    
    this.logger.log('Finished initializing historical snapshots.');
  }
}
