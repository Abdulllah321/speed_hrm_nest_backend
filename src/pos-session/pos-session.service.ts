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
            return {
                session: null,
                metrics: {
                    openingFloat: 0,
                    cashSales: 0,
                    expectedCash: 0,
                },
                isDrawerOpen: false,
                terminalContext: { terminalId, posId, locationId }
            } as any;
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
            let activeSession = await this.prisma.posSession.findFirst({
                where: { posId: terminalId, status: 'open' },
                orderBy: { openedAt: 'desc' },
            });

            if (!activeSession) {
                const lastSession = await this.prisma.posSession.findFirst({
                    where: { posId: terminalId },
                    orderBy: { openedAt: 'desc' },
                });

                activeSession = await this.prisma.posSession.create({
                    data: {
                        posId: terminalId,
                        status: 'open',
                        token: lastSession?.token || null,
                        userId: ctx?.userId || null,
                    },
                });
            } else if (activeSession.openingFloat && Number(activeSession.openingFloat) > 0) {
                throw new BadRequestException('Drawer is already open with a float.');
            }

            const updatedSession = await this.prisma.posSession.update({
                where: { id: activeSession.id },
                data: {
                    openingFloat: amount,
                    openingNote: note,
                    userId: ctx?.userId || undefined,
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
            include: {
                merchant: true,
                voucherRedemptions: {
                    include: {
                        voucher: {
                            include: {
                                claims: true,
                            },
                        },
                    },
                },
            },
        });

        // Query all vouchers issued during this session's timeframe at this location
        const issuedVouchers = await this.prisma.voucher.findMany({
            where: {
                createdAt: timeFilter,
                issuedByLocationId: session.pos.locationId,
            },
            include: {
                claims: true,
            },
        });

        // 1. Initial aggregations
        let grossSales = 0;
        let totalTaxes = 0;
        let totalDiscounts = 0;

        let totalCashReceived = 0;
        let totalCardReceived = 0;
        let cashSalesCount = 0;
        let cardSalesCount = 0;
        let voucherSalesCount = 0;
        let totalVouchersReceivedAmt = 0;

        // Group card payments and card gift vouchers
        const cardGroup: Record<string, { bank: string; amount: number; rate: number; commission: number }> = {};
        const cardVoucherGroup: Record<string, { bank: string; amount: number; rate: number; commission: number }> = {};

        // Vouchers received (redeemed) list
        const redeemedVouchersList: Array<{ type: string; amount: number; from: string }> = [];

        // Receivables On Credit
        let totalCreditAmount = 0;

        for (const order of orders) {
            const subtotal = Number(order.subtotal ?? 0);
            const discountAmount = Number(order.discountAmount ?? 0);
            const globalDiscountAmount = Number(order.globalDiscountAmount ?? 0);
            const taxAmount = Number(order.taxAmount ?? 0);
            const grandTotal = Number(order.grandTotal ?? 0);

            grossSales += subtotal;
            totalTaxes += taxAmount;
            totalDiscounts += (discountAmount + globalDiscountAmount);

            const cash = Number(order.cashAmount ?? 0);
            const card = Number(order.cardAmount ?? 0);
            const voucher = Number(order.voucherAmount ?? 0);

            if (cash > 0) {
                cashSalesCount++;
                totalCashReceived += cash;
            }
            if (card > 0) {
                cardSalesCount++;
                totalCardReceived += card;

                // Group by bank / merchant commission rate
                const bankName = order.merchant?.bankName || 'Unknown Bank';
                const rateDecimal = Number(order.merchant?.commissionRate ?? 0);
                const ratePct = rateDecimal * 100; // formatted in percent (e.g. 1.265 for 0.01265)

                // Figure out if any part of card amount went to voucher purchase in this order
                const orderIssuedVouchers = issuedVouchers.filter(v => v.sourceOrderId === order.id && (v.voucherType === 'GIFT' || v.voucherType === 'CORPORATE'));
                const vouchersValue = orderIssuedVouchers.reduce((sum, v) => sum + Number(v.faceValue), 0);

                const voucherCardAmt = Math.min(card, vouchersValue);
                const regularCardAmt = card - voucherCardAmt;

                if (regularCardAmt > 0) {
                    if (!cardGroup[bankName]) {
                        cardGroup[bankName] = { bank: bankName, amount: 0, rate: ratePct, commission: 0 };
                    }
                    cardGroup[bankName].amount += regularCardAmt;
                    cardGroup[bankName].commission += regularCardAmt * rateDecimal;
                }

                if (voucherCardAmt > 0) {
                    if (!cardVoucherGroup[bankName]) {
                        cardVoucherGroup[bankName] = { bank: bankName, amount: 0, rate: ratePct, commission: 0 };
                    }
                    cardVoucherGroup[bankName].amount += voucherCardAmt;
                    cardVoucherGroup[bankName].commission += voucherCardAmt * rateDecimal;
                }
            }
            if (voucher > 0) {
                voucherSalesCount++;
            }

            // Extract all voucher redemptions (received vouchers)
            if (order.voucherRedemptions && order.voucherRedemptions.length > 0) {
                for (const redemption of order.voucherRedemptions) {
                    const amountUsed = Number(redemption.amountUsed);
                    totalVouchersReceivedAmt += amountUsed;

                    const v = redemption.voucher;
                    let type = 'Vouchers';
                    if (v.voucherType === 'CORPORATE') {
                        type = 'Gift Vouchers Corporate';
                    } else if (v.voucherType === 'GIFT') {
                        type = 'Gift Vouchers';
                    } else if (v.voucherType === 'CREDIT') {
                        type = 'Credit Vouchers';
                    } else if (v.voucherType === 'EXCHANGE') {
                        if (v.claims && v.claims.length > 0) {
                            type = 'Claim Vouchers';
                        } else {
                            type = 'Exchange Vouchers';
                        }
                    } else if (v.voucherType === 'OUTLET_GIFT') {
                        type = 'Outlet Gift Vouchers';
                    }

                    redeemedVouchersList.push({
                        type,
                        amount: amountUsed,
                        from: v.code,
                    });
                }
            }

            // Receivable On Credit
            if (order.paymentMethod === 'credit_account' || order.tenderType === 'credit_account') {
                totalCreditAmount += grandTotal;
            }
        }

        // Vouchers Issued Grouping
        const exchangeAndClaims: Array<{ type: string; amount: number; from: string }> = [];
        const creditVouchers: Array<{ type: string; amount: number; from: string; to: string }> = [];
        const giftVouchers: Array<{ type: string; amount: number; from: string }> = [];

        // Track how much of cash/card was for gift vouchers issued
        let cashGiftVouchersAmt = 0;
        let cardGiftVouchersAmt = 0;

        for (const v of issuedVouchers) {
            const faceValue = Number(v.faceValue);
            
            if (v.voucherType === 'EXCHANGE') {
                const type = (v.claims && v.claims.length > 0) ? 'Claim Vouchers' : 'Exchange Vouchers';
                exchangeAndClaims.push({
                    type,
                    amount: faceValue,
                    from: v.code,
                });
            } else if (v.voucherType === 'CREDIT') {
                // Try to extract original voucher from description if it's unused balance
                let fromCode = '-';
                if (v.description && v.description.includes('unused balance from')) {
                    const parts = v.description.split('from ');
                    if (parts.length > 1) fromCode = parts[1].trim();
                }
                creditVouchers.push({
                    type: 'Credit Vouchers',
                    amount: faceValue,
                    from: fromCode,
                    to: v.code,
                });
            } else if (v.voucherType === 'GIFT' || v.voucherType === 'CORPORATE') {
                const type = v.voucherType === 'CORPORATE' ? 'Gift Vouchers Corporate' : 'Gift Vouchers';
                giftVouchers.push({
                    type,
                    amount: faceValue,
                    from: v.code,
                });

                // Attribute to Cash vs Card based on the purchase order payment
                if (v.sourceOrderId) {
                    const purchaseOrder = orders.find(o => o.id === v.sourceOrderId);
                    if (purchaseOrder) {
                        const cashPay = Number(purchaseOrder.cashAmount ?? 0);
                        const cardPay = Number(purchaseOrder.cardAmount ?? 0);
                        if (cardPay > 0) {
                            cardGiftVouchersAmt += faceValue;
                        } else if (cashPay > 0) {
                            cashGiftVouchersAmt += faceValue;
                        }
                    }
                }
            }
        }

        // FBR POS Charges
        let fbrCashCount = 0;
        let fbrCardCount = 0;
        for (const order of orders) {
            if (order.cardAmount && Number(order.cardAmount) > 0) {
                fbrCardCount++;
            } else {
                fbrCashCount++;
            }
        }

        const fbrCharges = [
            { type: 'Cash', amount: fbrCashCount },
            { type: 'Card', amount: fbrCardCount },
        ];

        // Cash & Card Breakdowns
        const cashSaleAmt = Math.max(0, totalCashReceived - cashGiftVouchersAmt);
        const cardSaleAmt = Math.max(0, totalCardReceived - cardGiftVouchersAmt);

        // Received vouchers with Cash and Cash - Gift Vouchers Issued prepended
        const receivedVouchers = [
            { type: 'Cash', amount: cashSaleAmt, from: '-' },
            ...(cashGiftVouchersAmt > 0 ? [{ type: 'Cash - Gift Vouchers Issued', amount: cashGiftVouchersAmt, from: '-' }] : []),
            ...redeemedVouchersList,
        ];

        // Card Payments array & Card Gift Vouchers array
        const cardPayments = Object.values(cardGroup);
        const cardGiftVouchers = Object.values(cardVoucherGroup);

        // Receivables On Credit
        const receivables = [
            { description: 'On Credit', amount: totalCreditAmount }
        ];

        // Financials:
        // returns value is sum of face value of issued EXCHANGE vouchers
        const returnAmount = exchangeAndClaims.reduce((sum, v) => sum + v.amount, 0);
        const financials = {
            sale: grossSales,
            salesReturn: returnAmount,
            netSales: grossSales - returnAmount,
        };

        const openedStr = session.openedAt.toISOString();
        const closedStr = session.closedAt ? session.closedAt.toISOString() : new Date().toISOString();
        const formatDate = (dateStr: string) => {
            const date = new Date(dateStr);
            const day = String(date.getDate()).padStart(2, '0');
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const year = date.getFullYear();
            return `${day}/${month}/${year}`;
        };
        const dateRange = formatDate(openedStr) === formatDate(closedStr)
            ? formatDate(openedStr)
            : `${formatDate(openedStr)} - ${formatDate(closedStr)}`;

        const openingFloat = Number(session.openingFloat ?? 0);
        // expectedCash = starting float + total cash received
        const expectedCash = openingFloat + totalCashReceived;
        const actualCash = session.actualCash !== null ? Number(session.actualCash) : null;
        const difference = session.difference !== null ? Number(session.difference) : null;

        return {
            companyName: 'Speed (Private) Limited',
            locationName: session.pos.location?.name ?? 'Nike-Dolmen Clifton',
            reportTitle: 'Sales Reconciliation',
            dateRange: dateRange,
            documentNumber: `REC-${session.id ? session.id.substring(0, 8).toUpperCase() : 'TEMP'}`,

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
                netSales: financials.netSales,
                totalTaxes,
                totalDiscounts,
                orderCount: orders.length,
                averageOrderValue: orders.length > 0 ? financials.netSales / orders.length : 0,
            },
            paymentBreakdown: {
                cash: { count: cashSalesCount, amount: totalCashReceived },
                card: { count: cardSalesCount, amount: totalCardReceived },
                voucher: { count: voucherSalesCount, amount: totalVouchersReceivedAmt },
            },
            cardPayments,
            cardGiftVouchers,
            receivedVouchers,
            receivables,
            issuedVouchers: {
                exchangeAndClaims,
                creditVouchers,
                giftVouchers,
            },
            fbrCharges,
            financials,
            cashBreakdown: {
                sale: cashSaleAmt,
                giftVouchers: cashGiftVouchersAmt,
                total: totalCashReceived,
            },
            cardBreakdown: {
                sale: cardSaleAmt,
                giftVouchers: cardGiftVouchersAmt,
                total: totalCardReceived,
            },
        };
    }
}
