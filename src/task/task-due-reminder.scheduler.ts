import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';

@Injectable()
export class TaskDueReminderScheduler implements OnModuleInit {
  private readonly logger = new Logger(TaskDueReminderScheduler.name);

  constructor(@InjectQueue('task-due-reminder') private queue: Queue) {}

  async onModuleInit() {
    // Remove any existing repeatable jobs to avoid duplicates on restart
    const repeatables = await this.queue.getRepeatableJobs();
    for (const job of repeatables) {
      await this.queue.removeRepeatableByKey(job.key);
    }

    await this.queue.add(
      'check-due-soon',
      {},
      {
        repeat: { every: 60 * 60 * 1000 }, // every hour
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    this.logger.log('Task due-date reminder job scheduled (every 1h)');
  }
}
