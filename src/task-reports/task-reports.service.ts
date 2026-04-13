import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

function parsePeriod(period: string): { from: Date; to: Date } {
  // "2026-04" monthly or "2026-Q1" quarterly or "2026" yearly
  if (/^\d{4}-Q\d$/.test(period)) {
    const [y, q] = period.split('-');
    const qNum = Number(q.replace('Q', ''));
    const startMonth = (qNum - 1) * 3;
    return { from: new Date(Number(y), startMonth, 1), to: new Date(Number(y), startMonth + 3, 0, 23, 59, 59, 999) };
  }
  if (/^\d{4}-\d{2}$/.test(period)) {
    const [y, m] = period.split('-').map(Number);
    return { from: new Date(y, m - 1, 1), to: new Date(y, m, 0, 23, 59, 59, 999) };
  }
  if (/^\d{4}$/.test(period)) {
    const y = Number(period);
    return { from: new Date(y, 0, 1), to: new Date(y, 11, 31, 23, 59, 59, 999) };
  }
  const now = new Date();
  return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999) };
}

@Injectable()
export class TaskReportsService {
  constructor(private prisma: PrismaService) {}

  // ─── Employee Summary ─────────────────────────────────────────────────────────

  async employeeSummary(employeeId: string, period: string) {
    try {
      const { from, to } = parsePeriod(period);

      const assignedTaskIds = (await this.prisma.taskAssignee.findMany({
        where: { employeeId },
        select: { taskId: true },
      })).map((a) => a.taskId);

      if (!assignedTaskIds.length) {
        return { status: true, data: { employeeId, period, assigned: 0, completed: 0, overdue: 0, completionRate: 0, avgCompletionHours: null, qualityScore: null } };
      }

      const now = new Date();

      const [assigned, completed, overdue, reviews, hoursData] = await Promise.all([
        this.prisma.task.count({ where: { id: { in: assignedTaskIds }, createdAt: { gte: from, lte: to } } }),
        this.prisma.task.count({ where: { id: { in: assignedTaskIds }, status: 'done', completedAt: { gte: from, lte: to } } }),
        this.prisma.task.count({ where: { id: { in: assignedTaskIds }, dueDate: { lt: now }, status: { notIn: ['done', 'cancelled'] } } }),
        this.prisma.taskReview.findMany({ where: { taskId: { in: assignedTaskIds }, createdAt: { gte: from, lte: to } }, select: { rating: true } }),
        this.prisma.task.findMany({
          where: { id: { in: assignedTaskIds }, status: 'done', completedAt: { gte: from, lte: to }, actualHours: { not: null } },
          select: { actualHours: true },
        }),
      ]);

      const completionRate = assigned > 0 ? Math.round((completed / assigned) * 100 * 100) / 100 : 0;
      const avgCompletionHours = hoursData.length > 0
        ? Math.round((hoursData.reduce((s, t) => s + Number(t.actualHours), 0) / hoursData.length) * 100) / 100
        : null;
      const qualityScore = reviews.length > 0
        ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 20 * 100) / 100
        : null;

      return { status: true, data: { employeeId, period, assigned, completed, overdue, completionRate, avgCompletionHours, qualityScore } };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to generate employee summary' };
    }
  }

  // ─── Project Summary ──────────────────────────────────────────────────────────

  async projectSummary(projectId: string) {
    try {
      const project = await this.prisma.taskProject.findUnique({
        where: { id: projectId },
        include: { members: true },
      });
      if (!project) return { status: false, message: 'Project not found' };

      const now = new Date();

      const [total, completed, overdue, tasks] = await Promise.all([
        this.prisma.task.count({ where: { projectId, parentTaskId: null } }),
        this.prisma.task.count({ where: { projectId, status: 'done', parentTaskId: null } }),
        this.prisma.task.count({ where: { projectId, dueDate: { lt: now }, status: { notIn: ['done', 'cancelled'] } } }),
        this.prisma.task.findMany({
          where: { projectId, parentTaskId: null },
          include: { assignees: true },
        }),
      ]);

      // Member contributions
      const contributionMap: Record<string, { assigned: number; completed: number }> = {};
      for (const task of tasks) {
        for (const a of task.assignees) {
          if (!contributionMap[a.employeeId]) contributionMap[a.employeeId] = { assigned: 0, completed: 0 };
          contributionMap[a.employeeId].assigned++;
          if (task.status === 'done') contributionMap[a.employeeId].completed++;
        }
      }

      const completionPct = total > 0 ? Math.round((completed / total) * 100) : 0;

      return {
        status: true,
        data: {
          projectId,
          name: project.name,
          code: project.code,
          status: project.status,
          total,
          completed,
          overdue,
          completionPct,
          memberContributions: Object.entries(contributionMap).map(([employeeId, v]) => ({ employeeId, ...v })),
        },
      };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to generate project summary' };
    }
  }

  // ─── Department Summary ───────────────────────────────────────────────────────

  async departmentSummary(departmentId: string, period: string) {
    try {
      const { from, to } = parsePeriod(period);

      const employees = await this.prisma.employee.findMany({
        where: { departmentId },
        select: { id: true, employeeName: true },
      });
      if (!employees.length) return { status: true, data: { departmentId, period, employees: [] } };

      const employeeIds = employees.map((e) => e.id);

      const assignees = await this.prisma.taskAssignee.findMany({
        where: { employeeId: { in: employeeIds } },
        select: { taskId: true, employeeId: true },
      });

      const taskIdsByEmployee: Record<string, string[]> = {};
      for (const a of assignees) {
        if (!taskIdsByEmployee[a.employeeId]) taskIdsByEmployee[a.employeeId] = [];
        taskIdsByEmployee[a.employeeId].push(a.taskId);
      }

      const allTaskIds = [...new Set(assignees.map((a) => a.taskId))];
      const tasks = allTaskIds.length
        ? await this.prisma.task.findMany({
            where: { id: { in: allTaskIds }, createdAt: { gte: from, lte: to } },
            select: { id: true, status: true, dueDate: true, completedAt: true },
          })
        : [];

      const taskMap = new Map(tasks.map((t) => [t.id, t]));
      const now = new Date();

      const summaries = employees.map((emp) => {
        const empTaskIds = taskIdsByEmployee[emp.id] ?? [];
        const empTasks = empTaskIds.map((id) => taskMap.get(id)).filter(Boolean) as typeof tasks;
        const assigned = empTasks.length;
        const completed = empTasks.filter((t) => t.status === 'done').length;
        const overdue = empTasks.filter((t) => t.dueDate && t.dueDate < now && !['done', 'cancelled'].includes(t.status)).length;
        const completionRate = assigned > 0 ? Math.round((completed / assigned) * 100) : 0;
        return { employeeId: emp.id, employeeName: emp.employeeName, assigned, completed, overdue, completionRate };
      });

      const totals = summaries.reduce((acc, s) => ({
        assigned: acc.assigned + s.assigned,
        completed: acc.completed + s.completed,
        overdue: acc.overdue + s.overdue,
      }), { assigned: 0, completed: 0, overdue: 0 });

      return { status: true, data: { departmentId, period, ...totals, employees: summaries } };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to generate department summary' };
    }
  }

  // ─── CSV Export ───────────────────────────────────────────────────────────────

  async exportCsv(projectId: string): Promise<string> {
    const tasks = await this.prisma.task.findMany({
      where: { projectId },
      include: {
        assignees: true,
        list: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const header = ['ID', 'Title', 'List', 'Status', 'Priority', 'Type', 'Assignees', 'Start Date', 'Due Date', 'Estimated Hours', 'Actual Hours', 'Completion %', 'Completed At', 'Created At'];

    const rows = tasks.map((t) => [
      t.id,
      `"${t.title.replace(/"/g, '""')}"`,
      `"${t.list?.name ?? ''}"`,
      t.status,
      t.priority,
      t.type,
      `"${t.assignees.map((a) => a.employeeId).join('; ')}"`,
      t.startDate ? t.startDate.toISOString().split('T')[0] : '',
      t.dueDate ? t.dueDate.toISOString().split('T')[0] : '',
      t.estimatedHours != null ? String(t.estimatedHours) : '',
      t.actualHours != null ? String(t.actualHours) : '',
      String(t.completionPercentage),
      t.completedAt ? t.completedAt.toISOString().split('T')[0] : '',
      t.createdAt.toISOString().split('T')[0],
    ]);

    return [header.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }

  // ─── Dashboard Widgets ────────────────────────────────────────────────────────

  async adminWidgets() {
    try {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const tomorrow = new Date(today.getTime() + 86400000);
      const weekStart = new Date(today);
      weekStart.setDate(weekStart.getDate() - 7);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const [dueToday, overdue, completedThisWeek, totalThisWeek, topEmployeesRaw] = await Promise.all([
        this.prisma.task.count({ where: { dueDate: { gte: today, lt: tomorrow }, status: { notIn: ['done', 'cancelled'] } } }),
        this.prisma.task.findMany({
          where: { dueDate: { lt: now }, status: { notIn: ['done', 'cancelled'] } },
          include: { assignees: true },
          orderBy: { dueDate: 'asc' },
          take: 20,
        }),
        this.prisma.task.count({ where: { status: 'done', completedAt: { gte: weekStart } } }),
        this.prisma.task.count({ where: { createdAt: { gte: weekStart } } }),
        this.prisma.taskAssignee.groupBy({
          by: ['employeeId'],
          where: { task: { status: 'done', completedAt: { gte: monthStart } } },
          _count: { taskId: true },
          orderBy: { _count: { taskId: 'desc' } },
          take: 5,
        }),
      ]);

      const completionRateThisWeek = totalThisWeek > 0 ? Math.round((completedThisWeek / totalThisWeek) * 100) : 0;

      return {
        status: true,
        data: {
          dueToday,
          overdue: { count: overdue.length, items: overdue },
          completionRateThisWeek,
          topEmployeesThisMonth: topEmployeesRaw.map((e) => ({ employeeId: e.employeeId, tasksCompleted: e._count.taskId })),
        },
      };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to get admin widgets' };
    }
  }

  async employeeWidgets(employeeId: string) {
    try {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      const assignedIds = (await this.prisma.taskAssignee.findMany({
        where: { employeeId },
        select: { taskId: true },
      })).map((a) => a.taskId);

      const [openCount, overdueCount, completedThisMonth, totalThisMonth] = await Promise.all([
        this.prisma.task.count({ where: { id: { in: assignedIds }, status: { notIn: ['done', 'cancelled'] } } }),
        this.prisma.task.count({ where: { id: { in: assignedIds }, dueDate: { lt: now }, status: { notIn: ['done', 'cancelled'] } } }),
        this.prisma.task.count({ where: { id: { in: assignedIds }, status: 'done', completedAt: { gte: monthStart } } }),
        this.prisma.task.count({ where: { id: { in: assignedIds }, createdAt: { gte: monthStart } } }),
      ]);

      const completionRate = totalThisMonth > 0 ? Math.round((completedThisMonth / totalThisMonth) * 100) : 0;

      return {
        status: true,
        data: { employeeId, period, openTasks: openCount, overdueTasks: overdueCount, completionRateThisMonth: completionRate },
      };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to get employee widgets' };
    }
  }
}
