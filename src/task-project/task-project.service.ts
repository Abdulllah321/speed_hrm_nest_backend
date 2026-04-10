import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import {
  CreateTaskProjectDto,
  UpdateTaskProjectDto,
  AddProjectMemberDto,
} from './dto/task-project.dto';

type Ctx = { userId?: string; ipAddress?: string; userAgent?: string };

@Injectable()
export class TaskProjectService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) {}

  async list(filters?: { status?: string; ownerId?: string; departmentId?: string }) {
    try {
      const where: any = {};
      if (filters?.status) where.status = filters.status;
      if (filters?.ownerId) where.ownerId = filters.ownerId;
      if (filters?.departmentId) where.departmentId = filters.departmentId;

      const projects = await this.prisma.taskProject.findMany({
        where,
        include: {
          members: true,
          _count: { select: { lists: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      return { status: true, data: projects };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to list projects' };
    }
  }

  async getOne(id: string) {
    try {
      const project = await this.prisma.taskProject.findUnique({
        where: { id },
        include: {
          members: true,
          labels: true,
          lists: { orderBy: { position: 'asc' } },
          _count: { select: { lists: true } },
        },
      });

      if (!project) return { status: false, message: 'Project not found' };
      return { status: true, data: project };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to get project' };
    }
  }

  async create(body: CreateTaskProjectDto, ctx: Ctx) {
    try {
      const existing = await this.prisma.taskProject.findUnique({ where: { code: body.code } });
      if (existing) return { status: false, message: `Project code "${body.code}" already exists` };

      const project = await this.prisma.taskProject.create({
        data: {
          name: body.name,
          description: body.description,
          code: body.code,
          color: body.color,
          icon: body.icon,
          status: body.status ?? 'active',
          ownerId: body.ownerId,
          departmentId: body.departmentId,
          startDate: body.startDate ? new Date(body.startDate) : undefined,
          dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
          visibility: body.visibility ?? 'public',
          createdById: ctx.userId,
          // Auto-add creator as owner member
          members: {
            create: {
              employeeId: body.ownerId,
              role: 'owner',
              addedById: ctx.userId,
            },
          },
        },
        include: { members: true },
      });

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'task',
        entity: 'TaskProject',
        entityId: project.id,
        description: `Created task project: ${project.name}`,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });

      return { status: true, data: project, message: 'Project created successfully' };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to create project' };
    }
  }

  async update(id: string, body: UpdateTaskProjectDto, ctx: Ctx) {
    try {
      const existing = await this.prisma.taskProject.findUnique({ where: { id } });
      if (!existing) return { status: false, message: 'Project not found' };

      const updated = await this.prisma.taskProject.update({
        where: { id },
        data: {
          ...body,
          startDate: body.startDate ? new Date(body.startDate) : undefined,
          dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
          updatedById: ctx.userId,
        },
      });

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'task',
        entity: 'TaskProject',
        entityId: id,
        description: `Updated task project: ${updated.name}`,
        oldValues: JSON.stringify(existing),
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });

      return { status: true, data: updated, message: 'Project updated successfully' };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to update project' };
    }
  }

  async remove(id: string, ctx: Ctx) {
    try {
      const existing = await this.prisma.taskProject.findUnique({ where: { id } });
      if (!existing) return { status: false, message: 'Project not found' };

      await this.prisma.taskProject.delete({ where: { id } });

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'task',
        entity: 'TaskProject',
        entityId: id,
        description: `Deleted task project: ${existing.name}`,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });

      return { status: true, message: 'Project deleted successfully' };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to delete project' };
    }
  }

  // ─── Members ─────────────────────────────────────────────────────────────────

  async addMember(projectId: string, body: AddProjectMemberDto, ctx: Ctx) {
    try {
      const project = await this.prisma.taskProject.findUnique({ where: { id: projectId } });
      if (!project) return { status: false, message: 'Project not found' };

      const member = await this.prisma.projectMember.upsert({
        where: { projectId_employeeId: { projectId, employeeId: body.employeeId } },
        create: {
          projectId,
          employeeId: body.employeeId,
          role: body.role ?? 'member',
          addedById: ctx.userId,
        },
        update: { role: body.role ?? 'member' },
      });

      return { status: true, data: member, message: 'Member added successfully' };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to add member' };
    }
  }

  async removeMember(projectId: string, employeeId: string, ctx: Ctx) {
    try {
      const member = await this.prisma.projectMember.findUnique({
        where: { projectId_employeeId: { projectId, employeeId } },
      });
      if (!member) return { status: false, message: 'Member not found in project' };

      await this.prisma.projectMember.delete({
        where: { projectId_employeeId: { projectId, employeeId } },
      });

      return { status: true, message: 'Member removed successfully' };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to remove member' };
    }
  }

  async listMembers(projectId: string) {
    try {
      const members = await this.prisma.projectMember.findMany({
        where: { projectId },
        orderBy: { createdAt: 'asc' },
      });
      return { status: true, data: members };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to list members' };
    }
  }
}
