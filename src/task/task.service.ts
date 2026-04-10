import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaMasterService } from '../database/prisma-master.service';
import { KpiComputeService } from '../kpi/kpi-compute.service';
import { KpiService } from '../kpi/kpi.service';
import {
  CreateTaskDto,
  UpdateTaskDto,
  ChangeTaskStatusDto,
  UpdateAssigneesDto,
  ReorderTasksDto,
  CreateCommentDto,
  UpdateCommentDto,
} from './dto/task.dto';

type Ctx = { userId?: string; employeeId?: string; ipAddress?: string; userAgent?: string };

@Injectable()
export class TaskService {
  constructor(
    private prisma: PrismaService,
    private prismaMaster: PrismaMasterService,
    private activityLogs: ActivityLogsService,
    private notifications: NotificationsService,
    private kpiCompute: KpiComputeService,
    private kpiService: KpiService,
  ) {}

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private async logActivity(taskId: string, actorId: string, action: string, oldValue?: string, newValue?: string) {
    await this.prisma.taskActivity.create({
      data: { taskId, actorId, action, oldValue, newValue },
    });
  }

  private async notifyAssignees(taskId: string, title: string, message: string, priority: 'low' | 'normal' | 'high' | 'urgent', excludeUserId?: string) {
    const assignees = await this.prisma.taskAssignee.findMany({ where: { taskId } });
    const employees = await this.prisma.employee.findMany({
      where: { id: { in: assignees.map((a) => a.employeeId) } },
      select: { id: true, userId: true },
    });
    for (const emp of employees) {
      if (!emp.userId || emp.userId === excludeUserId) continue;
      await this.notifications.create({
        userId: emp.userId,
        title,
        message,
        category: 'task',
        priority,
        entityType: 'Task',
        entityId: taskId,
      });
    }
  }

