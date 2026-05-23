import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PrismaMasterService } from '../database/prisma-master.service';

import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { runInBackground } from '../common/utils/run-in-background.util';
@Injectable()
export class PosSessionService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly prismaMaster: PrismaMasterService,
        private activityLogs: ActivityLogsService,
    ) { }

    /**
     * Get the active session for the provided terminal (UUID),
     * fully expanding drawer calculations dynamically by querying sales.
     */
    async getCurrentSession(terminalId: string, posId: string, locationId: string) {
        // Get the current active session from the Tenant DB
        // posId field in PosSession actually stores the Terminal UUID
        const activeSession = await this.prisma.posSession.findFirst({
            where: {
                posId: terminalId,
                status: 'open',
            },
            orderBy: { openedAt: 'desc' },
        });

        if (!activeSession) {
            return null;
        }

        // Now query the Tenant DB for SalesOrders made within this session's timeframe
        // Important: SalesOrder currently stores terminal CODE (e.g. 001) in posId
        const cashSales = await this.prisma.salesOrder.aggregate({
            where: {
                posId: posId,
                status: 'completed',
                createdAt: {
                    gte: activeSession.openedAt,
                },
            },
            _sum: {
                cashAmount: true,
            },
        });

        const calculatedCashSales = cashSales._sum.cashAmount ? Number(cashSales._sum.cashAmount) : 0;
        const floatAmount = activeSession.openingFloat ? Number(activeSession.openingFloat) : 0;

        // The total expected cash = Opening Float + total cash from sales
        const expectedCash = floatAmount + calculatedCashSales;

        return {
            session: activeSession,
            metrics: {
                openingFloat: floatAmount,
                cashSales: calculatedCashSales,
                expectedCash: expectedCash,
            },
            isDrawerOpen: floatAmount > 0,
        };
    }

    /**
   * Set the opening float for the current session
   */
    async openDrawer(terminalId: string, amount: number, note?: string, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
        try {
            const activeSession = await this.prisma.posSession.findFirst({
                where: { posId: terminalId, status: 'open' },
                orderBy: { openedAt: 'desc' },
            });

            if (!activeSession) {
                throw new NotFoundException('No active POS session found.');
            }

            if (activeSession.openingFloat && Number(activeSession.openingFloat) > 0) {
                throw new BadRequestException('Drawer is already open with a float.');
            }

            const updatedSession = await this.prisma.posSession.update({
                where: { id: activeSession.id },
                data: {
                    openingFloat: amount,
                    openingNote: note,
                },
            });

            runInBackground(
                'Open Drawer',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'update',
                    module: 'pos-session',
                    entity: 'PosSession',
                    entityId: updatedSession.id,
                    description: `Opened drawer for terminal ${terminalId} with float ${amount}`,
                    newValues: JSON.stringify({ amount, note }),
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'success',
                }),
            );

            return updatedSession;
        } catch (error: any) {
            runInBackground(
                'Open Drawer (Failure)',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'update',
                    module: 'pos-session',
                    entity: 'PosSession',
                    description: `Failed to open drawer for terminal ${terminalId}`,
                    errorMessage: error?.message,
                    newValues: JSON.stringify({ amount, note }),
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'failure',
                }),
            );
            throw error;
        }
    }

    /**
   * Close the drawer for the current session
   */
    async closeDrawer(terminalId: string, posId: string, locationId: string, actualCash: number, note?: string, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
        try {
            // We first get the current session and calculations to figure out the variance
            const currentStatus = await this.getCurrentSession(terminalId, posId, locationId);

            if (!currentStatus || !currentStatus.session) {
                throw new NotFoundException('No active POS session found.');
            }

            const expectedCash = currentStatus.metrics.expectedCash;
            const difference = actualCash - expectedCash;

            const closedSession = await this.prisma.posSession.update({
                where: { id: currentStatus.session.id },
                data: {
                    expectedCash,
                    actualCash,
                    difference,
                    closingNote: note,
                    closedAt: new Date(),
                    status: 'closed',
                },
            });

            runInBackground(
                'Close Drawer',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'update',
                    module: 'pos-session',
                    entity: 'PosSession',
                    entityId: closedSession.id,
                    description: `Closed drawer for terminal ${terminalId}. Variance: ${difference}`,
                    newValues: JSON.stringify({ actualCash, note, variance: difference }),
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'success',
                }),
            );

            return {
                session: closedSession,
                variance: difference,
            };
        } catch (error: any) {
            runInBackground(
                'Close Drawer (Failure)',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'update',
                    module: 'pos-session',
                    entity: 'PosSession',
                    description: `Failed to close drawer for terminal ${terminalId}`,
                    errorMessage: error?.message,
                    newValues: JSON.stringify({ actualCash, note }),
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'failure',
                }),
            );
            throw error;
        }
    }

    /**
     * Get paginated shift history for the terminal with per-session sales aggregates
     */
    async getSessionHistory(
        terminalId: string,
        posId: string,
        page: number = 1,
        limit: number = 20,
    ) {
        const skip = (page - 1) * limit;

        const [sessions, total] = await Promise.all([
            this.prisma.posSession.findMany({
                where: {
                    posId: terminalId,
                    NOT: {
                        status: 'open',
                        openingFloat: 0,
                    },
                },
                orderBy: { openedAt: 'desc' },
                skip,
                take: limit,
            }),
            this.prisma.posSession.count({
                where: {
                    posId: terminalId,
                    NOT: {
                        status: 'open',
                        openingFloat: 0,
                    },
                },
            }),
        ]);

        // For each session, aggregate sales that occurred within its timeframe
        const enriched = await Promise.all(
            sessions.map(async (session) => {
                const timeFilter: any = { gte: session.openedAt };
                if (session.closedAt) timeFilter.lte = session.closedAt;

                const [salesAgg, orderCount] = await Promise.all([
                    this.prisma.salesOrder.aggregate({
                        where: {
                            posId: posId,
                            status: 'completed',
                            createdAt: timeFilter,
                        },
                        _sum: {
                            grandTotal: true,
                            cashAmount: true,
                            cardAmount: true,
                        },
                        _count: { id: true },
                    }),
                    this.prisma.salesOrder.count({
                        where: {
                            posId: posId,
                            status: 'completed',
                            createdAt: timeFilter,
                        },
                    }),
                ]);

                const totalSales = Number(salesAgg._sum.grandTotal ?? 0);
                const cashSales = Number(salesAgg._sum.cashAmount ?? 0);
                const cardSales = Number(salesAgg._sum.cardAmount ?? 0);
                const openingFloat = Number(session.openingFloat ?? 0);

                return {
                    id: session.id,
                    status: session.status,
                    openedAt: session.openedAt,
                    closedAt: session.closedAt,
                    openingFloat,
                    openingNote: session.openingNote,
                    expectedCash: session.expectedCash ? Number(session.expectedCash) : openingFloat + cashSales,
                    actualCash: session.actualCash ? Number(session.actualCash) : null,
                    difference: session.difference ? Number(session.difference) : null,
                    closingNote: session.closingNote,
                    metrics: {
                        totalSales,
                        cashSales,
                        cardSales,
                        orderCount,
                    },
                };
            }),
        );

        return {
            data: enriched,
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    /**
     * Get detailed reconciliation metrics for a specific session ID.
     * Computes all drawer totals, tax/discount and payment method aggregates,
     * and fetches the cashier user profile from the master database.
     */
    async getReconciliationDetails(sessionId: string) {
        const session = await this.prisma.posSession.findUnique({
            where: { id: sessionId },
            include: {
                pos: {
                    include: {
                        location: true,
                    },
                },
            },
        });

        if (!session) {
            throw new NotFoundException('POS Session not found.');
        }

        // Fetch Cashier Profile from Central/Master DB
        const cashier = session.userId
            ? await this.prismaMaster.user.findUnique({
                  where: { id: session.userId },
                  select: {
                      firstName: true,
                      lastName: true,
                      email: true,
                  },
              })
            : null;

        // Query sales orders within the timeframe of this session
        const timeFilter: any = { gte: session.openedAt };
        if (session.closedAt) {
            timeFilter.lte = session.closedAt;
        }

        const orders = await this.prisma.salesOrder.findMany({
            where: {
                posId: session.pos.posId, // terminal code (e.g. 001)
                status: 'completed',
                createdAt: timeFilter,
            },
        });

        // Initialize variables for aggregation
        let grossSales = 0;
        let netSales = 0;
        let totalTaxes = 0;
        let totalDiscounts = 0;

        let cashSalesCount = 0;
        let cashSalesAmount = 0;
        let cardSalesCount = 0;
        let cardSalesAmount = 0;
        let voucherSalesCount = 0;
        let voucherSalesAmount = 0;

        for (const order of orders) {
            const subtotal = Number(order.subtotal ?? 0);
            const discountAmount = Number(order.discountAmount ?? 0);
            const globalDiscountAmount = Number(order.globalDiscountAmount ?? 0);
            const taxAmount = Number(order.taxAmount ?? 0);
            const grandTotal = Number(order.grandTotal ?? 0);

            grossSales += subtotal;
            netSales += grandTotal;
            totalTaxes += taxAmount;
            totalDiscounts += (discountAmount + globalDiscountAmount);

            const cash = Number(order.cashAmount ?? 0);
            const card = Number(order.cardAmount ?? 0);
            const voucher = Number(order.voucherAmount ?? 0);

            if (cash > 0) {
                cashSalesCount++;
                cashSalesAmount += cash;
            }
            if (card > 0) {
                cardSalesCount++;
                cardSalesAmount += card;
            }
            if (voucher > 0) {
                voucherSalesCount++;
                voucherSalesAmount += voucher;
            }
        }

        const openingFloat = Number(session.openingFloat ?? 0);
        // expectedCash = starting float + cash sales
        const expectedCash = openingFloat + cashSalesAmount;
        const actualCash = session.actualCash !== null ? Number(session.actualCash) : null;
        const difference = session.difference !== null ? Number(session.difference) : null;

        return {
            session: {
                id: session.id,
                status: session.status,
                openedAt: session.openedAt,
                closedAt: session.closedAt,
                openingFloat,
                openingNote: session.openingNote,
                expectedCash,
                actualCash,
                difference,
                closingNote: session.closingNote,
                terminal: {
                    name: session.pos.name,
                    terminalCode: session.pos.terminalCode,
                    locationName: session.pos.location?.name ?? 'Unknown Location',
                    locationCode: session.pos.location?.code ?? 'N/A',
                },
                cashier: cashier
                    ? {
                          fullName: `${cashier.firstName} ${cashier.lastName}`.trim(),
                          email: cashier.email,
                      }
                    : {
                          fullName: 'N/A',
                          email: 'N/A',
                      },
            },
            metrics: {
                grossSales,
                netSales,
                totalTaxes,
                totalDiscounts,
                orderCount: orders.length,
                averageOrderValue: orders.length > 0 ? netSales / orders.length : 0,
            },
            paymentBreakdown: {
                cash: { count: cashSalesCount, amount: cashSalesAmount },
                card: { count: cardSalesCount, amount: cardSalesAmount },
                voucher: { count: voucherSalesCount, amount: voucherSalesAmount },
            },
        };
    }
}
