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
import { ReceiptVoucherService } from '../finance/receipt-voucher/receipt-voucher.service';
import { Logger } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
@Injectable()
export class PosSessionService {
  private readonly logger = new Logger(PosSessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly prismaMaster: PrismaMasterService,
    private activityLogs: ActivityLogsService,
    private readonly journalVoucherService: JournalVoucherService,
    private readonly receiptVoucherService: ReceiptVoucherService,
    @InjectQueue('reconciliation-export') private readonly exportQueue?: Queue,
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

          const recon = await this.getReconciliationDetails(childActiveSession.id, undefined, true);

          return {
            session: childActiveSession,
            metrics: {
              openingFloat: recon.session.openingFloat ?? 0,
              cashSales: recon.paymentBreakdown?.cash?.amount ?? 0,
              expectedCash: recon.session.expectedCash ?? 0,
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

    const recon = await this.getReconciliationDetails(activeSession.id, undefined, true);

    const floatAmount =
      activeSession.openingFloat !== null
        ? Number(activeSession.openingFloat)
        : null;

    return {
      session: activeSession,
      metrics: {
        openingFloat: recon.session.openingFloat ?? 0,
        cashSales: recon.paymentBreakdown?.cash?.amount ?? 0,
        expectedCash: recon.session.expectedCash ?? 0,
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
        'Generate POS Receipt Voucher',
        this.generateReconciliationVoucher(
          currentStatus.session.id,
          closedSession.posId,
          ctx,
        ).catch((err) =>
          this.logger.error(
            `Failed to generate RV for session ${currentStatus.session.id}`,
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

    const total = parentSessions.length;
    const skip = (page - 1) * limit;
    const pageSessions = parentSessions.slice(skip, skip + limit);

    const enriched = await Promise.all(
      pageSessions.map(async (sess) => {
        const recon = await this.getReconciliationDetails(sess.id, undefined, true);

        return {
          id: sess.id,
          status: sess.status,
          openedAt: sess.openedAt,
          closedAt: sess.closedAt,
          openingFloat: recon.session.openingFloat ?? 0,
          openingNote: sess.openingNote,
          closingNote: sess.closingNote,
          expectedCash: recon.session.expectedCash ?? 0,
          actualCash: recon.session.actualCash,
          difference: recon.session.difference,
          metrics: {
            totalSales: recon.metrics.grossSales ?? 0,
            cashSales: recon.paymentBreakdown?.cash?.amount ?? 0,
            cardSales: recon.paymentBreakdown?.card?.amount ?? 0,
            orderCount: recon.metrics.orderCount ?? 0,
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
        'Regenerate POS RS-RV Voucher on fetch',
        this.generateReconciliationVoucher(session.id, session.posId).catch((err) =>
          this.logger.error(
            `Failed to regenerate RS-RV for session ${session.id}`,
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

      const voucherRedemptionsSum =
        order.voucherRedemptions?.reduce(
          (sum, r) => sum + Number(r.amountUsed),
          0,
        ) ?? 0;

      const rawCash = Number(order.cashAmount ?? 0);
      const rawCard = Number(order.cardAmount ?? 0);
      const change = Number(order.changeAmount ?? 0);

      // Determine if voucher redemption is double-counted within card/cash amounts
      const excess = Math.max(
        0,
        rawCash + rawCard + voucherRedemptionsSum - (grandTotal + change),
      );

      let cash = rawCash;
      let card = rawCard;
      if (excess > 0) {
        if (card > 0) {
          card = Math.max(0, card - excess);
        } else {
          cash = Math.max(0, cash - excess);
        }
      }

      // Fallback for non-split orders with empty cash/card amounts in DB
      if (order.tenderType !== 'split' && order.paymentMethod) {
        if (order.paymentMethod === 'cash') {
          if (cash === 0) cash = Math.max(0, grandTotal - voucherRedemptionsSum);
        } else if (order.paymentMethod === 'card' || order.paymentMethod === 'bank_transfer') {
          if (card === 0) card = Math.max(0, grandTotal - voucherRedemptionsSum);
        }
      }

      const voucher = voucherRedemptionsSum;


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
          const v = redemption.voucher;
          let amountToUse = amountUsed;

          let type = 'Vouchers';
          if (v.voucherType === 'CORPORATE') {
            type = 'Gift Vouchers Corporate';
          } else if (v.voucherType === 'GIFT') {
            type = 'Gift Vouchers';
          } else if (v.voucherType === 'CREDIT') {
            type = 'Credit Vouchers';
            amountToUse = Number(v.faceValue);
          } else if (v.voucherType === 'EXCHANGE') {
            if (v.claims && v.claims.length > 0) {
              type = 'Claim Vouchers';
            } else {
              type = 'Exchange Vouchers';
            }
            amountToUse = Number(v.faceValue);
          } else if (v.voucherType === 'OUTLET_GIFT') {
            type = 'Outlet Gift Vouchers';
          }

          totalVouchersReceivedAmt += amountToUse;

          redeemedVouchersList.push({
            type,
            amount: amountToUse,
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
    let unusedBalanceVouchersTotal = 0;

    for (const v of issuedVouchers) {
      const faceValue = Number(v.faceValue);

      if (v.description && v.description.includes('unused balance from')) {
        unusedBalanceVouchersTotal += faceValue;
      }

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
      fbrTotal -
      unusedBalanceVouchersTotal;

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
        unusedBalanceVouchersTotal,
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
  }}}

  async getDaywiseReconciliation(locationId: string, date: string) {
    const locIds = locationId ? locationId.split(',').map((s) => s.trim()).filter(Boolean) : [];

    const computeSingleReconciliation = async (targetLocWhere: any, displayName: string, targetLocId?: string) => {
      const startOfDay = new Date(date + 'T00:00:00');
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(date + 'T00:00:00');
      endOfDay.setHours(23, 59, 59, 999);

      const timeFilter = {
        gte: startOfDay,
        lte: endOfDay,
      };

      const orders = await this.prisma.salesOrder.findMany({
        where: {
          ...(targetLocWhere && { locationId: targetLocWhere }),
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

      const issuedVouchers = await this.prisma.voucher.findMany({
        where: {
          createdAt: timeFilter,
          ...(targetLocWhere && { issuedByLocationId: targetLocWhere }),
        },
        include: {
          claims: true,
          merchant: true,
        },
      });

      let grossSales = 0;
      let totalTaxes = 0;
      let totalDiscounts = 0;

      let totalCashReceived = 0;
      let totalCardReceived = 0;
      let cashSalesCount = 0;
      let cardSalesCount = 0;
      let voucherSalesCount = 0;
      let totalVouchersReceivedAmt = 0;

      const cardGroup: Record<
        string,
        { bank: string; amount: number; rate: number; commission: number }
      > = {};
      const cardVoucherGroup: Record<
        string,
        { bank: string; amount: number; rate: number; commission: number }
      > = {};

      const redeemedVouchersList: Array<{
        type: string;
        amount: number;
        from: string;
      }> = [];

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

        const voucherRedemptionsSum =
          order.voucherRedemptions?.reduce(
            (sum, r) => sum + Number(r.amountUsed),
            0,
          ) ?? 0;

        const rawCash = Number(order.cashAmount ?? 0);
        const rawCard = Number(order.cardAmount ?? 0);
        const change = Number(order.changeAmount ?? 0);

        const excess = Math.max(
          0,
          rawCash + rawCard + voucherRedemptionsSum - (grandTotal + change),
        );

        let cash = rawCash;
        let card = rawCard;
        if (excess > 0) {
          if (card > 0) {
            card = Math.max(0, card - excess);
          } else {
            cash = Math.max(0, cash - excess);
          }
        }

        if (order.tenderType !== 'split' && order.paymentMethod) {
          if (order.paymentMethod === 'cash') {
            if (cash === 0) cash = Math.max(0, grandTotal - voucherRedemptionsSum);
          } else if (order.paymentMethod === 'card' || order.paymentMethod === 'bank_transfer') {
            if (card === 0) card = Math.max(0, grandTotal - voucherRedemptionsSum);
          }
        }

        const voucher = voucherRedemptionsSum;

        if (cash > 0) {
          cashSalesCount++;
          totalCashReceived += cash;
        }
        if (card > 0) {
          cardSalesCount++;
          totalCardReceived += card;

          const bankName = order.merchant?.bankName || 'Unknown Bank';
          const rateDecimal = Number(order.merchant?.commissionRate ?? 0);
          const ratePct = rateDecimal * 100;

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

        if (order.voucherRedemptions && order.voucherRedemptions.length > 0) {
          for (const redemption of order.voucherRedemptions) {
            const amountUsed = Number(redemption.amountUsed);
            const v = redemption.voucher;
            let amountToUse = amountUsed;

            let type = 'Vouchers';
            if (v.voucherType === 'CORPORATE') {
              type = 'Gift Vouchers Corporate';
            } else if (v.voucherType === 'GIFT') {
              type = 'Gift Vouchers';
            } else if (v.voucherType === 'CREDIT') {
              type = 'Credit Vouchers';
              amountToUse = Number(v.faceValue);
            } else if (v.voucherType === 'EXCHANGE') {
              if (v.claims && v.claims.length > 0) {
                type = 'Claim Vouchers';
              } else {
                type = 'Exchange Vouchers';
              }
              amountToUse = Number(v.faceValue);
            } else if (v.voucherType === 'OUTLET_GIFT') {
              type = 'Outlet Gift Vouchers';
            }

            totalVouchersReceivedAmt += amountToUse;

            redeemedVouchersList.push({
              type,
              amount: amountToUse,
              from: v.code,
            });
          }
        }

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

      let cashGiftVouchersAmt = 0;
      let cardGiftVouchersAmt = 0;
      let totalGiftVoucherDiscount = 0;
      let unusedBalanceVouchersTotal = 0;

      for (const v of issuedVouchers) {
        const faceValue = Number(v.faceValue);

        if (v.description && v.description.includes('unused balance from')) {
          unusedBalanceVouchersTotal += faceValue;
        }

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

      const cashSaleAmt = Math.max(0, totalCashReceived - cashGiftVouchersAmt);
      const cardSaleAmt = Math.max(0, totalCardReceived - cardGiftVouchersAmt);

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

      const cardPayments = Object.values(cardGroup);
      const cardGiftVouchers = Object.values(cardVoucherGroup);

      const receivables = [
        { description: 'On Credit', amount: totalCreditAmount },
      ];

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
        fbrTotal -
        unusedBalanceVouchersTotal;

      const returnAmount =
        exchangeAndClaims.reduce((sum, v) => sum + v.amount, 0) +
        refundVouchers.reduce((sum, v) => sum + v.amount, 0);

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
        const d = new Date(dateStr);
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        return `${day}/${month}/${year}`;
      };

      return {
        companyName: 'Speed (Private) Limited',
        locationId: targetLocId || locationId,
        locationName: displayName,
        reportTitle: 'Sales Reconciliation',
        dateRange: formatDate(date + 'T00:00:00'),
        documentNumber: `REC-${date.replace(/-/g, '')}`,
        selectedDate: date,
        session: null,
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
          unusedBalanceVouchersTotal,
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
    };

    if (locIds.length === 1) {
      const location = await this.prisma.location.findUnique({
        where: { id: locIds[0] },
        select: { id: true, name: true, code: true },
      });
      const singleReport = await computeSingleReconciliation(
        locIds[0],
        location?.name ?? 'Location',
        locIds[0],
      );
      return {
        ...singleReport,
        locations: [singleReport],
        merged: singleReport,
      };
    }

    const targetLocations = await this.prisma.location.findMany({
      where: locIds.length > 0 ? { id: { in: locIds } } : { status: 'active' },
      select: { id: true, name: true, code: true },
    });

    const locationWhere = locIds.length > 1 ? { in: locIds } : undefined;

    const mergedReport = await computeSingleReconciliation(
      locationWhere,
      locIds.length > 1 ? 'Merged Outlets' : 'All Outlets (Merged)',
      locationId,
    );

    const perLocationReports = await Promise.all(
      targetLocations.map((loc) =>
        computeSingleReconciliation(loc.id, loc.name, loc.id),
      ),
    );

    return {
      ...mergedReport,
      locations: perLocationReports,
      merged: mergedReport,
    };
  }

  async exportDaywiseReconciliationExcel(locationId: string, date: string, res: any) {
    const data = await this.getDaywiseReconciliation(locationId, date);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sales Reconciliation');

    sheet.columns = [
      { key: 'colA', width: 35 },
      { key: 'colB', width: 18 },
      { key: 'colC', width: 12 },
      { key: 'colD', width: 18 },
      { key: 'colE', width: 15 },
      { key: 'colF', width: 15 },
    ];

    const BORDER_THIN: Partial<ExcelJS.Borders> = {
      top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    };

    sheet.addRow([data.companyName]).font = { bold: true, size: 14 };
    sheet.addRow([data.locationName]);
    sheet.addRow([data.reportTitle]);
    sheet.addRow([`Period: ${data.dateRange}`]);
    sheet.addRow([`Document #: ${data.documentNumber}`]);
    sheet.addRow([]);

    const addSectionHeader = (title: string) => {
      const row = sheet.addRow([title]);
      row.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
      row.eachCell((cell) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF1E3A5F' },
        };
      });
      sheet.mergeCells(row.number, 1, row.number, 6);
    };

    const addTableHeader = (headers: string[]) => {
      const row = sheet.addRow(headers);
      row.font = { bold: true, size: 10 };
      row.eachCell((cell) => {
        cell.border = BORDER_THIN;
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF1F5F9' },
        };
      });
    };

    const formatCurrencyCell = (val: number) => {
      return val === 0 ? '-' : val;
    };

    // 1. Cards
    addSectionHeader('CREDIT | DEBIT CARDS');
    addTableHeader(['Bank', 'Amount', 'Rate %', 'Bank Comm.', '', '']);
    let cardPaymentsAmountSum = 0;
    let cardPaymentsCommSum = 0;
    for (const card of data.cardPayments) {
      sheet.addRow([
        card.bank,
        formatCurrencyCell(card.amount),
        card.rate.toFixed(3),
        formatCurrencyCell(card.commission),
      ]);
      cardPaymentsAmountSum += card.amount;
      cardPaymentsCommSum += card.commission;
    }
    const cardSubRow = sheet.addRow([
      'SUBTOTAL',
      formatCurrencyCell(cardPaymentsAmountSum),
      '',
      formatCurrencyCell(cardPaymentsCommSum),
    ]);
    cardSubRow.font = { bold: true };
    cardSubRow.eachCell((cell) => (cell.border = BORDER_THIN));
    sheet.addRow([]);

    // 2. Gift Cards
    addSectionHeader('CREDIT CARD - GIFT VOUCHERS ISSUED');
    addTableHeader(['Bank', 'Amount', 'Rate %', 'Bank Comm.', '', '']);
    let cardGiftVouchersAmountSum = 0;
    let cardGiftVouchersCommSum = 0;
    if (data.cardGiftVouchers && data.cardGiftVouchers.length > 0) {
      for (const card of data.cardGiftVouchers) {
        sheet.addRow([
          card.bank,
          formatCurrencyCell(card.amount),
          card.rate.toFixed(3),
          formatCurrencyCell(card.commission),
        ]);
        cardGiftVouchersAmountSum += card.amount;
        cardGiftVouchersCommSum += card.commission;
      }
      const subRow = sheet.addRow([
        'SUBTOTAL',
        formatCurrencyCell(cardGiftVouchersAmountSum),
        '',
        formatCurrencyCell(cardGiftVouchersCommSum),
      ]);
      subRow.font = { bold: true };
      subRow.eachCell((cell) => (cell.border = BORDER_THIN));
    } else {
      sheet.addRow(['No vouchers issued on card payments.']);
    }
    sheet.addRow([]);

    // Total Cards
    const totalCardsRow = sheet.addRow([
      'TOTAL CREDIT/DEBIT CARDS',
      formatCurrencyCell(cardPaymentsAmountSum + cardGiftVouchersAmountSum),
      '',
      formatCurrencyCell(cardPaymentsCommSum + cardGiftVouchersCommSum),
    ]);
    totalCardsRow.font = { bold: true, size: 11 };
    totalCardsRow.eachCell((cell) => {
      cell.border = BORDER_THIN;
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE2E8F0' },
      };
    });
    sheet.addRow([]);

    // 3. Received
    addSectionHeader('RECEIVED');
    addTableHeader(['Type', 'Amount', '', '', 'From', '']);
    let receivedSubtotal = 0;
    for (const v of data.receivedVouchers) {
      sheet.addRow([v.type, formatCurrencyCell(v.amount), '', '', v.from || '-', '']);
      receivedSubtotal += v.amount;
    }
    const recSubRow = sheet.addRow(['RECEIVED SUBTOTAL', formatCurrencyCell(receivedSubtotal)]);
    recSubRow.font = { bold: true };
    recSubRow.eachCell((cell) => (cell.border = BORDER_THIN));
    sheet.addRow([]);

    // 4. Receivable
    addSectionHeader('RECEIVABLE');
    addTableHeader(['Description', 'Amount', '', '', '', '']);
    let receivablesSubtotal = 0;
    for (const r of data.receivables) {
      sheet.addRow([r.description, formatCurrencyCell(r.amount)]);
      receivablesSubtotal += r.amount;
    }
    const receivableSubRow = sheet.addRow(['RECEIVABLE SUBTOTAL', formatCurrencyCell(receivablesSubtotal)]);
    receivableSubRow.font = { bold: true };
    receivableSubRow.eachCell((cell) => (cell.border = BORDER_THIN));
    sheet.addRow([]);

    // 5. Issued
    addSectionHeader('ISSUED VOUCHERS');
    addTableHeader(['Voucher Type', 'Amount', '', '', 'From', 'To']);
    const issuedExchangeSubtotal = data.issuedVouchers.exchangeAndClaims?.reduce((acc: number, v: any) => acc + v.amount, 0) || 0;
    const issuedCreditSubtotal = data.issuedVouchers.creditVouchers?.reduce((acc: number, v: any) => acc + v.amount, 0) || 0;
    const issuedGiftSubtotal = data.issuedVouchers.giftVouchers?.reduce((acc: number, v: any) => acc + v.amount, 0) || 0;
    const issuedRefundSubtotal = data.issuedVouchers.refundVouchers?.reduce((acc: number, v: any) => acc + v.amount, 0) || 0;
    const totalIssuedSubtotal = issuedExchangeSubtotal + issuedGiftSubtotal + issuedRefundSubtotal;

    for (const v of data.issuedVouchers.exchangeAndClaims || []) {
      sheet.addRow([v.type, formatCurrencyCell(v.amount), '', '', v.from || '-', '']);
    }
    for (const v of data.issuedVouchers.creditVouchers || []) {
      sheet.addRow([v.type, formatCurrencyCell(v.amount), '', '', v.from || '-', v.to || '-']);
    }
    for (const v of data.issuedVouchers.giftVouchers || []) {
      sheet.addRow([v.type, formatCurrencyCell(v.amount), '', '', v.from || '-', v.to || '-']);
    }
    if (data.issuedVouchers.totalGiftVoucherDiscount > 0) {
      sheet.addRow(['Gift Vouchers Discount', formatCurrencyCell(data.issuedVouchers.totalGiftVoucherDiscount)]);
    }
    for (const v of data.issuedVouchers.refundVouchers || []) {
      sheet.addRow([v.type, formatCurrencyCell(v.amount), '', '', v.from || '-', '']);
    }

    const issuedSubRow = sheet.addRow(['TOTAL ISSUED', formatCurrencyCell(totalIssuedSubtotal)]);
    issuedSubRow.font = { bold: true };
    issuedSubRow.eachCell((cell) => (cell.border = BORDER_THIN));
    sheet.addRow([]);

    // 6. FBR Charges
    addSectionHeader('FBR POS SERVICE CHARGES');
    addTableHeader(['Type', 'Amount', '', '', '', '']);
    let fbrSubtotal = 0;
    for (const f of data.fbrCharges) {
      sheet.addRow([f.type, formatCurrencyCell(f.amount)]);
      fbrSubtotal += f.amount;
    }
    const fbrSubRow = sheet.addRow(['FBR SUBTOTAL', formatCurrencyCell(fbrSubtotal)]);
    fbrSubRow.font = { bold: true };
    fbrSubRow.eachCell((cell) => (cell.border = BORDER_THIN));
    sheet.addRow([]);

    // 7. Financials
    addSectionHeader('FINANCIALS');
    sheet.addRow(['Sale', formatCurrencyCell(data.financials.sale)]);
    sheet.addRow(['Sales Return', formatCurrencyCell(data.financials.salesReturn)]);
    const netSalesRow = sheet.addRow(['NET SALES', formatCurrencyCell(data.financials.netSales)]);
    netSalesRow.font = { bold: true };
    netSalesRow.eachCell((cell) => {
      cell.border = BORDER_THIN;
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE2E8F0' },
      };
    });
    sheet.addRow([]);

    // 8. Flow summaries
    addSectionHeader('FLOW SUMMARIES');
    sheet.addRow(['CASH FLOW DETAILS']);
    sheet.addRow(['  Net Cash Sales', formatCurrencyCell(data.cashBreakdown.sale)]);
    sheet.addRow(['  Cash Gift Vouchers', formatCurrencyCell(data.cashBreakdown.giftVouchers)]);
    sheet.addRow(['  Refund Vouchers', formatCurrencyCell(-data.cashBreakdown.refundVouchers)]);
    const totalCashRow = sheet.addRow(['  TOTAL CASH FLOW', formatCurrencyCell(data.cashBreakdown.total)]);
    totalCashRow.font = { bold: true };

    sheet.addRow([]);
    sheet.addRow(['CARD SALES DETAILS']);
    sheet.addRow(['  Net Card Sales', formatCurrencyCell(data.cardBreakdown.sale)]);
    sheet.addRow(['  Card Gift Vouchers', formatCurrencyCell(data.cardBreakdown.giftVouchers)]);
    const totalCardRow = sheet.addRow(['  TOTAL CARD PAYMENTS', formatCurrencyCell(data.cardBreakdown.total)]);
    totalCardRow.font = { bold: true };

    sheet.eachRow((row) => {
      const cellB = row.getCell(2);
      const cellD = row.getCell(4);
      if (typeof cellB.value === 'number') {
        cellB.numFmt = '#,##0.00';
      }
      if (typeof cellD.value === 'number') {
        cellD.numFmt = '#,##0.00';
      }
    });

    const buffer = await workbook.xlsx.writeBuffer();
    res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.header('Content-Disposition', `attachment; filename=reconciliation_${date}.xlsx`);
    res.send(buffer);
  }

  async queueDaywiseReconciliationExcel(userId: string, locationId: string, date: string): Promise<{ jobId: string }> {
    const jobId = uuidv4();
    const tenantId = this.prisma.getTenantId() ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';

    if (!this.exportQueue) {
      throw new Error('Export queue is not initialized');
    }

    await this.exportQueue.add(
      {
        jobId,
        userId,
        tenantId,
        tenantDbUrl,
        locationId,
        date,
      },
      {
        jobId,
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false,
        timeout: 30 * 60 * 1000,
      },
    );

    this.logger.log(`[ReconciliationExport] Queued job ${jobId} for user ${userId} on date ${date}`);
    return { jobId };
  }

  async getDaywiseReconciliationExportStatus(jobId: string): Promise<{ state: string; progress: number }> {
    if (!this.exportQueue) {
      throw new Error('Export queue is not initialized');
    }
    const job = await this.exportQueue.getJob(jobId);
    if (!job) throw new NotFoundException(`Export job ${jobId} not found`);
    const state = await job.getState();
    const progress = typeof job.progress() === 'number' ? (job.progress() as number) : 0;
    return { state, progress };
  }

  async streamDaywiseReconciliationExcelFile(jobId: string, res: any): Promise<void> {
    const filePath = path.join(process.cwd(), 'uploads', 'exports', `export-${jobId}.xlsx`);

    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('Export file not found. It may have expired or the job is still running.');
    }

    const stat = fs.statSync(filePath);
    const filename = `reconciliation-${jobId}.xlsx`;

    const stream = fs.createReadStream(filePath);
    stream.on('close', () => {
      fs.unlink(filePath, (err) => {
        if (err) this.logger.warn(`Could not delete export file: ${err.message}`);
        else     this.logger.log(`[ReconciliationExport] Cleaned up ${filePath}`);
      });
    });
    stream.on('error', (err) => {
      this.logger.error(`[ReconciliationExport] Stream error: ${err.message}`);
    });

    res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.header('Content-Disposition', `attachment; filename="${filename}"`);
    res.header('Content-Length', stat.size);
    res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(stream);
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
      const sessionData = await this.prisma.posSession.findUnique({
        where: { id: sessionId },
        include: { pos: { include: { location: true } } },
      });
      if (!sessionData) return;
      const session = sessionData;

      const locationShortCode = sessionData?.pos?.location?.shortCode || sessionData?.pos?.location?.code || 'LOC';

      // Clean up all existing pending JVs for this session first (both old format and new format)
      const oldSessionPrefix = `RS RV-${sessionId.substring(0, 8).toUpperCase()}`;
      const existingJvs = await this.prisma.journalVoucher.findMany({
        where: {
          OR: [
            { jvNo: { startsWith: oldSessionPrefix } },
            { jvNo: oldSessionPrefix }
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

      // Clean up all existing pending RVs for this session first (both old format and new format)
      const newSessionPrefix = `RS-RV-${locationShortCode}-`;
      const existingRvs = await this.prisma.receiptVoucher.findMany({
        where: {
          OR: [
            { rvNo: { startsWith: oldSessionPrefix } },
            { rvNo: oldSessionPrefix },
            { rvNo: { startsWith: newSessionPrefix } },
            { rvNo: newSessionPrefix }
          ]
        }
      });

      for (const existingRv of existingRvs) {
        if (existingRv.status === 'pending') {
          await this.prisma.$transaction(async (tx) => {
            await tx.receiptVoucherDetail.deleteMany({
              where: { receiptVoucherId: existingRv.id },
            });
            await tx.receiptVoucher.delete({
              where: { id: existingRv.id },
            });
          });
          this.logger.log(`Cleaned up existing pending RV: ${existingRv.rvNo}`);
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
        const cashGl = sessionData?.pos?.location?.cashGLCode || '31090001';
        if (cashGl) {
          // Cash Sales entry
          const netCashSale = metrics.cashBreakdown.sale - metrics.cashBreakdown.refundVouchers;
          await addLine(
            cashGl,
            locationCode,
            netCashSale,
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
          } else if (v.type === 'Vouchers') {
            const voucher = await this.prisma.voucher.findFirst({
              where: { code: v.from },
            });
            if (voucher && voucher.voucherType === 'REFUND') {
              const refundCode = v.from.startsWith('RF#') ? v.from : `RF#${v.from}`;
              await addLine(
                '12070015',
                locationCode,
                v.amount,
                0,
                `Refund Voucher Collected | ${refundCode} | ${jvDateStr}`,
              );
            }
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

        // Gift Voucher Discount
        const giftVoucherDiscountAmt = metrics.issuedVouchers.totalGiftVoucherDiscount || 0;
        await addLine(
          '80180012',
          locationCode,
          giftVoucherDiscountAmt,
          0,
          `Gift Voucher Discount | ${jvDateStr}`,
        );
        for (const rv of metrics.issuedVouchers.refundVouchers) {
          const refundCode = rv.from.startsWith('RF#') ? rv.from : `RF#${rv.from}`;
          await addLine(
            '12070015',
            locationCode,
            0,
            rv.amount,
            `Refund Voucher Issued | ${refundCode} | ${jvDateStr}`,
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

        const unusedBalanceVouchersAmt = metrics.issuedVouchers.unusedBalanceVouchersTotal || 0;
        const cashGiftVouchersAmt = metrics.cashBreakdown.giftVouchers;
        const cardGiftVouchersAmt = metrics.cardBreakdown.giftVouchers;
        const receivablesAmt = metrics.receivables.reduce(
          (s, r) => s + r.amount,
          0,
        );

        // AC: 12070002 -> Transfer Current A/c Cash
        // Credit = Total Received + Receivables - Unused Balance Vouchers - Cash Gift Vouchers - On Cash FBR
        const transferCash =
          totalReceived +
          receivablesAmt -
          unusedBalanceVouchersAmt -
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
            `No entries to generate RV for session ${sessionId} on ${dateStr}`,
          );
          continue;
        }

        // Generate RV
        const rvNo = `RS-RV-${locationShortCode}-${dateStr}`;

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
            narration: `[AUTO-BALANCING LINE] To balance RV. Total Debit was ${totalDebit.toFixed(2)}, Total Credit was ${totalCredit.toFixed(2)}`,
          });
          description += `\n\nATTENTION: Voucher was unbalanced by ${diff.toFixed(2)}. An auto-balancing line was added. Please review and correct.`;

          // Re-calculate totals
          totalDebit = 0;
          totalCredit = 0;
          details.forEach((d) => {
            totalDebit += d.debit;
            totalCredit += d.credit;
          });
        }

        if (totalDebit === 0) {
          this.logger.log(
            `Total debit is 0 for session ${sessionId} on ${dateStr}, skipping Receipt Voucher generation.`,
          );
          continue;
        }

        // Check if RV already exists (it would only exist if it's approved and was not deleted)
        const approvedRv = await this.prisma.receiptVoucher.findUnique({
          where: { rvNo },
        });

        if (approvedRv) {
          this.logger.log(`Receipt Voucher ${rvNo} already exists and is not pending. Skipping.`);
          continue;
        }

        const firstDebitLine = details.find((d) => d.debit > 0);
        const debitAccountId = firstDebitLine
          ? firstDebitLine.accountId
          : (await this.prisma.chartOfAccount.findFirst())?.id || 'MISSING';

        await this.receiptVoucherService.create({
          type: 'cash',
          rvNo,
          rvDate: date,
          debitAccountId,
          debitAmount: totalDebit,
          description,
          status: 'pending',
          details: details.map((d) => ({
            accountId: d.accountId,
            tagAccountId: d.tagAccountId || undefined,
            debit: d.debit,
            credit: d.credit,
            narration: d.narration,
          })),
        });

        this.logger.log(`Generated RV ${rvNo} for session ${sessionId}`);
      }
    } catch (error) {
      this.logger.error(
        `Error generating Reconciliation RV for session ${sessionId}:`,
        error,
      );
    }
  }
}
