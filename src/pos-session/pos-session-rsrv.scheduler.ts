import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';

@Injectable()
export class PosSessionRsrvScheduler implements OnModuleInit {
  private readonly logger = new Logger(PosSessionRsrvScheduler.name);

  constructor(
    @InjectQueue('reconciliation-rsrv') private queue: Queue,
  ) {}

  async onModuleInit() {
    try {
      const repeatables = await this.queue.getRepeatableJobs();
      for (const job of repeatables) {
        await this.queue.removeRepeatableByKey(job.key);
      }

      // Schedule daily RSRV generation at 12:00 AM (midnight)
      await this.queue.add(
        'daily-rsrv-generation',
        {},
        {
          repeat: { cron: '0 0 * * *' }, // Midnight 00:00 every day
          removeOnComplete: true,
          removeOnFail: false,
        },
      );

      this.logger.log('Automated Daily Midnight RSRV generation job scheduled (00:00 AM)');
    } catch (err: any) {
      this.logger.warn(`Could not schedule RSRV cron: ${err?.message}`);
    }
  }
}
