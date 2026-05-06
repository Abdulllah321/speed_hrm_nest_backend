import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PrismaMasterService } from '../database/prisma-master.service';

@Injectable()
export class PosDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly prismaMaster: PrismaMasterService,
  ) {}

  /**
   * Returns all POS dashboard stats scoped to the active location.
   * locationId is extracted from the posTerminalToken cookie by the controller.
   */
  async getDashboardStats(locationId: string) {
    this.prisma.ensureTenantContext();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [
      salesAgg,
      completedOrders,
      recentOrders,
      claimStats,
      topItems,
      hourlySales,
      salespersonAgg,
    ] = await Promise.all([
      // ── Today's totals ──────────────────────────────────────────────
      this.prisma.salesOrder.aggregate({
        where: {
          locationId,
          status: 'completed',
          createdAt: { gte: today, lt: tomorrow },
        },
        _sum: { grandTotal: true, cashAmount: true, cardAmount: true },
        _count: { id: true },
      }),

      // ── Unique customers served today ───────────────────────────────
      this.prisma.salesOrder.findMany({
        where: {
          locationId,
          status: 'completed',
          createdAt: { gte: today, lt: tomorrow },
          customerId: { not: null },
        },
        select: { customerId: true },
        distinct: ['customerId'],
      }),

      // ── Last 10 orders ──────────────────────────────────────────────
      this.prisma.salesOrder.findMany({
        where: { locationId, createdAt: { gte: today, lt: tomorrow } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          orderNumber: true,
          grandTotal: true,
          cashAmount: true,
          cardAmount: true,
          status: true,
          createdAt: true,
          customerId: true,
          items: { select: { id: true } },
        },
      }),

      // ── Claim counts by status ──────────────────────────────────────
      this.prisma.posClaim.groupBy({
        by: ['status'],
        where: {
          salesOrder: { locationId },
        },
        _count: { id: true },
      }),

      // ── Top 5 selling items today ───────────────────────────────────
      this.prisma.salesOrderItem.groupBy({
        by: ['itemId'],
        where: {
          salesOrder: {
            locationId,
            status: 'completed',
            createdAt: { gte: today, lt: tomorrow },
          },
        },
        _sum: { quantity: true, lineTotal: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 5,
      }),

      // ── Hourly sales breakdown (raw orders for today) ───────────────
      this.prisma.salesOrder.findMany({
        where: {
          locationId,
          status: 'completed',
          createdAt: { gte: today, lt: tomorrow },
        },
        select: { createdAt: true, grandTotal: true },
      }),

      // ── Sales grouped by salesperson today ─────────────────────────
      this.prisma.salesOrder.groupBy({
        by: ['cashierUserId'],
        where: {
          locationId,
          status: 'completed',
          createdAt: { gte: today, lt: tomorrow },
        },
        _sum: { grandTotal: true, cashAmount: true, cardAmount: true },
        _count: { id: true },
        orderBy: { _sum: { grandTotal: 'desc' } },
      }),
    ]);

    // ── Enrich top items with names ─────────────────────────────────
    const itemIds = topItems.map((t) => t.itemId);
    const itemNames = itemIds.length
      ? await this.prisma.item.findMany({
          where: { id: { in: itemIds } },
          select: { id: true, description: true, sku: true },
        })
      : [];

    const topItemsEnriched = topItems.map((t) => {
      const item = itemNames.find((i) => i.id === t.itemId);
      return {
        itemId: t.itemId,
        name: item?.description ?? 'Unknown',
        sku: item?.sku ?? '',
        qtySold: t._sum.quantity ?? 0,
        revenue: Number(t._sum.lineTotal ?? 0),
      };
    });

    // ── Build hourly buckets (0–23) ─────────────────────────────────
    const hourlyBuckets: { hour: number; label: string; sales: number; orders: number }[] =
      Array.from({ length: 24 }, (_, h) => ({
        hour: h,
        label: `${String(h).padStart(2, '0')}:00`,
        sales: 0,
        orders: 0,
      }));

    for (const o of hourlySales) {
      const h = new Date(o.createdAt).getHours();
      hourlyBuckets[h].sales += Number(o.grandTotal ?? 0);
      hourlyBuckets[h].orders += 1;
    }

    // ── Claim summary ───────────────────────────────────────────────
    const claimSummary = {
      submitted: 0,
      underReview: 0,
      approved: 0,
      rejected: 0,
      total: 0,
    };
    for (const c of claimStats) {
      const count = c._count.id;
      claimSummary.total += count;
      if (c.status === 'SUBMITTED') claimSummary.submitted = count;
      else if (c.status === 'UNDER_REVIEW') claimSummary.underReview = count;
      else if (c.status === 'APPROVED' || c.status === 'PARTIALLY_APPROVED') claimSummary.approved += count;
      else if (c.status === 'REJECTED') claimSummary.rejected = count;
    }

    const todaySales = Number(salesAgg._sum.grandTotal ?? 0);
    const transactions = salesAgg._count.id;
    const cashSales = Number(salesAgg._sum.cashAmount ?? 0);
    const cardSales = Number(salesAgg._sum.cardAmount ?? 0);

    // ── Enrich salesperson rows with names from master DB ───────────
    const spUserIds = salespersonAgg
      .map((r) => r.cashierUserId)
      .filter(Boolean) as string[];

    const spUsers = spUserIds.length
      ? await this.prismaMaster.user.findMany({
          where: { id: { in: spUserIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    const spUserMap = new Map(spUsers.map((u) => [u.id, u]));

    const salespeople = salespersonAgg.map((row) => {
      const u = spUserMap.get(row.cashierUserId ?? '');
      const sales = Number(row._sum.grandTotal ?? 0);
      const txns = row._count.id;
      return {
        userId: row.cashierUserId,
        name: u ? `${u.firstName} ${u.lastName}` : 'Unknown',
        sales,
        transactions: txns,
        cashSales: Number(row._sum.cashAmount ?? 0),
        cardSales: Number(row._sum.cardAmount ?? 0),
        avgTransaction: txns > 0 ? sales / txns : 0,
      };
    });

    return {
      stats: {
        todaySales,
        transactions,
        customersServed: completedOrders.length,
        avgTransaction: transactions > 0 ? todaySales / transactions : 0,
        cashSales,
        cardSales,
      },
      salespeople,
      recentOrders,
      topItems: topItemsEnriched,
      hourlySales: hourlyBuckets,
      claims: claimSummary,
    };
  }
}
