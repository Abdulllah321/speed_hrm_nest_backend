import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { KpiComputeService } from './kpi-compute.service';

@Injectable()
export class KpiDashboardService {
  constructor(
    private prisma: PrismaService,
    private compute: KpiComputeService,
  ) {}

  /**
   * Org-wide KPI dashboard aggregated by department.
   * Returns:
   *  - summary stats (total reviews, avg score, by-status counts)
   *  - department breakdown (avg score per dept)
   *  - score distribution (buckets: 0-20, 20-40, 40-60, 60-80, 80-100)
   *  - top/bottom performers
   *  - per-formula live metric averages across all active employees
   */
  async getOrgDashboard(period: string, periodType: string) {
    try {
      // All reviews for this period
      const reviews = await this.prisma.kpiReview.findMany({
        where: { period },
        include: {
          employee: {
            select: {
              id: true,
              employeeId: true,
              employeeName: true,
              departmentId: true,
            },
          },
          kpiTemplate: { select: { id: true, name: true, category: true, weight: true } },
        },
      });

      // ── Summary stats ──────────────────────────────────────────────────────
      const totalReviews = reviews.length;
      const scoredReviews = reviews.filter((r) => r.score != null);
      const avgScore =
        scoredReviews.length > 0
          ? scoredReviews.reduce((s, r) => s + Number(r.score), 0) / scoredReviews.length
          : null;

      const byStatus = reviews.reduce<Record<string, number>>((acc, r) => {
        acc[r.status] = (acc[r.status] || 0) + 1;
        return acc;
      }, {});

      // ── Score distribution ─────────────────────────────────────────────────
      const buckets = [
        { label: '0–20', min: 0, max: 20, count: 0 },
        { label: '20–40', min: 20, max: 40, count: 0 },
        { label: '40–60', min: 40, max: 60, count: 0 },
        { label: '60–80', min: 60, max: 80, count: 0 },
        { label: '80–100', min: 80, max: 100, count: 0 },
      ];
      for (const r of scoredReviews) {
        const s = Number(r.score);
        const bucket = buckets.find((b) => s >= b.min && s <= b.max);
        if (bucket) bucket.count++;
      }

      // ── Department breakdown ───────────────────────────────────────────────
      const deptIds = [...new Set(reviews.map((r) => r.employee?.departmentId).filter(Boolean))] as string[];
      const departments = await this.prisma.department.findMany({
        where: { id: { in: deptIds } },
        select: { id: true, name: true },
      });
      const deptMap = new Map(departments.map((d) => [d.id, d.name]));

      const deptScores: Record<string, { name: string; scores: number[]; count: number }> = {};
      for (const r of reviews) {
        const deptId = r.employee?.departmentId;
        if (!deptId) continue;
        if (!deptScores[deptId]) {
          deptScores[deptId] = { name: deptMap.get(deptId) || 'Unknown', scores: [], count: 0 };
        }
        deptScores[deptId].count++;
        if (r.score != null) deptScores[deptId].scores.push(Number(r.score));
      }

      const departmentBreakdown = Object.values(deptScores).map((d) => ({
        department: d.name,
        avgScore: d.scores.length > 0 ? Math.round((d.scores.reduce((a, b) => a + b, 0) / d.scores.length) * 10) / 10 : null,
        reviewCount: d.count,
      })).sort((a, b) => (b.avgScore ?? 0) - (a.avgScore ?? 0));

      // ── Per-employee weighted scores → top/bottom performers ──────────────
      const empScoreMap: Record<string, { name: string; scores: number[]; weights: number[] }> = {};
      for (const r of scoredReviews) {
        const empId = r.employeeId;
        if (!empScoreMap[empId]) {
          empScoreMap[empId] = { name: r.employee?.employeeName || 'Unknown', scores: [], weights: [] };
        }
        const w = r.kpiTemplate ? Number(r.kpiTemplate.weight) : 1;
        empScoreMap[empId].scores.push(Number(r.score) * w);
        empScoreMap[empId].weights.push(w);
      }

      const empRanked = Object.entries(empScoreMap).map(([id, d]) => {
        const totalW = d.weights.reduce((a, b) => a + b, 0);
        const weighted = totalW > 0 ? d.scores.reduce((a, b) => a + b, 0) / totalW : 0;
        return { employeeId: id, name: d.name, score: Math.round(weighted * 10) / 10 };
      }).sort((a, b) => b.score - a.score);

      const topPerformers = empRanked.slice(0, 5);
      const bottomPerformers = empRanked.slice(-5).reverse();

      // ── Category breakdown (avg score per KPI category) ───────────────────
      const catScores: Record<string, number[]> = {};
      for (const r of scoredReviews) {
        const cat = r.kpiTemplate?.category || 'other';
        if (!catScores[cat]) catScores[cat] = [];
        catScores[cat].push(Number(r.score));
      }
      const categoryBreakdown = Object.entries(catScores).map(([category, scores]) => ({
        category,
        avgScore: Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10,
        count: scores.length,
      }));

      // ── Live org-wide metric averages (sample up to 20 active employees) ──
      const activeEmployees = await this.prisma.employee.findMany({
        where: { status: 'active' },
        select: { id: true },
        take: 20,
      });

      const metricTotals: Record<string, number[]> = {};
      await Promise.all(
        activeEmployees.map(async (emp) => {
          const metrics = await this.compute.computeAll(emp.id, period, periodType);
          for (const [formula, result] of Object.entries(metrics)) {
            if (!metricTotals[formula]) metricTotals[formula] = [];
            metricTotals[formula].push(result.actualValue);
          }
        }),
      );

      const liveMetricAverages = Object.entries(metricTotals).map(([formula, values]) => ({
        formula,
        avgValue: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10,
        sampleSize: values.length,
      }));

      return {
        status: true,
        data: {
          period,
          periodType,
          summary: {
            totalReviews,
            avgScore: avgScore != null ? Math.round(avgScore * 10) / 10 : null,
            byStatus,
            scoredCount: scoredReviews.length,
          },
          scoreDistribution: buckets,
          departmentBreakdown,
          categoryBreakdown,
          topPerformers,
          bottomPerformers,
          liveMetricAverages,
        },
      };
    } catch (error) {
      return {
        status: false,
        message: error instanceof Error ? error.message : 'Failed to get KPI dashboard',
      };
    }
  }

