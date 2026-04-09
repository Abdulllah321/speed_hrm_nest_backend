import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PrismaMasterService } from '../database/prisma-master.service';

@Injectable()
export class PosSessionService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly prismaMaster: PrismaMasterService,
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
    async openDrawer(terminalId: string, amount: number, note?: string) {
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

        return updatedSession;
    }

    /**
   * Close the drawer for the current session
   */
    async closeDrawer(terminalId: string, posId: string, locationId: string, actualCash: number, note?: string) {
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

        return {
            session: closedSession,
            variance: difference,
        };
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
                where: { posId: terminalId },
                orderBy: { openedAt: 'desc' },
                skip,
                take: limit,
            }),
            this.prisma.posSession.count({ where: { posId: terminalId } }),
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
}
