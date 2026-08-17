import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FinanceAccountConfigService } from '../../finance/finance-account-config/finance-account-config.service';
import { AccountRoleKey } from '../../finance/finance-account-config/dto/finance-account-config.dto';
import { generateNextJvNumber, generateNextFolioNumber } from '../../common/utils/voucher-number.util';

import { ActivityLogsService } from '../../activity-logs/activity-logs.service';
import { runInBackground } from '../../common/utils/run-in-background.util';
@Injectable()
export class SalesInvoiceService {
  constructor(
    private prisma: PrismaService,
    private financeConfig: FinanceAccountConfigService,
    private activityLogs: ActivityLogsService,
  ) {}

  async findAll(search?: string, status?: string) {
    const where: any = {};

    if (search) {
      where.OR = [
        { invoiceNo: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
        { salesOrder: { orderNo: { contains: search, mode: 'insensitive' } } },
      ];
    }

    if (status && status !== 'all') {
      where.status = status.toUpperCase();
    }

    const invoices = await this.prisma.eRPSalesInvoice.findMany({
      where,
      include: {
        customer: true,
        warehouse: true,
        salesOrder: true,
        deliveryChallan: true,
        items: {
          include: {
            item: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return { status: true, data: invoices };
  }

  async findOne(id: string) {
    const salesInvoice = await this.prisma.eRPSalesInvoice.findUnique({
      where: { id },
      include: {
        customer: true,
        warehouse: true,
        salesOrder: true,
        deliveryChallan: true,
        items: {
          include: {
            item: {
              include: {
                brand: true,
                category: true,
                subCategory: true,
                size: true,
                color: true,
                gender: true,
                division: true,
              },
            },
          },
        },
      },
    });

    if (!salesInvoice) {
      throw new NotFoundException('Sales invoice not found');
    }

    return { status: true, data: salesInvoice };
  }

  async update(id: string, updateData: any, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const salesInvoiceResponse = await this.findOne(id);
      const salesInvoice = salesInvoiceResponse.data;

      if (salesInvoice.status === 'PAID') {
        throw new BadRequestException('Cannot update paid invoice');
      }

      const updatedInvoice = await this.prisma.eRPSalesInvoice.update({
        where: { id },
        data: updateData,
        include: {
          customer: true,
          warehouse: true,
          salesOrder: true,
          deliveryChallan: true,
          items: {
            include: {
              item: true,
            },
          },
        },
      });

      runInBackground(
        'Update Sales Invoice',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'sales-invoice',
          entity: 'ERPSalesInvoice',
          entityId: id,
          description: `Updated sales invoice ${updatedInvoice.invoiceNo}`,
          oldValues: JSON.stringify(salesInvoice),
          newValues: JSON.stringify(updateData),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return { status: true, data: updatedInvoice };
    } catch (error: any) {
      runInBackground(
        'Update Sales Invoice (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'sales-invoice',
          entity: 'ERPSalesInvoice',
          entityId: id,
          description: `Failed to update sales invoice`,
          errorMessage: error?.message,
          newValues: JSON.stringify(updateData),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
  }

  async post(id: string, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const salesInvoiceResponse = await this.findOne(id);
      const salesInvoice = salesInvoiceResponse.data;

      if (salesInvoice.status !== 'PENDING') {
        throw new BadRequestException('Only draft invoices can be posted');
      }

      const result = await this.prisma.$transaction(async (tx) => {
        const updatedInvoice = await tx.eRPSalesInvoice.update({
          where: { id },
          data: { status: 'POSTED' },
          include: {
            customer: true,
            warehouse: true,
            salesOrder: true,
            deliveryChallan: true,
            items: {
              include: {
                item: {
                  include: {
                    brand: true,
                  },
                },
              },
            },
          },
        });

        const jvDate = new Date();
        const sequentialJvNo = await generateNextJvNumber(tx, jvDate);
        const sequentialFolio = await generateNextFolioNumber(tx, jvDate);

        // Helper to round to 2 decimal places
        const roundToTwo = (num: number) => Math.round((num + Number.EPSILON) * 100) / 100;

        // Month abbreviation label for narration: e.g. "JUL'26"
        const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
        const invoiceMonth = monthNames[jvDate.getMonth()];
        const invoiceYearTwoDigit = jvDate.getFullYear().toString().slice(-2);
        const periodStr = `M/O ${invoiceMonth}'${invoiceYearTwoDigit}, CO`;

        const detailsData: any[] = [];

        // Helper to resolve parent COA and its tag child
        const getAccountWithTag = async (parentCode: string, tagCode: string = 'C00001') => {
          const parent = await tx.chartOfAccount.findFirst({
            where: { code: parentCode },
          });
          if (!parent) {
            throw new BadRequestException(`Chart of Account with code "${parentCode}" not found.`);
          }
          const tag = await tx.chartOfAccount.findFirst({
            where: {
              parentId: parent.id,
              code: tagCode,
            },
          });
          return { parent, tag };
        };

        // 1. Line: 12070004 CURRENT ACCOUNT-WHOLE SALES (Debit: Grand Total)
        const curAcc = await getAccountWithTag('12070004', 'C00001');
        const grandTotal = roundToTwo(Number(updatedInvoice.grandTotal));
        detailsData.push({
          accountId: curAcc.parent.id,
          tagAccountId: curAcc.tag?.id || null,
          debit: grandTotal,
          credit: 0,
          narration: `REC WHOLE SALES ${periodStr}`,
          refBillNo: updatedInvoice.invoiceNo,
          refBillNo2: updatedInvoice.deliveryChallan?.challanNo || '',
          taxType: 'Taxable',
        });

        // 2. Line: 40010013 SALES TAX-OUTPUT WHOLE SALES (Debit: Tax Amount)
        const taxAmount = roundToTwo(Number(updatedInvoice.taxAmount));
        if (taxAmount > 0) {
          const taxAcc = await getAccountWithTag('40010013', 'C00001');
          detailsData.push({
            accountId: taxAcc.parent.id,
            tagAccountId: taxAcc.tag?.id || null,
            debit: taxAmount,
            credit: 0,
            narration: `REC SALES TAX-OUTPUT WHOLE SALES ${periodStr}`,
            refBillNo: updatedInvoice.invoiceNo,
            refBillNo2: updatedInvoice.deliveryChallan?.challanNo || '',
            taxType: 'Taxable',
          });
        }

        // Aggregate by tax rate across items matching the Sales Tax Invoice breakdown:
        // Value Excl Tax (WOST) = Round( (salePrice / (1 + rate/100)) * qty )
        // Discount = Round( item.discount )
        const taxRateGroups: { [taxRate: number]: { grossValueExclTax: number; discountAmount: number } } = {};
        for (const it of updatedInvoice.items) {
          const rate = Number(it.item?.taxRate1 || 18);
          if (!taxRateGroups[rate]) {
            taxRateGroups[rate] = { grossValueExclTax: 0, discountAmount: 0 };
          }
          const qty = Number(it.quantity || 0);
          const salePrice = Number(it.salePrice || 0);
          const disc = roundToTwo(Number(it.discount || 0));

          const wostUnitPrice = salePrice / (1 + rate / 100);
          const wostTotal = roundToTwo(wostUnitPrice * qty);

          taxRateGroups[rate].grossValueExclTax += wostTotal;
          taxRateGroups[rate].discountAmount += disc;
        }

        // 3. Lines: Discount Debits grouped by Tax Rate (40010005 for 18%, 40010006 for 25%)
        for (const [rateStr, group] of Object.entries(taxRateGroups)) {
          const rate = Number(rateStr);
          const discVal = roundToTwo(group.discountAmount);
          if (discVal > 0) {
            const discCode = rate === 25 ? '40010006' : '40010005';
            const discAcc = await getAccountWithTag(discCode, 'C00001');
            detailsData.push({
              accountId: discAcc.parent.id,
              tagAccountId: discAcc.tag?.id || null,
              debit: discVal,
              credit: 0,
              narration: `REC WHOLE SALES DISCOUNT ${rate}% ${periodStr}`,
              refBillNo: updatedInvoice.invoiceNo,
              refBillNo2: updatedInvoice.deliveryChallan?.challanNo || '',
              taxType: 'Taxable',
            });
          }
        }

        // 4. Lines: Sales Credits grouped by Tax Rate (40010002 for 18%, 40010003 for 25%)
        for (const [rateStr, group] of Object.entries(taxRateGroups)) {
          const rate = Number(rateStr);
          const grossVal = roundToTwo(group.grossValueExclTax);
          if (grossVal > 0) {
            const salesCode = rate === 25 ? '40010003' : '40010002';
            const salesAcc = await getAccountWithTag(salesCode, 'C00001');
            detailsData.push({
              accountId: salesAcc.parent.id,
              tagAccountId: salesAcc.tag?.id || null,
              debit: 0,
              credit: grossVal,
              narration: `REC WHOLE SALES ${rate}% SALES TAX ${periodStr}`,
              refBillNo: updatedInvoice.invoiceNo,
              refBillNo2: updatedInvoice.deliveryChallan?.challanNo || '',
              taxType: 'Taxable',
            });
          }
        }

        // 5. Line: 31070001 SALES TAX CURRENT ACCOUNT (Credit: Tax Amount)
        if (taxAmount > 0) {
          const stCurrentAcc = await getAccountWithTag('31070001', 'C00001');
          detailsData.push({
            accountId: stCurrentAcc.parent.id,
            tagAccountId: stCurrentAcc.tag?.id || null,
            debit: 0,
            credit: taxAmount,
            narration: `REC SALES TAX OUTPUT ${periodStr}`,
            refBillNo: updatedInvoice.invoiceNo,
            refBillNo2: updatedInvoice.deliveryChallan?.challanNo || '',
            taxType: 'Taxable',
          });
        }

        // Balance Check & Adjustment (rounding difference)
        let totalDebitSum = 0;
        let totalCreditSum = 0;
        for (const line of detailsData) {
          totalDebitSum += line.debit;
          totalCreditSum += line.credit;
        }
        const diff = roundToTwo(totalCreditSum - totalDebitSum);
        if (Math.abs(diff) > 0 && detailsData.length > 0) {
          detailsData[0].debit = roundToTwo(detailsData[0].debit + diff);
        }

        // Create the draft Journal Voucher
        await tx.journalVoucher.create({
          data: {
            jvNo: sequentialJvNo,
            folio: sequentialFolio,
            jvDate: jvDate,
            description: `Auto Generated JV from ERP Sales Invoice ${updatedInvoice.invoiceNo}`,
            status: 'pending_check', // Pending Check (shows under all / pending_check in JV list)
            details: {
              create: detailsData.map((d) => ({
                accountId: d.accountId,
                tagAccountId: d.tagAccountId,
                debit: d.debit,
                credit: d.credit,
                narration: d.narration,
                refBillNo: d.refBillNo,
                refBillNo2: d.refBillNo2,
                taxType: d.taxType,
              })),
            },
          },
        });

        // Update customer balance
        if (updatedInvoice.customerId) {
          const customer = await tx.customer.findUnique({
            where: { id: updatedInvoice.customerId },
          });
          if (customer) {
            await tx.customer.update({
              where: { id: updatedInvoice.customerId },
              data: {
                balance: Number(customer.balance || 0) + grandTotal,
              },
            });
          }
        }

        return updatedInvoice;
      });

      runInBackground(
        'Post Sales Invoice',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'sales-invoice',
          entity: 'ERPSalesInvoice',
          entityId: id,
          description: `Posted sales invoice ${result.invoiceNo}`,
          oldValues: JSON.stringify(salesInvoice),
          newValues: JSON.stringify({ status: 'POSTED' }),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return { status: true, data: result };
    } catch (error: any) {
      runInBackground(
        'Post Sales Invoice (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'sales-invoice',
          entity: 'ERPSalesInvoice',
          entityId: id,
          description: `Failed to post sales invoice`,
          errorMessage: error?.message,
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
  }

  async cancel(id: string, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const salesInvoiceResponse = await this.findOne(id);
      const salesInvoice = salesInvoiceResponse.data;

      if (salesInvoice.status === 'CANCELLED') {
        throw new BadRequestException('Invoice is already cancelled');
      }

      if (salesInvoice.status === 'PAID') {
        throw new BadRequestException('Cannot cancel paid invoice');
      }

      const updatedInvoice = await this.prisma.eRPSalesInvoice.update({
        where: { id },
        data: { status: 'CANCELLED' },
        include: {
          customer: true,
          warehouse: true,
          salesOrder: true,
          deliveryChallan: true,
          items: {
            include: {
              item: true,
            },
          },
        },
      });

      runInBackground(
        'Cancel Sales Invoice',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'sales-invoice',
          entity: 'ERPSalesInvoice',
          entityId: id,
          description: `Cancelled sales invoice ${updatedInvoice.invoiceNo}`,
          oldValues: JSON.stringify(salesInvoice),
          newValues: JSON.stringify({ status: 'CANCELLED' }),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return { status: true, data: updatedInvoice };
    } catch (error: any) {
      runInBackground(
        'Cancel Sales Invoice (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'sales-invoice',
          entity: 'ERPSalesInvoice',
          entityId: id,
          description: `Failed to cancel sales invoice`,
          errorMessage: error?.message,
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
  }
}