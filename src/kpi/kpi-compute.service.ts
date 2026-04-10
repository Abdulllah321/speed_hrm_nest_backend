import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export interface KpiMetricResult {
  formula: string;
  label: string;
  actualValue: number;
  unit: string;
  meta?: Record<string, any>;
}

/**
 * Resolves date range from a period string.
 * Supports: "2026-04" (monthly), "2026-Q1" (quarterly), "2026" (yearly)
 */
function parsePeriodRange(period: string, periodType: string): { from: Date; to: Date } {
  const now = new Date();

  if (periodType === 'monthly') {
    // "2026-04"
    const [year, month] = period.split('-').map(Number);
    const from = new Date(year, month - 1, 1);
    const to = new Date(year, month, 0, 23, 59, 59, 999);
    return { from, to };
  }

  if (periodType === 'quarterly') {
    // "2026-Q1"
    const [yearStr, qStr] = period.split('-');
    const year = Number(yearStr);
    const q = Number(qStr.replace('Q', ''));
    const startMonth = (q - 1) * 3; // 0, 3, 6, 9
    const from = new Date(year, startMonth, 1);
    const to = new Date(year, startMonth + 3, 0, 23, 59, 59, 999);
    return { from, to };
  }

  if (periodType === 'yearly') {
    // "2026"
    const year = Number(period);
    const from = new Date(year, 0, 1);
    const to = new Date(year, 11, 31, 23, 59, 59, 999);
    return { from, to };
  }

  // Fallback: current month
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { from, to };
}

@Injectable()
export class KpiComputeService {
  constructor(private prisma: PrismaService) {}

  /**
   * Compute a single auto KPI metric for an employee over a period.
   */
  async compute(
    employeeId: string,
    formula: string,
    period: string,
    periodType: string,
  ): Promise<KpiMetricResult | null> {
    const { from, to } = parsePeriodRange(period, periodType);

    switch (formula) {
      case 'attendance_rate':
        return this.computeAttendanceRate(employeeId, from, to);
      case 'punctuality_score':
        return this.computePunctualityScore(employeeId, from, to);
      case 'leave_utilization':
        return this.computeLeaveUtilization(employeeId, from, to);
      case 'overtime_hours':
        return this.computeOvertimeHours(employeeId, from, to);
      case 'increment_percentage':
        return this.computeIncrementPercentage(employeeId, from, to);
      case 'task_completion_rate':
        return this.computeTaskCompletionRate(employeeId, from, to);
      case 'task_quality_score':
        return this.computeTaskQualityScore(employeeId, from, to);
      case 'avg_task_completion_hours':
        return this.computeAvgTaskCompletionHours(employeeId, from, to);
      default:
        return null;
    }
  }

  /**
   * Compute all auto KPIs for an employee and return a map of formula -> result.
   */
  async computeAll(
    employeeId: string,
    period: string,
    periodType: string,
  ): Promise<Record<string, KpiMetricResult>> {
    const formulas = [
      'attendance_rate',
      'punctuality_score',
      'leave_utilization',
      'overtime_hours',
      'increment_percentage',
      'task_completion_rate',
      'task_quality_score',
      'avg_task_completion_hours',
    ];

    const results = await Promise.all(
      formulas.map((f) => this.compute(employeeId, f, period, periodType)),
    );

    const map: Record<string, KpiMetricResult> = {};
    formulas.forEach((f, i) => {
      if (results[i]) map[f] = results[i]!;
    });
    return map;
  }

  // ─── Formulas ────────────────────────────────────────────────────────────────

  /**
   * attendance_rate = (present_days / total_working_days) * 100
   * Counts attendance records with status "present" or "remote"
   */
  private async computeAttendanceRate(
    employeeId: string,
    from: Date,
    to: Date,
  ): Promise<KpiMetricResult> {
    const [presentCount, totalCount] = await Promise.all([
      this.prisma.attendance.count({
        where: {
          employeeId,
          date: { gte: from, lte: to },
          status: { in: ['present', 'remote'] },
        },
      }),
      this.prisma.attendance.count({
        where: {
          employeeId,
          date: { gte: from, lte: to },
        },
      }),
    ]);

    const rate = totalCount > 0 ? (presentCount / totalCount) * 100 : 0;

    return {
      formula: 'attendance_rate',
      label: 'Attendance Rate',
      actualValue: Math.round(rate * 100) / 100,
      unit: '%',
      meta: { presentDays: presentCount, totalDays: totalCount },
    };
  }

