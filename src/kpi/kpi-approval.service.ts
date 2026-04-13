import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PrismaMasterService } from '../database/prisma-master.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { NotificationsService } from '../notifications/notifications.service';

type Ctx = { userId?: string; ipAddress?: string; userAgent?: string };

@Injectable()
export class KpiApprovalService {
  constructor(
    private prisma: PrismaService,
    private prismaMaster: PrismaMasterService,
    private activityLogs: ActivityLogsService,
    private notifications: NotificationsService,
  ) {}

  /**
   * Submit a review for manager approval.
   * Transitions: pending → submitted
   * Notifies the employee's reporting manager (if linked to a user account).
   */
  async submit(reviewId: string, ctx: Ctx) {
    try {
      const review = await this.prisma.kpiReview.findUnique({
        where: { id: reviewId },
        include: {
          employee: { select: { id: true, employeeName: true, reportingManager: true, userId: true } },
          kpiTemplate: { select: { name: true } },
        },
      });

      if (!review) return { status: false, message: 'KPI review not found' };
      if (review.status !== 'pending') {
        return { status: false, message: `Review is already ${review.status}` };
      }

      const updated = await this.prisma.kpiReview.update({
        where: { id: reviewId },
        data: { status: 'submitted', updatedById: ctx.userId },
        include: { kpiTemplate: true },
      });

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'kpi',
        entity: 'KpiReview',
        entityId: reviewId,
        description: `Submitted KPI review "${review.kpiTemplate?.name}" for ${review.employee.employeeName} — period ${review.period}`,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });

      // Notify reporting manager
      await this.notifyManager(review, 'submitted', ctx);

