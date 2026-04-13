import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { CreateTaskListDto, UpdateTaskListDto, ReorderTaskListDto } from './dto/task-list.dto';

type Ctx = { userId?: string; ipAddress?: string; userAgent?: string };

@Injectable()
export class TaskListService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) {}

  async listByProject(projectId: string) {
    try {
      const lists = await this.prisma.taskList.findMany({
        where: { projectId },
        include: { _count: { select: { tasks: true } } },
        orderBy: { position: 'asc' },
      });
      return { status: true, data: lists };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to list task lists' };
    }
  }

  async create(projectId: string, body: CreateTaskListDto, ctx: Ctx) {
    try {
      const project = await this.prisma.taskProject.findUnique({ where: { id: projectId } });
      if (!project) return { status: false, message: 'Project not found' };

      // Auto-assign next position if not provided
      let position = body.position;
      if (position === undefined) {
        const last = await this.prisma.taskList.findFirst({
          where: { projectId },
          orderBy: { position: 'desc' },
        });
        position = last ? last.position + 1 : 0;
      }

      const list = await this.prisma.taskList.create({
        data: {
          projectId,
          name: body.name,
          color: body.color,
          position,
          createdById: ctx.userId,
        },
      });

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'task',
        entity: 'TaskList',
        entityId: list.id,
        description: `Created task list: ${list.name} in project ${projectId}`,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });

      return { status: true, data: list, message: 'Task list created successfully' };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to create task list' };
    }
  }

  async update(id: string, body: UpdateTaskListDto, ctx: Ctx) {
    try {
      const existing = await this.prisma.taskList.findUnique({ where: { id } });
      if (!existing) return { status: false, message: 'Task list not found' };

      const updated = await this.prisma.taskList.update({ where: { id }, data: body });

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'task',
        entity: 'TaskList',
        entityId: id,
        description: `Updated task list: ${updated.name}`,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });

      return { status: true, data: updated, message: 'Task list updated successfully' };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to update task list' };
    }
  }

  async remove(id: string, ctx: Ctx) {
    try {
      const existing = await this.prisma.taskList.findUnique({ where: { id } });
      if (!existing) return { status: false, message: 'Task list not found' };

      await this.prisma.taskList.delete({ where: { id } });

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'task',
        entity: 'TaskList',
        entityId: id,
        description: `Deleted task list: ${existing.name}`,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });

      return { status: true, message: 'Task list deleted successfully' };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to delete task list' };
    }
  }

  async reorder(body: ReorderTaskListDto) {
    try {
      await this.prisma.$transaction(
        body.ids.map((id, index) =>
          this.prisma.taskList.update({ where: { id }, data: { position: index } }),
        ),
      );
      return { status: true, message: 'Task lists reordered successfully' };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to reorder task lists' };
    }
  }
}
