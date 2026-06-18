import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PrismaMasterService } from '../database/prisma-master.service';

import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { runInBackground } from '../common/utils/run-in-background.util';
import { JournalVoucherService } from '../finance/journal-voucher/journal-voucher.service';
import { Logger } from '@nestjs/common';
@Injectable()
export class PosSessionService {
  private readonly logger = new Logger(PosSessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly prismaMaster: PrismaMasterService,
    private activityLogs: ActivityLogsService,
    private readonly journalVoucherService: JournalVoucherService,
  ) {}

  /**
   * Get the active session for the provided terminal (UUID),
   * fully expanding drawer calculations dynamically by querying sales.
   */
  async getCurrentSession(
    terminalId: string,
    posId: string,
    locationId: string,
  ) {
    // Get the current active session from the Tenant DB
    // posId field in PosSession actually stores the Terminal UUID
    const activeSession = await this.prisma.posSession.findFirst({
      where: {
        posId: terminalId,
        status: 'open',
      },
      orderBy: { openedAt: 'desc' },
    });

    // Fetch terminal info to check if it's a child terminal
    const terminal = await this.prisma.pos.findUnique({
      where: { id: terminalId },
    });

    if (terminal && !terminal.isParent) {
      // Find parent terminal for this location
      const parentTerminal = await this.prisma.pos.findFirst({
        where: {
          locationId: terminal.locationId,
          isParent: true,
          isDeleted: false,
          status: 'active',
        },
      });
      if (parentTerminal) {
        const parentActiveSession = await this.prisma.posSession.findFirst({
          where: { posId: parentTerminal.id, status: 'open' },
          orderBy: { openedAt: 'desc' },
        });

        // If parent has an active open session with a float
        if (parentActiveSession && parentActiveSession.openingFloat !== null) {
          let childActiveSession = activeSession;
          if (!childActiveSession) {
            childActiveSession = await this.prisma.posSession.findFirst({
              where: { posId: terminalId, status: 'open' },
              orderBy: { openedAt: 'desc' },
            });
          }
          if (!childActiveSession) {
            childActiveSession = await this.prisma.posSession.create({
              data: {
                posId: terminalId,
                status: 'open',
                openingFloat: 0,
              },
            });
          }

          // Query sales orders for this child terminal within its active session
          const cashSales = await this.prisma.salesOrder.aggregate({
            where: {
              posId: posId,
              status: 'completed',
              createdAt: {
                gte: childActiveSession.openedAt,
              },
            },
            _sum: {
              cashAmount: true,
            },
          });

          const calculatedCashSales = cashSales._sum.cashAmount
            ? Number(cashSales._sum.cashAmount)
            : 0;

          // Fetch refund vouchers issued during the child active session's timeframe
          const refundVouchers = await this.prisma.voucher.aggregate({
            where: {
              issuedByLocationId: terminal.locationId,
              voucherType: 'REFUND',
              createdAt: {
                gte: childActiveSession.openedAt,
              },
            },
            _sum: {
              faceValue: true,
            },
          });
          const refundVouchersTotal = refundVouchers._sum.faceValue
            ? Number(refundVouchers._sum.faceValue)
            : 0;

          return {
            session: childActiveSession,
            metrics: {
              openingFloat: 0,
              cashSales: calculatedCashSales,
              expectedCash: calculatedCashSales - refundVouchersTotal,
            },
            isDrawerOpen: true,
            authorizedByParent: true,
            parentSessionId: parentActiveSession.id,
          };
        }
      }
    }

    if (!activeSession) {
      return {
        session: null,
        metrics: {
          openingFloat: 0,
          cashSales: 0,
          expectedCash: 0,
        },
        isDrawerOpen: false,
        terminalContext: { terminalId, posId, locationId },
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

    const calculatedCashSales = cashSales._sum.cashAmount
      ? Number(cashSales._sum.cashAmount)
      : 0;

    // Fetch refund vouchers issued during the active session's timeframe for that location
    const refundVouchers = await this.prisma.voucher.aggregate({
      where: {
        issuedByLocationId: locationId,
        voucherType: 'REFUND',
        createdAt: {
          gte: activeSession.openedAt,
        },
      },
      _sum: {
        faceValue: true,
      },
    });
    const refundVouchersTotal = refundVouchers._sum.faceValue
      ? Number(refundVouchers._sum.faceValue)
      : 0;

    const floatAmount =
      activeSession.openingFloat !== null
        ? Number(activeSession.openingFloat)
        : null;

    // The total expected cash = Opening Float + total cash from sales - refund vouchers
    const expectedCash = (floatAmount ?? 0) + calculatedCashSales - refundVouchersTotal;

    return {
      session: activeSession,
      metrics: {
        openingFloat: floatAmount ?? 0,
        cashSales: calculatedCashSales,
        expectedCash: expectedCash,
      },
      isDrawerOpen: floatAmount !== null,
    };
  }

  /**
   * Set the opening float for the current session
   */
  async openDrawer(
    terminalId: string,
    amount: number,
    note?: string,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const terminal = await this.prisma.pos.findUnique({
        where: { id: terminalId },
      });
      if (!terminal) {
        throw new NotFoundException('Terminal not found');
      }
      if (!terminal.isParent) {
        throw new BadRequestException(
          'Shifts can only be opened on the Parent Terminal.',
        );
      }

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
      } else if (
        activeSession.openingFloat &&
        Number(activeSession.openingFloat) > 0
      ) {
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
  async closeDrawer(
    terminalId: string,
    posId: string,
    locationId: string,
    actualCash: number,
    note?: string,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const terminal = await this.prisma.pos.findUnique({
        where: { id: terminalId },
      });
      if (!terminal) {
        throw new NotFoundException('Terminal not found');
      }
      if (!terminal.isParent) {
        throw new BadRequestException(
          'Shifts can only be closed on the Parent Terminal.',
        );
      }

      // We first get the current session and calculations to figure out the variance
      const currentStatus = await this.getCurrentSession(
        terminalId,
        posId,
        locationId,
      );

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

      // Automatically close all child sessions at this location
      const openChildSessions = await this.prisma.posSession.findMany({
        where: {
          status: 'open',
          pos: {
            locationId: locationId,
            isParent: false,
          },
        },
      });

      for (const childSess of openChildSessions) {
        await this.prisma.posSession.update({
          where: { id: childSess.id },
          data: {
            status: 'closed',
            closedAt: new Date(),
          },
        });
      }

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

      runInBackground(
        'Generate POS Journal Voucher',
        this.generateReconciliationVoucher(
          currentStatus.session.id,
          closedSession.posId,
          ctx,
        ).catch((err) =>
          this.logger.error(
            `Failed to generate JV for session ${currentStatus.session.id}`,
            err,
          ),
        ),
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
    const terminal = await this.prisma.pos.findUnique({
      where: { id: terminalId },
    });
    if (!terminal) {
      throw new NotFoundException('Terminal not found');
    }
    const locationId = terminal.locationId;

    const parentPos = await this.prisma.pos.findFirst({
      where: { locationId, isParent: true, isDeleted: false, status: 'active' },
    });
    if (!parentPos) {
      return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };
    }

    const parentSessions = await this.prisma.posSession.findMany({
      where: {
        posId: parentPos.id,
        NOT: {
          status: 'open',
          openingFloat: 0,
        },
      },
      orderBy: { openedAt: 'desc' },
    });

    const dailyRecords: Array<{
      dateStr: string;
      sessionId: string;
      openedAt: Date;
      closedAt: Date | null;
      status: string;
      openingFloat: number;
      openingNote: string | null;
      closingNote: string | null;
    }> = [];

    const toLocalDateString = (d: Date) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    for (const sess of parentSessions) {
      const start = new Date(sess.openedAt);
      const end = sess.closedAt ? new Date(sess.closedAt) : new Date();

      const startDateStr = toLocalDateString(start);
      const endDateStr = toLocalDateString(end);

      let tempDate = new Date(start);
      while (toLocalDateString(tempDate) <= endDateStr) {
        const dateStr = toLocalDateString(tempDate);

        if (!dailyRecords.some((r) => r.dateStr === dateStr)) {
          dailyRecords.push({
            dateStr,
            sessionId: sess.id,
            openedAt: sess.openedAt,
            closedAt: sess.closedAt,
            status: sess.status,
            openingFloat: Number(sess.openingFloat),
            openingNote: sess.openingNote,
            closingNote: sess.closingNote,
          });
        }
        tempDate.setDate(tempDate.getDate() + 1);
      }
    }

    dailyRecords.sort((a, b) => b.dateStr.localeCompare(a.dateStr));

    const total = dailyRecords.length;
    const skip = (page - 1) * limit;
    const pageRecords = dailyRecords.slice(skip, skip + limit);

    const enriched = await Promise.all(
      pageRecords.map(async (record) => {
        const targetDate = new Date(record.dateStr + 'T00:00:00');
        const startOfDay = new Date(targetDate);
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date(targetDate);
        endOfDay.setHours(23, 59, 59, 999);

        // Fetch sales orders for the entire location on this day
        const [salesAgg, orderCount] = await Promise.all([
          this.prisma.salesOrder.aggregate({
            where: {
              locationId: locationId,
              status: 'completed',
              createdAt: {
                gte: startOfDay,
                lte: endOfDay,
              },
            },
            _sum: {
              grandTotal: true,
              cashAmount: true,
              cardAmount: true,
            },
          }),
          this.prisma.salesOrder.count({
            where: {
              locationId: locationId,
              status: 'completed',
              createdAt: {
                gte: startOfDay,
                lte: endOfDay,
              },
            },
          }),
        ]);

        const totalSales = Number(salesAgg._sum.grandTotal ?? 0);
        const cashSales = Number(salesAgg._sum.cashAmount ?? 0);
        const cardSales = Number(salesAgg._sum.cardAmount ?? 0);

        // Fetch refund vouchers issued during the day for this location
        const refundVouchers = await this.prisma.voucher.aggregate({
          where: {
            issuedByLocationId: locationId,
            voucherType: 'REFUND',
            createdAt: {
              gte: startOfDay,
              lte: endOfDay,
            },
          },
          _sum: {
            faceValue: true,
          },
        });
        const refundVouchersTotal = refundVouchers._sum.faceValue
          ? Number(refundVouchers._sum.faceValue)
          : 0;

        // Calculate daily expected and actual cash for the location
        const sessionsOnDay = await this.prisma.posSession.findMany({
          where: {
            pos: { locationId: locationId },
            openedAt: { lte: endOfDay },
            OR: [{ closedAt: null }, { closedAt: { gte: startOfDay } }],
          },
          include: { pos: true },
        });

        let totalStartingFloat = 0;
        for (const s of sessionsOnDay) {
          if (s.openedAt < startOfDay) {
            const priorSales = await this.prisma.salesOrder.aggregate({
              where: {
                posId: s.pos.posId,
                status: 'completed',
                createdAt: {
                  gte: s.openedAt,
                  lt: startOfDay,
                },
              },
              _sum: { cashAmount: true },
            });
            totalStartingFloat +=
              Number(s.openingFloat) + Number(priorSales._sum.cashAmount ?? 0);
          } else {
            totalStartingFloat += Number(s.openingFloat);
          }
        }

        const expectedCash = totalStartingFloat + cashSales - refundVouchersTotal;

        let totalActualCash = 0;
        let anySessionOpen = false;
        for (const s of sessionsOnDay) {
          if (s.status === 'open') {
            anySessionOpen = true;
          }
          if (s.closedAt && s.closedAt <= endOfDay) {
            totalActualCash += Number(s.actualCash ?? 0);
          } else {
            const sessionSalesOnDay = await this.prisma.salesOrder.aggregate({
              where: {
                posId: s.pos.posId,
                status: 'completed',
                createdAt: {
                  gte: s.openedAt > startOfDay ? s.openedAt : startOfDay,
                  lte: endOfDay,
                },
              },
              _sum: { cashAmount: true },
            });
            const sessionCashSalesOnDay = Number(
              sessionSalesOnDay._sum.cashAmount ?? 0,
            );

            // Fetch session's refund vouchers on this day
            const sessionRefundVouchers = await this.prisma.voucher.aggregate({
              where: {
                issuedByLocationId: locationId,
                voucherType: 'REFUND',
                createdAt: {
                  gte: s.openedAt > startOfDay ? s.openedAt : startOfDay,
                  lte: endOfDay,
                },
              },
              _sum: {
                faceValue: true,
              },
            });
            const sessionRefundVouchersTotal = sessionRefundVouchers._sum.faceValue
              ? Number(sessionRefundVouchers._sum.faceValue)
              : 0;

            let sessionStartingCash = 0;
            if (s.openedAt < startOfDay) {
              const priorSales = await this.prisma.salesOrder.aggregate({
                where: {
                  posId: s.pos.posId,
                  status: 'completed',
                  createdAt: {
                    gte: s.openedAt,
                    lt: startOfDay,
                  },
                },
                _sum: { cashAmount: true },
              });
              sessionStartingCash =
                Number(s.openingFloat) +
                Number(priorSales._sum.cashAmount ?? 0);
            } else {
              sessionStartingCash = Number(s.openingFloat);
            }
            totalActualCash += sessionStartingCash + sessionCashSalesOnDay - sessionRefundVouchersTotal;
          }
        }

        const difference = totalActualCash - expectedCash;

        return {
          id: record.sessionId,
          status: anySessionOpen ? 'open' : 'closed',
          openedAt: startOfDay,
          closedAt: anySessionOpen ? null : endOfDay,
          openingFloat: totalStartingFloat,
          openingNote: record.openingNote,
          expectedCash,
          actualCash:
            anySessionOpen && totalActualCash === expectedCash
              ? null
              : totalActualCash,
          difference:
            anySessionOpen && totalActualCash === expectedCash
              ? null
              : difference,
          closingNote: record.closingNote,
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
  async getReconciliationDetails(sessionId: string, date?: string, skipJvRegen = false) {
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

    if (session.status === 'closed' && !skipJvRegen) {
      runInBackground(
        'Regenerate POS Journal Voucher on fetch',
        this.generateReconciliationVoucher(session.id, session.posId).catch((err) =>
          this.logger.error(
            `Failed to regenerate JV for session ${session.id}`,
            err,
          ),
        ),
      );
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

    const toLocalDateString = (d: Date) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    // Calculate all calendar dates covered by this session (local time)
    const start = new Date(session.openedAt);
    const end = session.closedAt ? new Date(session.closedAt) : new Date();

    const startDateStr = toLocalDateString(start);
    const endDateStr = toLocalDateString(end);

    const availableDates: string[] = [];
    let tempDate = new Date(start);
    while (toLocalDateString(tempDate) <= endDateStr) {
      availableDates.push(toLocalDateString(tempDate));
      tempDate.setDate(tempDate.getDate() + 1);
    }

    // Determine the selected date
    const selectedDate =
      date && availableDates.includes(date) ? date : availableDates[0];

    // Filter by the selected date range
    const startOfDay = new Date(selectedDate + 'T00:00:00');
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(selectedDate + 'T00:00:00');
    endOfDay.setHours(23, 59, 59, 999);

    const startRange = new Date(
      Math.max(session.openedAt.getTime(), startOfDay.getTime()),
    );
    const sessionEnd = session.closedAt
      ? session.closedAt.getTime()
      : Date.now();
    const endRange = new Date(Math.min(sessionEnd, endOfDay.getTime()));

    const timeFilter = {
      gte: startRange,
      lte: endRange,
    };

    // Query sales orders within the timeframe of this session portion AND at the location level
    const orders = await this.prisma.salesOrder.findMany({
      where: {
        locationId: session.pos.locationId, // Change: Location-based reconciliation
        // status: 'completed',
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

    // Query all vouchers issued during this session portion at this location
    const issuedVouchers = await this.prisma.voucher.findMany({
      where: {
        createdAt: timeFilter,
        issuedByLocationId: session.pos.locationId,
      },
      include: {
        claims: true,
        merchant: true,
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
    const cardGroup: Record<
      string,
      { bank: string; amount: number; rate: number; commission: number }
    > = {};
    const cardVoucherGroup: Record<
      string,
      { bank: string; amount: number; rate: number; commission: number }
    > = {};

    // Vouchers received (redeemed) list
    const redeemedVouchersList: Array<{
      type: string;
      amount: number;
      from: string;
    }> = [];

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
      totalDiscounts += discountAmount + globalDiscountAmount;

      const isLegacy =
        order.voucherAmount === null || order.voucherAmount === undefined;
      const voucherRedemptionsSum =
        order.voucherRedemptions?.reduce(
          (sum, r) => sum + Number(r.amountUsed),
          0,
        ) ?? 0;

      const cash = Number(order.cashAmount ?? 0);
      const card = isLegacy
        ? Math.max(
            0,
            Number(order.cardAmount ?? 0) -
              voucherRedemptionsSum -
              Number(order.changeAmount ?? 0),
          )
        : Number(order.cardAmount ?? 0);
      const voucher = isLegacy
        ? voucherRedemptionsSum
        : Number(order.voucherAmount ?? 0);

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
        const orderIssuedVouchers = issuedVouchers.filter(
          (v) =>
            v.sourceOrderId === order.id &&
            (v.voucherType === 'GIFT' || v.voucherType === 'CORPORATE'),
        );
        const vouchersValue = orderIssuedVouchers.reduce(
          (sum, v) => {
            const fVal = Number(v.faceValue);
            const discAmt = Number(v.discount ?? 0);
            return sum + (fVal - discAmt);
          },
          0,
        );

        const voucherCardAmt = Math.min(card, vouchersValue);
        const regularCardAmt = card - voucherCardAmt;

        if (regularCardAmt > 0) {
          if (!cardGroup[bankName]) {
            cardGroup[bankName] = {
              bank: bankName,
              amount: 0,
              rate: ratePct,
              commission: 0,
            };
          }
          cardGroup[bankName].amount += regularCardAmt;
          cardGroup[bankName].commission += regularCardAmt * rateDecimal;
        }

        if (voucherCardAmt > 0) {
          if (!cardVoucherGroup[bankName]) {
            cardVoucherGroup[bankName] = {
              bank: bankName,
              amount: 0,
              rate: ratePct,
              commission: 0,
            };
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
      if (
        order.paymentMethod === 'credit_account' ||
        order.tenderType === 'credit_account' ||
        order.paymentMethod === 'split' ||
        order.tenderType === 'split'
      ) {
        const change = Number(order.changeAmount ?? 0);
        const netCash = Math.max(0, cash - change);

        const creditAmt = Math.max(
          0,
          Number((grandTotal - netCash - card - voucher).toFixed(2)),
        );
        if (creditAmt > 0) {
          totalCreditAmount += creditAmt;
        }
      }
    }

    // Vouchers Issued Grouping
    const exchangeAndClaims: Array<{
      type: string;
      amount: number;
      from: string;
    }> = [];
    const creditVouchers: Array<{
      type: string;
      amount: number;
      from: string;
      to: string;
    }> = [];
    const giftVouchers: Array<{
      type: string;
      amount: number;
      from: string;
      to: string;
    }> = [];
    const refundVouchers: Array<{
      type: string;
      amount: number;
      from: string;
    }> = [];

    // Track how much of cash/card was for gift vouchers issued
    let cashGiftVouchersAmt = 0;
    let cardGiftVouchersAmt = 0;
    let totalGiftVoucherDiscount = 0;

    for (const v of issuedVouchers) {
      const faceValue = Number(v.faceValue);

      if (v.voucherType === 'EXCHANGE') {
        const type =
          v.claims && v.claims.length > 0
            ? 'Claim Vouchers'
            : 'Exchange Vouchers';
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
      } else if (v.voucherType === 'REFUND') {
        refundVouchers.push({
          type: 'Refund Vouchers',
          amount: faceValue,
          from: v.code,
        });
      } else if (v.voucherType === 'GIFT' || v.voucherType === 'CORPORATE') {
        const type =
          v.voucherType === 'CORPORATE'
            ? 'Gift Vouchers Corporate'
            : 'Gift Vouchers';

        const discountAmount = Number(v.discount ?? 0);
        const netAmount = faceValue - discountAmount;
        totalGiftVoucherDiscount += discountAmount;

        // Attribute to Cash vs Card based on paymentMode or purchase order
        let isCard = false;
        let isCash = false;
        let fromDetail = '-';

        if (v.paymentMode === 'CARD') {
          isCard = true;
          const bank = v.merchant?.bankName || 'Card';
          const last4 = v.cardLast4 ? ` - ****${v.cardLast4}` : '';
          fromDetail = `${bank}${last4}`;
        } else if (v.paymentMode === 'CASH') {
          isCash = true;
          fromDetail = 'Cash';
        }

        // If not determined yet, try sourceOrderId
        if (!isCard && !isCash && v.sourceOrderId) {
          const purchaseOrder = orders.find((o) => o.id === v.sourceOrderId);
          if (purchaseOrder) {
            const cashPay = Number(purchaseOrder.cashAmount ?? 0);
            const cardPay = Number(purchaseOrder.cardAmount ?? 0);
            if (cardPay > 0) {
              isCard = true;
              const bank = purchaseOrder.merchant?.bankName || 'Card';
              fromDetail = bank;
            } else if (cashPay > 0) {
              isCash = true;
              fromDetail = 'Cash';
            }
          }
        }

        if (isCard) {
          cardGiftVouchersAmt += netAmount;

          // If this voucher is NOT linked to an order already counted in the order loop,
          // we must add its card payment/commission to cardGiftVouchers/totalCardReceived
          const isLinkedToOrder =
            v.sourceOrderId && orders.some((o) => o.id === v.sourceOrderId);
          if (!isLinkedToOrder) {
            totalCardReceived += netAmount;
            cardSalesCount++;

            const bankName = v.merchant?.bankName || 'Unknown Bank';
            const rateDecimal = Number(v.merchant?.commissionRate ?? 0);
            const ratePct = rateDecimal * 100;

            if (!cardVoucherGroup[bankName]) {
              cardVoucherGroup[bankName] = {
                bank: bankName,
                amount: 0,
                rate: ratePct,
                commission: 0,
              };
            }
            cardVoucherGroup[bankName].amount += netAmount;
            cardVoucherGroup[bankName].commission += netAmount * rateDecimal;
          }
        } else if (isCash) {
          cashGiftVouchersAmt += netAmount;

          const isLinkedToOrder =
            v.sourceOrderId && orders.some((o) => o.id === v.sourceOrderId);
          if (!isLinkedToOrder) {
            totalCashReceived += netAmount;
            cashSalesCount++;
          }
        }

        giftVouchers.push({
          type,
          amount: faceValue,
          from: fromDetail,
          to: v.code,
        });
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
      ...(cashGiftVouchersAmt > 0
        ? [
            {
              type: 'Cash - Gift Vouchers Issued',
              amount: cashGiftVouchersAmt,
              from: '-',
            },
          ]
        : []),
      ...redeemedVouchersList,
    ];

    // Card Payments array & Card Gift Vouchers array
    const cardPayments = Object.values(cardGroup);
    const cardGiftVouchers = Object.values(cardVoucherGroup);

    // Receivables On Credit
    const receivables = [
      { description: 'On Credit', amount: totalCreditAmount },
    ];

    // Financials:
    const totalCards = totalCardReceived;
    const totalReceived = totalCashReceived + totalVouchersReceivedAmt;
    const totalReceivable = totalCreditAmount;
    const fbrTotal = fbrCharges.reduce((sum, f) => sum + f.amount, 0);

    const creditCardGiftVouchersTotal = cardGiftVouchers.reduce(
      (sum, v) => sum + v.amount,
      0,
    );
    const cashGiftVouchersTotal = cashGiftVouchersAmt;

    const computedSale =
      totalCards -
      creditCardGiftVouchersTotal +
      (totalReceived - cashGiftVouchersTotal) +
      totalReceivable -
      fbrTotal;

    const totalIssued =
      exchangeAndClaims.reduce((sum, v) => sum + v.amount, 0) +
      creditVouchers.reduce((sum, v) => sum + v.amount, 0) +
      giftVouchers.reduce((sum, v) => sum + v.amount, 0) +
      refundVouchers.reduce((sum, v) => sum + v.amount, 0);

    const returnAmount =
      exchangeAndClaims.reduce((sum, v) => sum + v.amount, 0) +
      refundVouchers.reduce((sum, v) => sum + v.amount, 0);
      
    const creditVouchersTotal = creditVouchers.reduce(
      (sum, v) => sum + v.amount,
      0,
    );
    const refundVouchersTotal = refundVouchers.reduce(
      (sum, v) => sum + v.amount,
      0,
    );
    const financials = {
      sale: computedSale,
      salesReturn: returnAmount,
      netSales: computedSale - returnAmount,
    };

    const formatDate = (dateStr: string) => {
      const date = new Date(dateStr);
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      return `${day}/${month}/${year}`;
    };

    // Calculate daily expected and actual cash for the location
    const sessionsOnDay = await this.prisma.posSession.findMany({
      where: {
        pos: { locationId: session.pos.locationId },
        openedAt: { lte: endOfDay },
        OR: [{ closedAt: null }, { closedAt: { gte: startOfDay } }],
      },
      include: { pos: true },
    });

    let totalStartingFloat = 0;
    for (const s of sessionsOnDay) {
      if (s.openedAt < startOfDay) {
        const priorSales = await this.prisma.salesOrder.aggregate({
          where: {
            posId: s.pos.posId,
            status: 'completed',
            createdAt: {
              gte: s.openedAt,
              lt: startOfDay,
            },
          },
          _sum: { cashAmount: true },
        });
        totalStartingFloat +=
          Number(s.openingFloat) + Number(priorSales._sum.cashAmount ?? 0);
      } else {
        totalStartingFloat += Number(s.openingFloat);
      }
    }

    const expectedCash = totalStartingFloat + totalCashReceived - refundVouchersTotal;

    let totalActualCash = 0;
    let anySessionOpen = false;
    for (const s of sessionsOnDay) {
      if (s.status === 'open') {
        anySessionOpen = true;
      }
      if (s.closedAt && s.closedAt <= endOfDay) {
        totalActualCash += Number(s.actualCash ?? 0);
      } else {
        const sessionSalesOnDay = await this.prisma.salesOrder.aggregate({
          where: {
            posId: s.pos.posId,
            status: 'completed',
            createdAt: {
              gte: s.openedAt > startOfDay ? s.openedAt : startOfDay,
              lte: endOfDay,
            },
          },
          _sum: { cashAmount: true },
        });
        const sessionCashSalesOnDay = Number(
          sessionSalesOnDay._sum.cashAmount ?? 0,
        );

        // Fetch session's refund vouchers on this day
        const sessionRefundVouchers = await this.prisma.voucher.aggregate({
          where: {
            issuedByLocationId: session.pos.locationId,
            voucherType: 'REFUND',
            createdAt: {
              gte: s.openedAt > startOfDay ? s.openedAt : startOfDay,
              lte: endOfDay,
            },
          },
          _sum: {
            faceValue: true,
          },
        });
        const sessionRefundVouchersTotal = sessionRefundVouchers._sum.faceValue
          ? Number(sessionRefundVouchers._sum.faceValue)
          : 0;

        let sessionStartingCash = 0;
        if (s.openedAt < startOfDay) {
          const priorSales = await this.prisma.salesOrder.aggregate({
            where: {
              posId: s.pos.posId,
              status: 'completed',
              createdAt: {
                gte: s.openedAt,
                lt: startOfDay,
              },
            },
            _sum: { cashAmount: true },
          });
          sessionStartingCash =
            Number(s.openingFloat) + Number(priorSales._sum.cashAmount ?? 0);
        } else {
          sessionStartingCash = Number(s.openingFloat);
        }
        totalActualCash += sessionStartingCash + sessionCashSalesOnDay - sessionRefundVouchersTotal;
      }
    }

    const difference = anySessionOpen ? null : totalActualCash - expectedCash;
    const finalActualCash = anySessionOpen ? null : totalActualCash;

    const startRangeStr = startRange.toISOString();
    const endRangeStr = endRange.toISOString();
    const dateRange =
      formatDate(startRangeStr) === formatDate(endRangeStr)
        ? formatDate(startRangeStr)
        : `${formatDate(startRangeStr)} - ${formatDate(endRangeStr)}`;

    return {
      companyName: 'Speed (Private) Limited',
      locationName: session.pos.location?.name ?? 'Nike-Dolmen Clifton',
      reportTitle: 'Sales Reconciliation',
      dateRange: dateRange,
      documentNumber: `REC-${session.id ? session.id.substring(0, 8).toUpperCase() : 'TEMP'}`,
      availableDates,
      selectedDate,

      session: {
        id: session.id,
        status: anySessionOpen ? 'open' : 'closed',
        openedAt: startRange,
        closedAt: anySessionOpen ? null : endRange,
        openingFloat: totalStartingFloat,
        openingNote: session.openingNote,
        expectedCash,
        actualCash: finalActualCash,
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
        grossSales: financials.sale,
        netSales: financials.netSales,
        totalTaxes,
        totalDiscounts,
        orderCount: orders.length,
        averageOrderValue:
          orders.length > 0 ? financials.netSales / orders.length : 0,
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
        refundVouchers,
        totalGiftVoucherDiscount,
      },
      fbrCharges,
      financials,
      cashBreakdown: {
        sale: cashSaleAmt,
        giftVouchers: cashGiftVouchersAmt,
        refundVouchers: refundVouchersTotal,
        total: totalCashReceived - refundVouchersTotal,
      },
      cardBreakdown: {
        sale: cardSaleAmt,
        giftVouchers: cardGiftVouchersAmt,
        total: totalCardReceived,
      },
    };
  }
  /**
   * Generates a Journal Voucher for a closed session based on reconciliation details.
   */
  private async generateReconciliationVoucher(
    sessionId: string,
    terminalId: string,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const session = await this.prisma.posSession.findUnique({
        where: { id: sessionId },
      });
      if (!session) return;

      // Clean up all existing pending JVs for this session first (both old format and new format)
      const sessionPrefix = `RS RV-${sessionId.substring(0, 8).toUpperCase()}`;
      const existingJvs = await this.prisma.journalVoucher.findMany({
        where: {
          OR: [
            { jvNo: { startsWith: sessionPrefix } },
            { jvNo: sessionPrefix }
          ]
        }
      });

      for (const existingJv of existingJvs) {
        if (existingJv.status === 'pending') {
          await this.prisma.$transaction(async (tx) => {
            await tx.journalVoucherDetail.deleteMany({
              where: { journalVoucherId: existingJv.id },
            });
            await tx.journalVoucher.delete({
              where: { id: existingJv.id },
            });
          });
          this.logger.log(`Cleaned up existing pending JV: ${existingJv.jvNo}`);
        }
      }

      const toLocalDateString = (d: Date) => {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };

      const start = new Date(session.openedAt);
      const end = session.closedAt ? new Date(session.closedAt) : new Date();

      const startDateStr = toLocalDateString(start);
      const endDateStr = toLocalDateString(end);

      const availableDates: string[] = [];
      let tempDate = new Date(start);
      while (toLocalDateString(tempDate) <= endDateStr) {
        availableDates.push(toLocalDateString(tempDate));
        tempDate.setDate(tempDate.getDate() + 1);
      }

      for (const dateStr of availableDates) {
        const metrics = await this.getReconciliationDetails(sessionId, dateStr, true);
        const date = new Date(dateStr + 'T12:00:00');
        const locationCode = metrics.session.terminal.locationCode;
        const jvDateStr = `${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getFullYear()}`;

        // Helper to get Account ID
        const accountMap = new Map<string, string>();
        const getAccountId = async (
          code: string | null | undefined,
        ): Promise<string | null> => {
          if (!code) return null;
          if (accountMap.has(code)) return accountMap.get(code)!;
          const acc = await this.prisma.chartOfAccount.findFirst({
            where: { code },
          });
          if (acc) {
            accountMap.set(code, acc.id);
            return acc.id;
          }
          return null;
        };

        const details: any[] = [];
        let hasMissingMappings = false;

        const addLine = async (
          code: string | null,
          tagCode: string | null,
          debit: number,
          credit: number,
          baseNarration: string,
        ) => {
          if (debit === 0 && credit === 0) return;

          let accountId = await getAccountId(code);
          let tagId = await getAccountId(tagCode);
          let narration = baseNarration;

          if (code && !accountId) {
            const fallback = await this.prisma.chartOfAccount.findFirst();
            accountId = fallback?.id || 'MISSING';
            narration = `[MISSING GL CODE: ${code}] ` + narration;
            hasMissingMappings = true;
          }

          if (tagCode && !tagId) {
            narration = `[MISSING TAG: ${tagCode}] ` + narration;
            hasMissingMappings = true;
          }

          if (!accountId) return; // if completely failed to fallback

          details.push({
            accountId,
            tagAccountId: tagId,
            debit,
            credit,
            narration,
          });
        };

        // 1. Credit / Debit Cards (Merchant)
        let totalCommission = 0;

        for (const card of metrics.cardPayments) {
          // Find bank GL code
          const merchant = await this.prisma.merchantConfig.findFirst({
            where: { bankName: card.bank },
            orderBy: { createdAt: 'desc' },
          });
          if (merchant?.bankGlCode) {
            const comm = Number(card.commission.toFixed(2));
            totalCommission += comm;
            const netAmount = Number((card.amount - comm).toFixed(2));
            await addLine(
              merchant.bankGlCode,
              locationCode,
              netAmount,
              0,
              `Credit Card Sales ${card.bank} | ${jvDateStr}`,
            );
          }
        }
        for (const card of metrics.cardGiftVouchers) {
          const merchant = await this.prisma.merchantConfig.findFirst({
            where: { bankName: card.bank },
            orderBy: { createdAt: 'desc' },
          });
          if (merchant?.bankGlCode) {
            const comm = Number(card.commission.toFixed(2));
            totalCommission += comm;
            const netAmount = Number((card.amount - comm).toFixed(2));
            await addLine(
              merchant.bankGlCode,
              locationCode,
              netAmount,
              0,
              `Credit Card Sales ${card.bank} | ${jvDateStr}`,
            );
          }
        }

        // 2. Total Credit/Debit Cards Commission
        await addLine(
          '80210001',
          locationCode,
          totalCommission,
          0,
          `Total Credit Card Commission | ${jvDateStr}`,
        );

        // 3. Cash && Cash - Gift Vouchers Issued
        const sessionData = await this.prisma.posSession.findUnique({
          where: { id: sessionId },
          include: { pos: { include: { location: true } } },
        });
        const cashGl = sessionData?.pos?.location?.cashGLCode || '31090001';
        if (cashGl) {
          // Cash Sales entry
          await addLine(
            cashGl,
            locationCode,
            metrics.cashBreakdown.sale,
            0,
            `CASH SALES | ${jvDateStr}`,
          );

          // Cash - Gift Vouchers Issued entry
          await addLine(
            cashGl,
            locationCode,
            metrics.cashBreakdown.giftVouchers,
            0,
            `Cash - Gift Vouchers Issued | ${jvDateStr}`,
          );
        }

        // Vouchers Redeemed (Received)
        for (const v of metrics.receivedVouchers) {
          if (v.type === 'Gift Vouchers Corporate') {
            // Try to find the voucher's company GL code
            const voucher = await this.prisma.voucher.findFirst({
              where: { code: v.from },
            });
            const tagId = voucher?.companyGlCode
              ? voucher.companyGlCode
              : locationCode;
            await addLine(
              '12070008',
              tagId,
              v.amount,
              0,
              `Corporate Gift Vouchers Collected | GVC#${v.from} | ${jvDateStr}`,
            );
          } else if (v.type === 'Gift Vouchers') {
            await addLine(
              '12070007',
              locationCode,
              v.amount,
              0,
              `Gift Voucher Collected | GV#${v.from} | ${jvDateStr}`,
            );
          } else if (v.type === 'Credit Vouchers') {
            await addLine(
              '12070006',
              locationCode,
              v.amount,
              0,
              `Credit Voucher Collected | CRV#${v.from} | ${jvDateStr}`,
            );
          } else if (v.type === 'Claim Vouchers') {
            await addLine(
              '12070009',
              locationCode,
              v.amount,
              0,
              `Claim Voucher Collected | CV#${v.from} | ${jvDateStr}`,
            );
          } else if (v.type === 'Exchange Vouchers') {
            await addLine(
              '12070010',
              locationCode,
              v.amount,
              0,
              `Exchange Voucher Collected | EV#${v.from} | ${jvDateStr}`,
            );
          }
        }

        // 9. On Credit (Receivables)
        for (const rec of metrics.receivables) {
          await addLine(
            '31030001',
            locationCode,
            rec.amount,
            0,
            `Ded from staff salary ag.CM#123 NDC | ${jvDateStr}`,
          ); // Using default narration requested by user
        }

        // Issued Vouchers
        for (const ev of metrics.issuedVouchers.exchangeAndClaims) {
          if (ev.type === 'Exchange Vouchers') {
            await addLine(
              '12070010',
              locationCode,
              0,
              ev.amount,
              `Exchange Voucher Issued | EV#${ev.from} | ${jvDateStr}`,
            );
          } else if (ev.type === 'Claim Vouchers') {
            await addLine(
              '12070009',
              locationCode,
              0,
              ev.amount,
              `Claim Voucher Issued | CV#${ev.from} | ${jvDateStr}`,
            );
          }
        }
        for (const cv of metrics.issuedVouchers.creditVouchers) {
          await addLine(
            '12070006',
            locationCode,
            0,
            cv.amount,
            `Credit Voucher Issued | CRV#${cv.to} | ${jvDateStr}`,
          );
        }
        for (const gv of metrics.issuedVouchers.giftVouchers) {
          if (gv.type === 'Gift Vouchers Corporate') {
            await addLine(
              '12070008',
              locationCode,
              0,
              gv.amount,
              `Corporate Gift Voucher Issued | GVC#${gv.to} | ${jvDateStr}`,
            );
          } else {
            await addLine(
              '12070007',
              locationCode,
              0,
              gv.amount,
              `Gift Voucher Issued | GV#${gv.to} | ${jvDateStr}`,
            );
          }
        }
        for (const rv of metrics.issuedVouchers.refundVouchers) {
          await addLine(
            '12070002',
            locationCode,
            0,
            rv.amount,
            `Refund Voucher Issued | ${rv.from} | ${jvDateStr}`,
          );
        }

        // 14. FBR POS
        const fbrCash =
          metrics.fbrCharges.find((c) => c.type === 'Cash')?.amount || 0;
        const fbrCard =
          metrics.fbrCharges.find((c) => c.type === 'Card')?.amount || 0;
        await addLine(
          '12060009',
          locationCode,
          0,
          fbrCard,
          `POS Service Fee Credit Card | ${jvDateStr}`,
        );
        await addLine(
          '12060009',
          locationCode,
          0,
          fbrCash,
          `POS Service Fee Cash | ${jvDateStr}`,
        );

        // Sales Return
        await addLine(
          '40020014',
          locationCode,
          metrics.financials.salesReturn,
          0,
          `Retail Sales Return | ${jvDateStr}`,
        );

        // Final Calculations
        const totalReceived = metrics.cashBreakdown.total + metrics.paymentBreakdown.voucher.amount;
        const netReceivedCard = metrics.cardBreakdown.total;

        const creditVouchersAmt = metrics.issuedVouchers.creditVouchers.reduce(
          (s, v) => s + v.amount,
          0,
        );
        const cashGiftVouchersAmt = metrics.cashBreakdown.giftVouchers;
        const cardGiftVouchersAmt = metrics.cardBreakdown.giftVouchers;
        const receivablesAmt = metrics.receivables.reduce(
          (s, r) => s + r.amount,
          0,
        );

        // AC: 12070002 -> Transfer Current A/c Cash
        // Credit = Total Received + Receivables - Credit Vouchers - Cash Gift Vouchers - On Cash FBR
        const transferCash =
          totalReceived +
          receivablesAmt -
          creditVouchersAmt -
          cashGiftVouchersAmt -
          fbrCash;

        await addLine(
          '12070002',
          locationCode,
          0,
          transferCash,
          `Transfer Current A/c Cash | ${jvDateStr}`,
        );

        // AC: 12070003 -> Transfer Current A/c Card
        // Credit = Net Card Total - Card FBR Charges (since bank commission is subtracted from Credit Card Sales bank GL entry)
        const transferCard = Number((netReceivedCard - fbrCard).toFixed(2));
        await addLine(
          '12070003',
          locationCode,
          0,
          transferCard,
          `Transfer Current A/c Card | ${jvDateStr}`,
        );

        if (details.length === 0) {
          this.logger.log(
            `No entries to generate JV for session ${sessionId} on ${dateStr}`,
          );
          continue;
        }

        // Generate JV
        const jvNo = `RS RV-${sessionId.substring(0, 8).toUpperCase()}-${dateStr}`;

        // Auto-balance the voucher if debits and credits do not match
        let totalDebit = 0;
        let totalCredit = 0;
        details.forEach((d) => {
          totalDebit += d.debit;
          totalCredit += d.credit;
        });

        const diff = Math.abs(totalDebit - totalCredit);
        let description =
          `POS Reconciliation for ${locationCode} on ${jvDateStr}` +
          (hasMissingMappings
            ? `\n\nATTENTION: Some entries have missing Tag IDs or Account GL Codes. Please correct them before approving.`
            : '');

        if (diff > 0.01) {
          const fallback = await this.prisma.chartOfAccount.findFirst();
          const accountId = fallback?.id || 'MISSING';
          let balDebit = 0;
          let balCredit = 0;
          if (totalDebit > totalCredit) {
            balCredit = diff;
          } else {
            balDebit = diff;
          }
          details.push({
            accountId,
            tagAccountId: null,
            debit: balDebit,
            credit: balCredit,
            narration: `[AUTO-BALANCING LINE] To balance JV. Total Debit was ${totalDebit.toFixed(2)}, Total Credit was ${totalCredit.toFixed(2)}`,
          });
          description += `\n\nATTENTION: Voucher was unbalanced by ${diff.toFixed(2)}. An auto-balancing line was added. Please review and correct.`;
        }

        // Check if JV already exists (it would only exist if it's approved and was not deleted)
        const approvedJv = await this.prisma.journalVoucher.findUnique({
          where: { jvNo },
        });

        if (approvedJv) {
          this.logger.log(`Journal Voucher ${jvNo} already exists and is not pending. Skipping.`);
          continue;
        }

        await this.journalVoucherService.create(
          {
            jvNo,
            jvDate: date,
            description,
            status: 'pending',
            details,
          },
          ctx,
        );

        this.logger.log(`Generated JV ${jvNo} for session ${sessionId}`);
      }
    } catch (error) {
      this.logger.error(
        `Error generating Reconciliation JV for session ${sessionId}:`,
        error,
      );
    }
  }
}
