import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class PosDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns all POS dashboard stats scoped to the active location.
   * locationId is extracted from the posTerminalToken cookie by the controller.
   */
  async getDashboardStats(locationId: string, cashierUserId?: string) {
    this.prisma.ensureTenantContext();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    // Quick sanity check — count all completed orders for this location regardless of date
    const totalCompleted = await this.prisma.salesOrder.count({
      where: { locationId, status: 'completed' },
    });
    const todayCompleted = await this.prisma.salesOrder.count({
      where: { locationId, status: 'completed', createdAt: { gte: today, lt: tomorrow } },
    });
  
    const cashierFilter = cashierUserId ? { cashierUserId } : {};

    const [
      salesAgg,
      completedOrders,
      recentOrders,
      claimStats,
      topItems,
      hourlySales,
      cashierAgg,
      cashierOrders,
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

      // ── Cashier's own sales today ───────────────────────────────────
      cashierUserId
        ? this.prisma.salesOrder.aggregate({
            where: {
              locationId,
              cashierUserId,
              status: 'completed',
              createdAt: { gte: today, lt: tomorrow },
            },
            _sum: { grandTotal: true, cashAmount: true, cardAmount: true },
            _count: { id: true },
          })
        : Promise.resolve(null),

      // ── Cashier's recent orders today ───────────────────────────────
      cashierUserId
        ? this.prisma.salesOrder.findMany({
            where: {
              locationId,
              cashierUserId,
              status: 'completed',
              createdAt: { gte: today, lt: tomorrow },
            },
            orderBy: { createdAt: 'desc' },
            take: 5,
            select: {
              id: true,
              orderNumber: true,
              grandTotal: true,
              status: true,
              createdAt: true,
              customerId: true,
              items: { select: { id: true } },
            },
          })
        : Promise.resolve([]),
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

    const cashierSales = cashierAgg ? Number(cashierAgg._sum.grandTotal ?? 0) : null;
    const cashierTransactions = cashierAgg ? cashierAgg._count.id : null;
    const cashierCash = cashierAgg ? Number(cashierAgg._sum.cashAmount ?? 0) : null;
    const cashierCard = cashierAgg ? Number(cashierAgg._sum.cardAmount ?? 0) : null;

    return {
      stats: {
        todaySales,
        transactions,
        customersServed: completedOrders.length,
        avgTransaction: transactions > 0 ? todaySales / transactions : 0,
        cashSales,
        cardSales,
      },
      cashier: cashierUserId
        ? {
            sales: cashierSales,
            transactions: cashierTransactions,
            cashSales: cashierCash,
            cardSales: cashierCard,
            avgTransaction:
              cashierTransactions && cashierTransactions > 0
                ? (cashierSales ?? 0) / cashierTransactions
                : 0,
            recentOrders: cashierOrders,
          }
        : null,
      recentOrders,
      topItems: topItemsEnriched,
      hourlySales: hourlyBuckets,
      claims: claimSummary,
    };
  }
}