  /**
   * Export all KPI reviews for a period as a flat array (for CSV download).
   */
  async exportReviews(period: string) {
    try {
      const reviews = await this.prisma.kpiReview.findMany({
        where: { period },
        include: {
          employee: {
            select: { employeeId: true, employeeName: true, departmentId: true },
          },
          kpiTemplate: { select: { name: true, category: true, unit: true } },
        },
        orderBy: [{ employeeId: 'asc' }, { createdAt: 'asc' }],
      });

      const deptIds = [...new Set(reviews.map((r) => r.employee?.departmentId).filter(Boolean))] as string[];
      const departments = await this.prisma.department.findMany({
        where: { id: { in: deptIds } },
        select: { id: true, name: true },
      });
      const deptMap = new Map(departments.map((d) => [d.id, d.name]));

      const rows = reviews.map((r) => ({
        employeeId: r.employee?.employeeId || '',
        employeeName: r.employee?.employeeName || '',
        department: deptMap.get(r.employee?.departmentId || '') || '',
        kpi: r.kpiTemplate?.name || '',
        category: r.kpiTemplate?.category || '',
        period: r.period,
        periodType: r.periodType,
        targetValue: Number(r.targetValue),
        actualValue: r.actualValue != null ? Number(r.actualValue) : '',
        score: r.score != null ? Number(r.score) : '',
        unit: r.kpiTemplate?.unit || '',
        status: r.status,
        notes: r.notes || '',
      }));

      return { status: true, data: rows };
    } catch (error) {
      return {
        status: false,
        message: error instanceof Error ? error.message : 'Failed to export reviews',
      };
    }
  }
}