      return { status: true, data: updated, message: 'Review submitted for approval' };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to submit review' };
    }
  }

  /**
   * Approve a submitted review.
   * Transitions: submitted → approved
   * Notifies the employee.
   */
  async approve(reviewId: string, notes: string | undefined, ctx: Ctx) {
    try {
      const review = await this.prisma.kpiReview.findUnique({
        where: { id: reviewId },
        include: {
          employee: { select: { id: true, employeeName: true, userId: true, reportingManager: true } },
          kpiTemplate: { select: { name: true } },
        },
      });

      if (!review) return { status: false, message: 'KPI review not found' };
      if (review.status !== 'submitted') {
        return { status: false, message: `Review must be in "submitted" status to approve (current: ${review.status})` };
      }

      const updated = await this.prisma.kpiReview.update({
        where: { id: reviewId },
        data: {
          status: 'approved',
          reviewedById: ctx.userId,
          ...(notes && { notes }),
          updatedById: ctx.userId,
        },
        include: { kpiTemplate: true },
      });

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'kpi',
        entity: 'KpiReview',
        entityId: reviewId,
        description: `Approved KPI review "${review.kpiTemplate?.name}" for ${review.employee.employeeName}`,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });

      // Notify employee
      await this.notifyEmployee(review, 'approved', ctx);

      return { status: true, data: updated, message: 'Review approved successfully' };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to approve review' };
    }
  }

  /**
   * Reject a submitted review with a reason.
   * Transitions: submitted → rejected
   * Notifies the employee.
   */
  async reject(reviewId: string, rejectionReason: string, ctx: Ctx) {
    try {
      if (!rejectionReason?.trim()) {
        return { status: false, message: 'Rejection reason is required' };
      }

      const review = await this.prisma.kpiReview.findUnique({
        where: { id: reviewId },
        include: {
          employee: { select: { id: true, employeeName: true, userId: true, reportingManager: true } },
          kpiTemplate: { select: { name: true } },
        },
      });

      if (!review) return { status: false, message: 'KPI review not found' };
      if (review.status !== 'submitted') {
        return { status: false, message: `Review must be in "submitted" status to reject (current: ${review.status})` };
      }

      const updated = await this.prisma.kpiReview.update({
        where: { id: reviewId },
        data: {
          status: 'rejected',
          rejectionReason,
          reviewedById: ctx.userId,
          updatedById: ctx.userId,
        },
        include: { kpiTemplate: true },
      });

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'kpi',
        entity: 'KpiReview',
        entityId: reviewId,
        description: `Rejected KPI review "${review.kpiTemplate?.name}" for ${review.employee.employeeName} — reason: ${rejectionReason}`,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });

      // Notify employee
      await this.notifyEmployee(review, 'rejected', ctx, rejectionReason);

      return { status: true, data: updated, message: 'Review rejected' };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to reject review' };
    }
  }

  /**
   * Bulk approve all submitted reviews for a period.
   */
  async bulkApprove(period: string, employeeIds: string[] | undefined, ctx: Ctx) {
    try {
      const where: any = { period, status: 'submitted' };
      if (employeeIds?.length) where.employeeId = { in: employeeIds };

      const reviews = await this.prisma.kpiReview.findMany({
        where,
        include: {
          employee: { select: { id: true, employeeName: true, userId: true } },
          kpiTemplate: { select: { name: true } },
        },
      });

      if (reviews.length === 0) {
        return { status: true, data: { approved: 0 }, message: 'No submitted reviews found for this period' };
      }

      await this.prisma.kpiReview.updateMany({
        where: { id: { in: reviews.map((r) => r.id) } },
        data: { status: 'approved', reviewedById: ctx.userId, updatedById: ctx.userId },
      });

      // Notify each employee
      await Promise.all(
        reviews.map((r) => this.notifyEmployee(r, 'approved', ctx)),
      );

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'kpi',
        entity: 'KpiReview',
        description: `Bulk approved ${reviews.length} KPI review(s) for period ${period}`,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });

      return { status: true, data: { approved: reviews.length }, message: `${reviews.length} review(s) approved` };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to bulk approve reviews' };
    }
  }

  /**
   * List reviews pending approval (status = submitted), optionally filtered by period/department.
   */
  async listPendingApproval(params?: { period?: string; departmentId?: string }) {
    try {
      const where: any = { status: 'submitted' };
      if (params?.period) where.period = params.period;

      const reviews = await this.prisma.kpiReview.findMany({
        where,
        include: {
          employee: { select: { id: true, employeeId: true, employeeName: true, departmentId: true } },
          kpiTemplate: { select: { id: true, name: true, category: true, unit: true, weight: true } },
        },
        orderBy: { updatedAt: 'desc' },
      });

      // Enrich with department names
      const deptIds = [...new Set(reviews.map((r) => r.employee?.departmentId).filter(Boolean))] as string[];
      const departments = deptIds.length
        ? await this.prisma.department.findMany({ where: { id: { in: deptIds } }, select: { id: true, name: true } })
        : [];
      const deptMap = new Map(departments.map((d) => [d.id, d.name]));

      let enriched = reviews.map((r) => ({
        ...r,
        employee: r.employee
          ? { ...r.employee, departmentName: deptMap.get(r.employee.departmentId) || null }
          : null,
      }));

      if (params?.departmentId) {
        enriched = enriched.filter((r) => r.employee?.departmentId === params.departmentId);
      }

      return { status: true, data: enriched };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to list pending approvals' };
    }
  }

  // ─── Notification helpers ─────────────────────────────────────────────────

  private async notifyManager(review: any, action: string, ctx: Ctx) {
    try {
      if (!review.employee?.reportingManager) return;

      // Resolve manager's userId
      const manager = await this.prisma.employee.findUnique({
        where: { id: review.employee.reportingManager },
        select: { userId: true, employeeName: true },
      });
      if (!manager?.userId) return;

      await this.notifications.create({
        userId: manager.userId,
        title: 'KPI Review Awaiting Approval',
        message: `${review.employee.employeeName}'s KPI review "${review.kpiTemplate?.name}" for ${review.period} has been submitted for your approval.`,
        category: 'kpi',
        priority: 'normal',
        actionType: 'kpi.review.pending-approval',
        actionPayload: { reviewId: review.id },
        entityType: 'KpiReview',
        entityId: review.id,
        channels: ['inApp'],
      });
    } catch {
      // Non-fatal — don't fail the main operation
    }
  }

  private async notifyEmployee(review: any, action: 'approved' | 'rejected', ctx: Ctx, reason?: string) {
    try {
      const employeeUserId = review.employee?.userId;
      if (!employeeUserId) return;

      const isApproved = action === 'approved';

      // Resolve reviewer name
      let reviewerName = 'Manager';
      if (ctx.userId) {
        const reviewer = await this.prismaMaster.user.findUnique({
          where: { id: ctx.userId },
          select: { firstName: true, lastName: true },
        });
        if (reviewer) reviewerName = `${reviewer.firstName} ${reviewer.lastName}`.trim();
      }

      await this.notifications.create({
        userId: employeeUserId,
        title: isApproved ? 'KPI Review Approved' : 'KPI Review Rejected',
        message: isApproved
          ? `Your KPI review "${review.kpiTemplate?.name}" for ${review.period} has been approved by ${reviewerName}.`
          : `Your KPI review "${review.kpiTemplate?.name}" for ${review.period} was rejected by ${reviewerName}. Reason: ${reason || 'No reason provided'}`,
        category: 'kpi',
        priority: isApproved ? 'normal' : 'high',
        actionType: `kpi.review.${action}`,
        actionPayload: { reviewId: review.id },
        entityType: 'KpiReview',
        entityId: review.id,
        channels: ['inApp'],
      });
    } catch {
      // Non-fatal
    }
  }
}
