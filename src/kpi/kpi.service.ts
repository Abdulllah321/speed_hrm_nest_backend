import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PrismaMasterService } from '../database/prisma-master.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { KpiComputeService } from './kpi-compute.service';
import {
  CreateKpiTemplateDto,
  UpdateKpiTemplateDto,
  CreateKpiReviewDto,
  UpdateKpiReviewDto,
} from './dto/kpi.dto';

type Ctx = { userId?: string; ipAddress?: string; userAgent?: string };

@Injectable()
export class KpiService {
  constructor(
    private prisma: PrismaService,
    private prismaMaster: PrismaMasterService,
    private activityLogs: ActivityLogsService,
    private compute: KpiComputeService,
  ) {}

  // ─── KPI Templates ───────────────────────────────────────────────────────────

  async listTemplates(params?: { category?: string; status?: string }) {
    try {
      const where: any = {};
      if (params?.category) where.category = params.category;
      if (params?.status) where.status = params.status;

      const templates = await this.prisma.kpiTemplate.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      });

      return { status: true, data: templates };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to list KPI templates' };
    }
  }

  async getTemplate(id: string) {
    try {
      const template = await this.prisma.kpiTemplate.findUnique({ where: { id } });
      if (!template) return { status: false, message: 'KPI template not found' };
      return { status: true, data: template };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to get KPI template' };
    }
  }

  async createTemplate(body: CreateKpiTemplateDto, ctx: Ctx) {
    try {
      const template = await this.prisma.kpiTemplate.create({
        data: {
          name: body.name,
          description: body.description,
          category: body.category,
          metricType: body.metricType,
          formula: body.formula,
          unit: body.unit,
          targetValue: body.targetValue,
          weight: body.weight ?? 1,
          createdById: ctx.userId,
        },
      });

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'kpi',
        entity: 'KpiTemplate',
        entityId: template.id,
        description: `Created KPI template: ${template.name}`,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });

      return { status: true, data: template, message: 'KPI template created successfully' };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to create KPI template' };
    }
  }

  async updateTemplate(id: string, body: UpdateKpiTemplateDto, ctx: Ctx) {
    try {
      const existing = await this.prisma.kpiTemplate.findUnique({ where: { id } });
      if (!existing) return { status: false, message: 'KPI template not found' };

      const updated = await this.prisma.kpiTemplate.update({
        where: { id },
        data: { ...body, updatedById: ctx.userId },
      });

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'kpi',
        entity: 'KpiTemplate',
        entityId: id,
        description: `Updated KPI template: ${updated.name}`,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });

      return { status: true, data: updated, message: 'KPI template updated successfully' };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to update KPI template' };
    }
  }

  async deleteTemplate(id: string, ctx: Ctx) {
    try {
      const existing = await this.prisma.kpiTemplate.findUnique({ where: { id } });
      if (!existing) return { status: false, message: 'KPI template not found' };

      await this.prisma.kpiTemplate.delete({ where: { id } });

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'kpi',
        entity: 'KpiTemplate',
        entityId: id,
        description: `Deleted KPI template: ${existing.name}`,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });

      return { status: true, message: 'KPI template deleted successfully' };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to delete KPI template' };
    }
  }

  // ─── KPI Reviews ─────────────────────────────────────────────────────────────

  async listReviews(params?: {
    employeeId?: string;
    kpiTemplateId?: string;
    period?: string;
    periodType?: string;
    status?: string;
  }) {
    try {
      const where: any = {};
      if (params?.employeeId) where.employeeId = params.employeeId;
      if (params?.kpiTemplateId) where.kpiTemplateId = params.kpiTemplateId;
      if (params?.period) where.period = params.period;
      if (params?.periodType) where.periodType = params.periodType;
      if (params?.status) where.status = params.status;

      const reviews = await this.prisma.kpiReview.findMany({
        where,
        include: {
          employee: {
            select: { id: true, employeeId: true, employeeName: true, departmentId: true, designationId: true },
          },
          kpiTemplate: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      if (reviews.length === 0) return { status: true, data: [] };

      // Enrich with master DB data
      const deptIds = [...new Set(reviews.map((r) => r.employee?.departmentId).filter(Boolean))] as string[];
      const reviewerIds = [...new Set(reviews.map((r) => r.reviewedById).filter(Boolean))] as string[];

      const [departments, reviewers] = await Promise.all([
        this.prisma.department.findMany({ where: { id: { in: deptIds } }, select: { id: true, name: true } }),
        reviewerIds.length
          ? this.prismaMaster.user.findMany({
              where: { id: { in: reviewerIds } },
              select: { id: true, firstName: true, lastName: true },
            })
          : Promise.resolve([]),
      ]);

      const deptMap = new Map(departments.map((d) => [d.id, d] as const));
      const reviewerMap = new Map(reviewers.map((u) => [u.id, u] as const));

      const enriched = reviews.map((r) => ({
        ...r,
        employee: r.employee
          ? { ...r.employee, department: deptMap.get(r.employee.departmentId) || null }
          : null,
        reviewedBy: r.reviewedById ? reviewerMap.get(r.reviewedById) || null : null,
      }));

      return { status: true, data: enriched };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to list KPI reviews' };
    }
  }

  async getReview(id: string) {
    try {
      const review = await this.prisma.kpiReview.findUnique({
        where: { id },
        include: {
          employee: { select: { id: true, employeeId: true, employeeName: true, departmentId: true } },
          kpiTemplate: true,
        },
      });
      if (!review) return { status: false, message: 'KPI review not found' };
      return { status: true, data: review };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to get KPI review' };
    }
  }

  async createReview(body: CreateKpiReviewDto, ctx: Ctx) {
    try {
      const employee = await this.prisma.employee.findUnique({ where: { id: body.employeeId } });
      if (!employee) return { status: false, message: 'Employee not found' };

      const template = await this.prisma.kpiTemplate.findUnique({ where: { id: body.kpiTemplateId } });
      if (!template) return { status: false, message: 'KPI template not found' };

      // Calculate score if actualValue provided
      const score = body.actualValue != null && body.targetValue > 0
        ? Math.min(100, (body.actualValue / body.targetValue) * 100)
        : null;

      const review = await this.prisma.kpiReview.create({
        data: {
          employeeId: body.employeeId,
          kpiTemplateId: body.kpiTemplateId,
          period: body.period,
          periodType: body.periodType,
          targetValue: body.targetValue,
          actualValue: body.actualValue,
          score,
          notes: body.notes,
          status: 'pending',
          createdById: ctx.userId,
        },
        include: { kpiTemplate: true },
      });

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'kpi',
        entity: 'KpiReview',
        entityId: review.id,
        description: `Created KPI review for employee ${body.employeeId} — period ${body.period}`,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });

      return { status: true, data: review, message: 'KPI review created successfully' };
    } catch (error) {
      if ((error as any)?.code === 'P2002') {
        return { status: false, message: 'A review for this employee, template, and period already exists' };
      }
      return { status: false, message: error instanceof Error ? error.message : 'Failed to create KPI review' };
    }
  }

  async updateReview(id: string, body: UpdateKpiReviewDto, ctx: Ctx) {
    try {
      const existing = await this.prisma.kpiReview.findUnique({ where: { id } });
      if (!existing) return { status: false, message: 'KPI review not found' };

      // Recalculate score if values changed
      const targetValue = body.targetValue ?? Number(existing.targetValue);
      const actualValue = body.actualValue ?? (existing.actualValue != null ? Number(existing.actualValue) : null);
      const score = actualValue != null && targetValue > 0
        ? Math.min(100, (actualValue / targetValue) * 100)
        : existing.score;

      const updated = await this.prisma.kpiReview.update({
        where: { id },
        data: {
          ...(body.actualValue !== undefined && { actualValue: body.actualValue }),
          ...(body.targetValue !== undefined && { targetValue: body.targetValue }),
          ...(body.notes !== undefined && { notes: body.notes }),
          ...(body.status && { status: body.status }),
          score,
          reviewedById: body.status === 'approved' ? ctx.userId : existing.reviewedById,
          updatedById: ctx.userId,
        },
        include: { kpiTemplate: true },
      });

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'kpi',
        entity: 'KpiReview',
        entityId: id,
        description: `Updated KPI review — status: ${updated.status}`,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });

      return { status: true, data: updated, message: 'KPI review updated successfully' };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to update KPI review' };
    }
  }

  async deleteReview(id: string, ctx: Ctx) {
    try {
      const existing = await this.prisma.kpiReview.findUnique({ where: { id } });
      if (!existing) return { status: false, message: 'KPI review not found' };

      await this.prisma.kpiReview.delete({ where: { id } });

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'kpi',
        entity: 'KpiReview',
        entityId: id,
        description: 'Deleted KPI review',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });

      return { status: true, message: 'KPI review deleted successfully' };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to delete KPI review' };
    }
  }

  // ─── Auto-Compute ─────────────────────────────────────────────────────────────

  /**
   * Auto-populate actualValue for all "auto" KPI reviews for a given employee + period.
   * Creates reviews if they don't exist yet, updates if they do.
   */
  async autoPopulate(employeeId: string, period: string, periodType: string, ctx: Ctx) {
    try {
      const employee = await this.prisma.employee.findUnique({ where: { id: employeeId } });
      if (!employee) return { status: false, message: 'Employee not found' };

      const templates = await this.prisma.kpiTemplate.findMany({
        where: { metricType: 'auto', status: 'active', formula: { not: null } },
      });

      if (templates.length === 0) {
        return { status: true, data: [], message: 'No auto KPI templates found' };
      }

      const results: any[] = [];

      for (const template of templates) {
        if (!template.formula) continue;

        const metric = await this.compute.compute(employeeId, template.formula, period, periodType);
        if (!metric) continue;

        const targetValue = template.targetValue ? Number(template.targetValue) : 100;
        const actualValue = metric.actualValue;
        const score = targetValue > 0 ? Math.min(100, (actualValue / targetValue) * 100) : null;

        const existing = await this.prisma.kpiReview.findUnique({
          where: { employeeId_kpiTemplateId_period: { employeeId, kpiTemplateId: template.id, period } },
        });

        let review: any;
        if (existing) {
          review = await this.prisma.kpiReview.update({
            where: { id: existing.id },
            data: { actualValue, score, updatedById: ctx.userId },
            include: { kpiTemplate: true },
          });
        } else {
          review = await this.prisma.kpiReview.create({
            data: {
              employeeId,
              kpiTemplateId: template.id,
              period,
              periodType,
              targetValue,
              actualValue,
              score,
              status: 'submitted',
              createdById: ctx.userId,
            },
            include: { kpiTemplate: true },
          });
        }

        results.push({ ...review, meta: metric.meta });
      }

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'kpi',
        entity: 'KpiReview',
        description: `Auto-populated ${results.length} KPI review(s) for employee ${employeeId} — period ${period}`,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });

      return { status: true, data: results, message: `Auto-populated ${results.length} KPI review(s)` };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to auto-populate KPI reviews' };
    }
  }

  /**
   * Get a full KPI summary for an employee: saved reviews + live auto-computed metrics.
   */
  async getEmployeeSummary(employeeId: string, period: string, periodType: string) {
    try {
      const employee = await this.prisma.employee.findUnique({
        where: { id: employeeId },
        select: { id: true, employeeId: true, employeeName: true, departmentId: true, designationId: true },
      });
      if (!employee) return { status: false, message: 'Employee not found' };

      const reviews = await this.prisma.kpiReview.findMany({
        where: { employeeId, period },
        include: { kpiTemplate: true },
        orderBy: { createdAt: 'asc' },
      });

      const liveMetrics = await this.compute.computeAll(employeeId, period, periodType);

      // Weighted overall score from saved reviews
      let weightedSum = 0;
      let totalWeight = 0;
      for (const r of reviews) {
        if (r.score != null) {
          const w = r.kpiTemplate ? Number(r.kpiTemplate.weight) : 1;
          weightedSum += Number(r.score) * w;
          totalWeight += w;
        }
      }
      const overallScore = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 100) / 100 : null;

      const [dept, desig] = await Promise.all([
        employee.departmentId
          ? this.prisma.department.findUnique({ where: { id: employee.departmentId }, select: { name: true } })
          : null,
        employee.designationId
          ? this.prisma.designation.findUnique({ where: { id: employee.designationId }, select: { name: true } })
          : null,
      ]);

      return {
        status: true,
        data: {
          employee: { ...employee, departmentName: dept?.name || null, designationName: desig?.name || null },
          period,
          periodType,
          overallScore,
          reviews,
          liveMetrics,
        },
      };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to get employee KPI summary' };
    }
  }
}
