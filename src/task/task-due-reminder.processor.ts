import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { TaskService } from './task.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../database/prisma.service';

@Processor('task-due-reminder')
export class TaskDueReminderProcessor {
  private readonly logger = new Logger(TaskDueReminderProcessor.name);

  constructor(
    private taskService: TaskService,
    private notifications: NotificationsService,
    private prisma: PrismaService,
  ) {}

  @Process('check-due-soon')
  async handleDueSoon(job: Job) {
    this.logger.log('Running due-date reminder check...');

    const tasks = await this.taskService.findTasksDueSoon();
    let notified = 0;

    for (const task of tasks) {
      const employees = await this.prisma.employee.findMany({
        where: { id: { in: task.assignees.map((a) => a.employeeId) } },
        select: { userId: true },
      });

      for (const emp of employees) {
        if (!emp.userId) continue;
        await this.notifications.create({
          userId: emp.userId,
          title: 'Task due in 24 hours',
          message: `"${task.title}" is due soon`,
          category: 'task',
          priority: 'high',
          entityType: 'Task',
          entityId: task.id,
        });
      }

      await this.taskService.markNotified(task.id);
      notified++;
    }

    this.logger.log(`Due-date reminders sent for ${notified} task(s)`);
  }
}