  private async getUserIdForEmployee(employeeId: string): Promise<string | null> {
    const emp = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { userId: true },
    });
    return emp?.userId ?? null;
  }

  // ─── Tasks CRUD ───────────────────────────────────────────────────────────────

  async list(filters: {
    projectId?: string;
    listId?: string;
    assigneeId?: string;
    status?: string;
    priority?: string;
    dueBefore?: string;
    parentTaskId?: string | null;
  }) {
    try {
      const where: any = {};
      if (filters.projectId) where.projectId = filters.projectId;
      if (filters.listId) where.listId = filters.listId;
      if (filters.status) where.status = filters.status;
      if (filters.priority) where.priority = filters.priority;
      if (filters.dueBefore) where.dueDate = { lte: new Date(filters.dueBefore) };
      if (filters.parentTaskId !== undefined) where.parentTaskId = filters.parentTaskId;
      if (filters.assigneeId) {
        where.assignees = { some: { employeeId: filters.assigneeId } };
      }

      const tasks = await this.prisma.task.findMany({
        where,
        include: {
          assignees: true,
          _count: { select: { subtasks: true, comments: true, attachments: true } },
        },
        orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
      });

      return { status: true, data: tasks };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to list tasks' };
    }
  }

  async getOne(id: string) {
    try {
      const task = await this.prisma.task.findUnique({
        where: { id },
        include: {
          assignees: true,
          subtasks: {
            include: { assignees: true },
            orderBy: { position: 'asc' },
          },
          attachments: true,
          labels: { include: { label: true } },
          review: true,
          _count: { select: { comments: true, activities: true } },
        },
      });

      if (!task) return { status: false, message: 'Task not found' };
      return { status: true, data: task };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to get task' };
    }
  }

  async create(body: CreateTaskDto, ctx: Ctx) {
    try {
      const list = await this.prisma.taskList.findUnique({ where: { id: body.listId } });
      if (!list) return { status: false, message: 'Task list not found' };

      const last = await this.prisma.task.findFirst({
        where: { listId: body.listId },
        orderBy: { position: 'desc' },
      });

      const task = await this.prisma.task.create({
        data: {
          projectId: body.projectId,
          listId: body.listId,
          title: body.title,
          description: body.description,
          status: body.status ?? 'todo',
          priority: body.priority ?? 'none',
          type: body.type ?? 'task',
          position: last ? last.position + 1 : 0,
          parentTaskId: body.parentTaskId,
          startDate: body.startDate ? new Date(body.startDate) : undefined,
          dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
          estimatedHours: body.estimatedHours,
          createdById: ctx.userId,
        },
      });

      // Add assignees
      if (body.assigneeIds?.length) {
        await this.prisma.taskAssignee.createMany({
          data: body.assigneeIds.map((employeeId, i) => ({
            taskId: task.id,
            employeeId,
            role: i === 0 ? 'primary' : 'collaborator',
            assignedById: ctx.userId,
          })),
          skipDuplicates: true,
        });

        // Notify each assignee
        for (const employeeId of body.assigneeIds) {
          const userId = await this.getUserIdForEmployee(employeeId);
          if (userId && userId !== ctx.userId) {
            await this.notifications.create({
              userId,
              title: 'New task assigned to you',
              message: `You have been assigned to: ${task.title}`,
              category: 'task',
              priority: 'high',
              entityType: 'Task',
              entityId: task.id,
            });
          }
        }
      }

      await this.logActivity(task.id, ctx.userId ?? 'system', 'created', undefined, task.title);

      // If subtask, update parent completion
      if (task.parentTaskId) {
        await this.logActivity(task.id, ctx.userId ?? 'system', 'subtask_added');
        await this.recalcParentCompletion(task.parentTaskId);
      }

      return { status: true, data: task, message: 'Task created successfully' };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to create task' };
    }
  }

  async update(id: string, body: UpdateTaskDto, ctx: Ctx) {
    try {
      const existing = await this.prisma.task.findUnique({ where: { id } });
      if (!existing) return { status: false, message: 'Task not found' };

      const data: any = { ...body, updatedById: ctx.userId };
      if (body.startDate) data.startDate = new Date(body.startDate);
      if (body.dueDate) data.dueDate = new Date(body.dueDate);

      const updated = await this.prisma.task.update({ where: { id }, data });

      // Log specific field changes
      if (body.priority && body.priority !== existing.priority) {
        await this.logActivity(id, ctx.userId ?? 'system', 'priority_changed', existing.priority, body.priority);
      }
      if (body.dueDate && body.dueDate !== existing.dueDate?.toISOString()) {
        await this.logActivity(id, ctx.userId ?? 'system', 'due_date_changed', existing.dueDate?.toISOString(), body.dueDate);
      }

      return { status: true, data: updated, message: 'Task updated successfully' };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to update task' };
    }
  }

  async remove(id: string, ctx: Ctx) {
    try {
      const existing = await this.prisma.task.findUnique({ where: { id } });
      if (!existing) return { status: false, message: 'Task not found' };

      await this.prisma.task.delete({ where: { id } });

      if (existing.parentTaskId) {
        await this.recalcParentCompletion(existing.parentTaskId);
      }

      return { status: true, message: 'Task deleted successfully' };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to delete task' };
    }
  }

  // ─── Status Change ────────────────────────────────────────────────────────────

  async changeStatus(id: string, body: ChangeTaskStatusDto, ctx: Ctx) {
    try {
      const existing = await this.prisma.task.findUnique({ where: { id } });
      if (!existing) return { status: false, message: 'Task not found' };

      const data: any = { status: body.status, updatedById: ctx.userId };
      if (body.status === 'done') {
        data.completedAt = new Date();
        data.completionPercentage = 100;
        if (body.actualHours !== undefined) data.actualHours = body.actualHours;
      }

      const updated = await this.prisma.task.update({ where: { id }, data });

      await this.logActivity(id, ctx.userId ?? 'system', 'status_changed', existing.status, body.status);

      // Notify assignees + creator of status change
      await this.notifyAssignees(
        id,
        `Task status updated: ${updated.title}`,
        `Status changed from ${existing.status} to ${body.status}`,
        'normal',
        ctx.userId,
      );

      if (body.status === 'done') {
        await this.logActivity(id, ctx.userId ?? 'system', 'completed');

        // Notify creator
        if (existing.createdById && existing.createdById !== ctx.userId) {
          const creator = await this.prisma.employee.findFirst({
            where: { id: existing.createdById },
            select: { userId: true },
          });
          if (creator?.userId) {
            await this.notifications.create({
              userId: creator.userId,
              title: 'Task completed',
              message: `"${updated.title}" has been marked as done`,
              category: 'task',
              priority: 'normal',
              entityType: 'Task',
              entityId: id,
            });
          }
        }

        // ── KPI hook: trigger auto-compute for all assignees ──────────────────
        await this.triggerKpiForAssignees(id, ctx);
      }
      // Recalc parent completion if subtask
      if (existing.parentTaskId) {
        await this.recalcParentCompletion(existing.parentTaskId);
      }

      return { status: true, data: updated, message: 'Task status updated' };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to change task status' };
    }
  }

  // ─── Assignees ────────────────────────────────────────────────────────────────

  async updateAssignees(id: string, body: UpdateAssigneesDto, ctx: Ctx) {
    try {
      const task = await this.prisma.task.findUnique({ where: { id } });
      if (!task) return { status: false, message: 'Task not found' };

      const existing = await this.prisma.taskAssignee.findMany({ where: { taskId: id } });
      const existingIds = new Set(existing.map((a) => a.employeeId));
      const newIds = new Set(body.assignees.map((a) => a.employeeId));

      // Remove unneeded
      const toRemove = existing.filter((a) => !newIds.has(a.employeeId));
      if (toRemove.length) {
        await this.prisma.taskAssignee.deleteMany({
          where: { taskId: id, employeeId: { in: toRemove.map((a) => a.employeeId) } },
        });
        for (const a of toRemove) {
          await this.logActivity(id, ctx.userId ?? 'system', 'unassigned', a.employeeId);
        }
      }

      // Add new
      const toAdd = body.assignees.filter((a) => !existingIds.has(a.employeeId));
      if (toAdd.length) {
        await this.prisma.taskAssignee.createMany({
          data: toAdd.map((a) => ({
            taskId: id,
            employeeId: a.employeeId,
            role: a.role ?? 'collaborator',
            assignedById: ctx.userId,
          })),
          skipDuplicates: true,
        });

        for (const a of toAdd) {
          await this.logActivity(id, ctx.userId ?? 'system', 'assigned', undefined, a.employeeId);
          const userId = await this.getUserIdForEmployee(a.employeeId);
          if (userId && userId !== ctx.userId) {
            await this.notifications.create({
              userId,
              title: 'New task assigned to you',
              message: `You have been assigned to: ${task.title}`,
              category: 'task',
              priority: 'high',
              entityType: 'Task',
              entityId: id,
            });
          }
        }
      }

      const updated = await this.prisma.taskAssignee.findMany({ where: { taskId: id } });
      return { status: true, data: updated, message: 'Assignees updated' };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to update assignees' };
    }
  }

  // ─── Attachments ──────────────────────────────────────────────────────────────

  async addAttachment(taskId: string, data: { fileName: string; fileUrl: string; fileSize?: number; mimeType?: string }, ctx: Ctx) {
    try {
      const task = await this.prisma.task.findUnique({ where: { id: taskId } });
      if (!task) return { status: false, message: 'Task not found' };

      const attachment = await this.prisma.taskAttachment.create({
        data: { taskId, ...data, uploadedById: ctx.userId },
      });

      await this.logActivity(taskId, ctx.userId ?? 'system', 'attachment_added', undefined, data.fileName);

      return { status: true, data: attachment, message: 'Attachment added' };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to add attachment' };
    }
  }

  async removeAttachment(taskId: string, attachId: string) {
    try {
      const attachment = await this.prisma.taskAttachment.findUnique({ where: { id: attachId } });
      if (!attachment || attachment.taskId !== taskId) return { status: false, message: 'Attachment not found' };

      await this.prisma.taskAttachment.delete({ where: { id: attachId } });
      return { status: true, message: 'Attachment removed' };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to remove attachment' };
    }
  }

  // ─── Reorder ──────────────────────────────────────────────────────────────────

  async reorder(body: ReorderTasksDto) {
    try {
      await this.prisma.$transaction(
        body.ids.map((id, index) => {
          const data: any = { position: index };
          if (body.listId) data.listId = body.listId;
          return this.prisma.task.update({ where: { id }, data });
        }),
      );
      return { status: true, message: 'Tasks reordered' };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to reorder tasks' };
    }
  }

  // ─── My Tasks / Overdue ───────────────────────────────────────────────────────

  async myTasks(employeeId: string) {
    try {
      const now = new Date();
      const tasks = await this.prisma.task.findMany({
        where: {
          assignees: { some: { employeeId } },
          status: { notIn: ['done', 'cancelled'] },
        },
        include: { assignees: true, _count: { select: { subtasks: true } } },
        orderBy: { dueDate: 'asc' },
      });

      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekEnd = new Date(today);
      weekEnd.setDate(weekEnd.getDate() + 7);

      const grouped = {
        overdue: tasks.filter((t) => t.dueDate && t.dueDate < today),
        today: tasks.filter((t) => t.dueDate && t.dueDate >= today && t.dueDate < new Date(today.getTime() + 86400000)),
        thisWeek: tasks.filter((t) => t.dueDate && t.dueDate >= new Date(today.getTime() + 86400000) && t.dueDate <= weekEnd),
        noDueDate: tasks.filter((t) => !t.dueDate),
      };

      return { status: true, data: grouped };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to get my tasks' };
    }
  }

  async overdueTasks() {
    try {
      const tasks = await this.prisma.task.findMany({
        where: {
          dueDate: { lt: new Date() },
          status: { notIn: ['done', 'cancelled'] },
        },
        include: { assignees: true },
        orderBy: { dueDate: 'asc' },
      });
      return { status: true, data: tasks };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to get overdue tasks' };
    }
  }

  // ─── Comments ─────────────────────────────────────────────────────────────────

  async listComments(taskId: string) {
    try {
      const comments = await this.prisma.taskComment.findMany({
        where: { taskId, parentCommentId: null },
        include: { replies: { orderBy: { createdAt: 'asc' } } },
        orderBy: { createdAt: 'asc' },
      });
      return { status: true, data: comments };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to list comments' };
    }
  }

  async createComment(taskId: string, body: CreateCommentDto, ctx: Ctx) {
    try {
      const task = await this.prisma.task.findUnique({ where: { id: taskId } });
      if (!task) return { status: false, message: 'Task not found' };

      const comment = await this.prisma.taskComment.create({
        data: {
          taskId,
          authorId: ctx.userId ?? 'unknown',
          content: body.content,
          parentCommentId: body.parentCommentId,
        },
      });

      await this.logActivity(taskId, ctx.userId ?? 'system', 'commented', undefined, comment.id);

      // Notify assignees of new comment (excluding commenter)
      await this.notifyAssignees(
        taskId,
        `New comment on: ${task.title}`,
        body.content.slice(0, 100),
        'normal',
        ctx.userId,
      );

      return { status: true, data: comment, message: 'Comment added' };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to create comment' };
    }
  }

  async updateComment(commentId: string, body: UpdateCommentDto, ctx: Ctx) {
    try {
      const existing = await this.prisma.taskComment.findUnique({ where: { id: commentId } });
      if (!existing) return { status: false, message: 'Comment not found' };
      if (existing.authorId !== ctx.userId) return { status: false, message: 'Not authorized to edit this comment' };

      const updated = await this.prisma.taskComment.update({
        where: { id: commentId },
        data: { content: body.content, isEdited: true, editedAt: new Date() },
      });

      return { status: true, data: updated, message: 'Comment updated' };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to update comment' };
    }
  }

  async deleteComment(commentId: string, ctx: Ctx) {
    try {
      const existing = await this.prisma.taskComment.findUnique({ where: { id: commentId } });
      if (!existing) return { status: false, message: 'Comment not found' };
      if (existing.authorId !== ctx.userId) return { status: false, message: 'Not authorized to delete this comment' };

      await this.prisma.taskComment.delete({ where: { id: commentId } });
      return { status: true, message: 'Comment deleted' };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to delete comment' };
    }
  }

  // ─── Activity Feed ────────────────────────────────────────────────────────────

  async listActivity(taskId: string) {
    try {
      const activities = await this.prisma.taskActivity.findMany({
        where: { taskId },
        orderBy: { createdAt: 'asc' },
      });
      return { status: true, data: activities };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to list activity' };
    }
  }

  // ─── Internal helpers ─────────────────────────────────────────────────────────

  private async recalcParentCompletion(parentTaskId: string) {
    const subtasks = await this.prisma.task.findMany({
      where: { parentTaskId },
      select: { status: true },
    });
    if (!subtasks.length) return;

    const done = subtasks.filter((s) => s.status === 'done').length;
    const pct = Math.round((done / subtasks.length) * 100);

    await this.prisma.task.update({
      where: { id: parentTaskId },
      data: { completionPercentage: pct },
    });
  }

  // ─── Bulk Actions ─────────────────────────────────────────────────────────────

  async bulkAction(body: { taskIds: string[]; action: string; status?: string; priority?: string; assigneeIds?: string[] }, ctx: Ctx) {
    try {
      if (!body.taskIds?.length) return { status: false, message: 'No task IDs provided' };

      switch (body.action) {
        case 'change_status': {
          if (!body.status) return { status: false, message: 'status is required for change_status action' };
          const data: any = { status: body.status, updatedById: ctx.userId };
          if (body.status === 'done') { data.completedAt = new Date(); data.completionPercentage = 100; }
          await this.prisma.task.updateMany({ where: { id: { in: body.taskIds } }, data });
          // Fire KPI hook for each completed task
          if (body.status === 'done') {
            for (const taskId of body.taskIds) {
              await this.triggerKpiForAssignees(taskId, ctx).catch(() => undefined);
            }
          }
          break;
        }
        case 'change_priority': {
          if (!body.priority) return { status: false, message: 'priority is required for change_priority action' };
          await this.prisma.task.updateMany({ where: { id: { in: body.taskIds } }, data: { priority: body.priority, updatedById: ctx.userId } });
          break;
        }
        case 'reassign': {
          if (!body.assigneeIds?.length) return { status: false, message: 'assigneeIds required for reassign action' };
          for (const taskId of body.taskIds) {
            await this.prisma.taskAssignee.deleteMany({ where: { taskId } });
            await this.prisma.taskAssignee.createMany({
              data: body.assigneeIds.map((employeeId, i) => ({
                taskId, employeeId, role: i === 0 ? 'primary' : 'collaborator', assignedById: ctx.userId,
              })),
              skipDuplicates: true,
            });
          }
          break;
        }
        case 'delete': {
          await this.prisma.task.deleteMany({ where: { id: { in: body.taskIds } } });
          break;
        }
        default:
          return { status: false, message: `Unknown action: ${body.action}` };
      }

      return { status: true, message: `Bulk ${body.action} applied to ${body.taskIds.length} task(s)` };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Bulk action failed' };
    }
  }

  // Called by the due-date reminder job
  async findTasksDueSoon(): Promise<Array<{ id: string; title: string; dueDate: Date; assignees: Array<{ employeeId: string }> }>> {
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    return this.prisma.task.findMany({
      where: {
        dueDate: { gte: now, lte: in24h },
        status: { notIn: ['done', 'cancelled'] },
        notifiedAt: null,
      },
      include: { assignees: true },
    }) as any;
  }

  async markNotified(taskId: string) {
    await this.prisma.task.update({ where: { id: taskId }, data: { notifiedAt: new Date() } });
  }

  // ─── Task Reviews ─────────────────────────────────────────────────────────────

  async createReview(taskId: string, body: { rating: number; feedback?: string }, ctx: Ctx) {
    try {
      const task = await this.prisma.task.findUnique({ where: { id: taskId } });
      if (!task) return { status: false, message: 'Task not found' };
      if (task.status !== 'done') return { status: false, message: 'Task must be done before it can be reviewed' };

      const existing = await this.prisma.taskReview.findUnique({ where: { taskId } });
      if (existing) {
        const updated = await this.prisma.taskReview.update({
          where: { taskId },
          data: { rating: body.rating, feedback: body.feedback, reviewerId: ctx.userId ?? 'unknown' },
        });
        // Re-trigger KPI compute after rating update
        await this.triggerKpiForAssignees(taskId, ctx);
        return { status: true, data: updated, message: 'Review updated' };
      }

      const review = await this.prisma.taskReview.create({
        data: {
          taskId,
          reviewerId: ctx.userId ?? 'unknown',
          rating: body.rating,
          feedback: body.feedback,
        },
      });

      // Trigger KPI quality score recompute for all assignees
      await this.triggerKpiForAssignees(taskId, ctx);

      return { status: true, data: review, message: 'Review submitted' };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to submit review' };
    }
  }

  async getReview(taskId: string) {
    try {
      const review = await this.prisma.taskReview.findUnique({ where: { taskId } });
      if (!review) return { status: false, message: 'No review found for this task' };
      return { status: true, data: review };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to get review' };
    }
  }

  // ─── KPI trigger helper ───────────────────────────────────────────────────────

  private async triggerKpiForAssignees(taskId: string, ctx: Ctx) {
    try {
      const assignees = await this.prisma.taskAssignee.findMany({ where: { taskId } });
      if (!assignees.length) return;

      const now = new Date();
      const month = now.getMonth() + 1;
      const period = `${now.getFullYear()}-${String(month).padStart(2, '0')}`;
      const periodType = 'monthly';

      const taskFormulas = ['task_completion_rate', 'task_quality_score', 'avg_task_completion_hours'];

      const templates = await this.prisma.kpiTemplate.findMany({
        where: { formula: { in: taskFormulas }, metricType: 'auto', status: 'active' },
      });

      for (const assignee of assignees) {
        for (const template of templates) {
          if (!template.formula) continue;
          const metric = await this.kpiCompute.compute(assignee.employeeId, template.formula, period, periodType);
          if (!metric) continue;

          const targetValue = template.targetValue ? Number(template.targetValue) : 100;
          const score = targetValue > 0 ? Math.min(100, (metric.actualValue / targetValue) * 100) : null;

          const existing = await this.prisma.kpiReview.findUnique({
            where: { employeeId_kpiTemplateId_period: { employeeId: assignee.employeeId, kpiTemplateId: template.id, period } },
          });

          if (existing) {
            await this.prisma.kpiReview.update({
              where: { id: existing.id },
              data: { actualValue: metric.actualValue, score, updatedById: ctx.userId },
            });
          } else {
            await this.prisma.kpiReview.create({
              data: {
                employeeId: assignee.employeeId,
                kpiTemplateId: template.id,
                period,
                periodType,
                targetValue,
                actualValue: metric.actualValue,
                score,
                status: 'submitted',
                createdById: ctx.userId,
              },
            });
          }
        }
      }
    } catch {
      // Non-fatal — KPI compute failure should not break task status change
    }
  }
}