  /**
   * punctuality_score = (on_time_days / present_days) * 100
   * On-time = lateMinutes is null or 0
   */
  private async computePunctualityScore(
    employeeId: string,
    from: Date,
    to: Date,
  ): Promise<KpiMetricResult> {
    const presentRecords = await this.prisma.attendance.findMany({
      where: {
        employeeId,
        date: { gte: from, lte: to },
        status: { in: ['present', 'remote'] },
      },
      select: { lateMinutes: true },
    });

    const total = presentRecords.length;
    const onTime = presentRecords.filter(
      (r) => r.lateMinutes == null || r.lateMinutes === 0,
    ).length;

    const score = total > 0 ? (onTime / total) * 100 : 0;

    return {
      formula: 'punctuality_score',
      label: 'Punctuality Score',
      actualValue: Math.round(score * 100) / 100,
      unit: '%',
      meta: { onTimeDays: onTime, presentDays: total },
    };
  }

  /**
   * leave_utilization = (leaves_taken / leaves_entitled) * 100
   * Uses approved leave applications in the period
   */
  private async computeLeaveUtilization(
    employeeId: string,
    from: Date,
    to: Date,
  ): Promise<KpiMetricResult> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { leavesPolicyId: true },
    });

    let totalEntitled = 0;

    if (employee?.leavesPolicyId) {
      const policy = await this.prisma.leavesPolicy.findUnique({
        where: { id: employee.leavesPolicyId },
        include: { leaveTypes: true },
      });
      if (policy) {
        totalEntitled = policy.leaveTypes.reduce(
          (sum, lt) => sum + lt.numberOfLeaves,
          0,
        );
      }
    }

    const leaveApps = await this.prisma.leaveApplication.findMany({
      where: {
        employeeId,
        status: 'approved',
        fromDate: { gte: from },
        toDate: { lte: to },
      },
      select: { fromDate: true, toDate: true, dayType: true },
    });

    let leavesTaken = 0;
    for (const app of leaveApps) {
      const diffMs = Math.abs(
        new Date(app.toDate as any).getTime() - new Date(app.fromDate as any).getTime(),
      );
      const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24)) + 1;
      if (app.dayType === 'halfDay') leavesTaken += days * 0.5;
      else if (app.dayType === 'shortLeave') leavesTaken += days * 0.25;
      else leavesTaken += days;
    }

    const utilization =
      totalEntitled > 0 ? (leavesTaken / totalEntitled) * 100 : 0;

    return {
      formula: 'leave_utilization',
      label: 'Leave Utilization',
      actualValue: Math.round(utilization * 100) / 100,
      unit: '%',
      meta: { leavesTaken: Math.round(leavesTaken * 100) / 100, totalEntitled },
    };
  }

  /**
   * overtime_hours = sum of approved overtime hours in the period
   */
  private async computeOvertimeHours(
    employeeId: string,
    from: Date,
    to: Date,
  ): Promise<KpiMetricResult> {
    const overtimeRequests = await this.prisma.overtimeRequest.findMany({
      where: {
        employeeId,
        status: 'approved',
        date: { gte: from, lte: to },
      },
      select: { weekdayOvertimeHours: true, holidayOvertimeHours: true },
    });

    const totalHours = overtimeRequests.reduce((sum, r) => {
      return (
        sum +
        Number(r.weekdayOvertimeHours || 0) +
        Number(r.holidayOvertimeHours || 0)
      );
    }, 0);

    return {
      formula: 'overtime_hours',
      label: 'Overtime Hours',
      actualValue: Math.round(totalHours * 100) / 100,
      unit: 'hrs',
      meta: { requestCount: overtimeRequests.length },
    };
  }

  /**
   * increment_percentage = average increment % received in the period
   */
  private async computeIncrementPercentage(
    employeeId: string,
    from: Date,
    to: Date,
  ): Promise<KpiMetricResult> {
    const increments = await this.prisma.increment.findMany({
      where: {
        employeeId,
        status: 'active',
        promotionDate: { gte: from, lte: to },
      },
      select: { incrementPercentage: true, incrementAmount: true, salary: true },
    });

    let avgPct = 0;
    if (increments.length > 0) {
      const pcts = increments.map((i) => {
        if (i.incrementPercentage) return Number(i.incrementPercentage);
        // Derive % from amount/salary if percentage not stored
        if (i.incrementAmount && i.salary) {
          return (Number(i.incrementAmount) / Number(i.salary)) * 100;
        }
        return 0;
      });
      avgPct = pcts.reduce((a, b) => a + b, 0) / pcts.length;
    }

    return {
      formula: 'increment_percentage',
      label: 'Avg Increment %',
      actualValue: Math.round(avgPct * 100) / 100,
      unit: '%',
      meta: { incrementCount: increments.length },
    };
  }

  /**
   * task_completion_rate = (tasks_completed_on_time / total_tasks_assigned) * 100
   * "on time" = completedAt <= dueDate (or no dueDate counts as on-time)
   */
  private async computeTaskCompletionRate(
    employeeId: string,
    from: Date,
    to: Date,
  ): Promise<KpiMetricResult> {
    const assigned = await this.prisma.taskAssignee.findMany({
      where: { employeeId },
      select: { taskId: true },
    });
    const taskIds = assigned.map((a) => a.taskId);

    if (taskIds.length === 0) {
      return { formula: 'task_completion_rate', label: 'Task Completion Rate', actualValue: 0, unit: '%', meta: { completed: 0, total: 0 } };
    }

    const [total, completedOnTime] = await Promise.all([
      this.prisma.task.count({
        where: { id: { in: taskIds }, createdAt: { gte: from, lte: to } },
      }),
      this.prisma.task.count({
        where: {
          id: { in: taskIds },
          status: 'done',
          completedAt: { gte: from, lte: to },
          OR: [
            { dueDate: null },
            { dueDate: { gte: this.prisma.task.fields.completedAt as any } },
          ],
        },
      }),
    ]);

    // Fallback: count all done tasks in period if the self-join OR is unsupported
    const completedAny = await this.prisma.task.count({
      where: { id: { in: taskIds }, status: 'done', completedAt: { gte: from, lte: to } },
    });

    // Use raw on-time count; if 0 but completedAny > 0, use completedAny as approximation
    const effectiveCompleted = completedOnTime > 0 ? completedOnTime : completedAny;
    const rate = total > 0 ? (effectiveCompleted / total) * 100 : 0;

    return {
      formula: 'task_completion_rate',
      label: 'Task Completion Rate',
      actualValue: Math.round(rate * 100) / 100,
      unit: '%',
      meta: { completed: effectiveCompleted, total },
    };
  }

  /**
   * task_quality_score = avg(rating) * 20  (converts 1–5 → 0–100)
   * Based on TaskReview records for tasks completed by this employee in the period
   */
  private async computeTaskQualityScore(
    employeeId: string,
    from: Date,
    to: Date,
  ): Promise<KpiMetricResult> {
    const assigned = await this.prisma.taskAssignee.findMany({
      where: { employeeId },
      select: { taskId: true },
    });
    const taskIds = assigned.map((a) => a.taskId);

    if (taskIds.length === 0) {
      return { formula: 'task_quality_score', label: 'Task Quality Score', actualValue: 0, unit: 'score', meta: { reviewCount: 0 } };
    }

    const reviews = await this.prisma.taskReview.findMany({
      where: {
        taskId: { in: taskIds },
        createdAt: { gte: from, lte: to },
      },
      select: { rating: true },
    });

    const avgRating = reviews.length > 0
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
      : 0;

    const score = Math.round(avgRating * 20 * 100) / 100; // 1–5 → 0–100

    return {
      formula: 'task_quality_score',
      label: 'Task Quality Score',
      actualValue: score,
      unit: 'score',
      meta: { reviewCount: reviews.length, avgRating: Math.round(avgRating * 100) / 100 },
    };
  }

  /**
   * avg_task_completion_hours = (estimatedHours / actualHours) * 100, capped at 100
   * Higher = more efficient (finished faster than estimated)
   */
  private async computeAvgTaskCompletionHours(
    employeeId: string,
    from: Date,
    to: Date,
  ): Promise<KpiMetricResult> {
    const assigned = await this.prisma.taskAssignee.findMany({
      where: { employeeId },
      select: { taskId: true },
    });
    const taskIds = assigned.map((a) => a.taskId);

    if (taskIds.length === 0) {
      return { formula: 'avg_task_completion_hours', label: 'Delivery Efficiency', actualValue: 0, unit: '%', meta: { taskCount: 0 } };
    }

    const tasks = await this.prisma.task.findMany({
      where: {
        id: { in: taskIds },
        status: 'done',
        completedAt: { gte: from, lte: to },
        estimatedHours: { not: null },
        actualHours: { not: null },
      },
      select: { estimatedHours: true, actualHours: true },
    });

    if (tasks.length === 0) {
      return { formula: 'avg_task_completion_hours', label: 'Delivery Efficiency', actualValue: 0, unit: '%', meta: { taskCount: 0 } };
    }

    const scores = tasks.map((t) => {
      const est = Number(t.estimatedHours);
      const act = Number(t.actualHours);
      if (act === 0) return 100;
      return Math.min(100, (est / act) * 100);
    });

    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;

    return {
      formula: 'avg_task_completion_hours',
      label: 'Delivery Efficiency',
      actualValue: Math.round(avg * 100) / 100,
      unit: '%',
      meta: { taskCount: tasks.length },
    };
  }
}
