import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../database/prisma.service';
import { PosSessionService } from './pos-session.service';
import { NotificationsService } from '../notifications/notifications.service';

export interface ReconciliationExportJobData {
  jobId: string;
  userId: string;
  tenantId: string;
  tenantDbUrl: string;
  locationId: string;
  date: string;
}

@Processor('reconciliation-export')
export class ReconciliationExportProcessor {
  private readonly logger = new Logger(ReconciliationExportProcessor.name);

  constructor(
    private readonly notificationsService: NotificationsService,
  ) {}

  @Process()
  async handleExport(job: Job<ReconciliationExportJobData>): Promise<void> {
    const { jobId, userId, tenantId, tenantDbUrl, locationId, date } = job.data;

    this.logger.log(`[ReconciliationExport ${jobId}] Starting background Excel export for user ${userId}`);

    const prisma = new PrismaService({ tenantId, tenantDbUrl } as any);
    const sessionService = new PosSessionService(prisma, null as any, null as any, null as any);

    const exportDir = path.join(process.cwd(), 'uploads', 'exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const filePath = path.join(exportDir, `export-${jobId}.xlsx`);

    try {
      await job.progress(10);
      const data = await sessionService.getDaywiseReconciliation(locationId, date);
      await job.progress(30);

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

      await job.progress(50);

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

      await job.progress(70);

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

      await job.progress(85);

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

      // Write to disk
      await workbook.xlsx.writeFile(filePath);
      await job.progress(100);

      this.logger.log(`[ReconciliationExport ${jobId}] Finished Excel export successfully`);

      // Notification
      await this.notificationsService.create({
        userId,
        title: 'Reconciliation Export Ready',
        message: `Your Reconciliation Excel export for ${date} is ready to download.`,
        category: 'export',
        priority: 'high',
        actionType: 'reconciliation-export.ready',
        actionPayload: { jobId, date },
        entityType: 'reconciliation-export',
        entityId: jobId,
        channels: ['inApp'],
      });

    } catch (error: any) {
      this.logger.error(`[ReconciliationExport ${jobId}] FAILED: ${error.message}`, error.stack);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

      await this.notificationsService.create({
        userId,
        title: 'Reconciliation Export Failed',
        message: `Export could not be completed: ${error.message}`,
        category: 'export',
        priority: 'urgent',
        channels: ['inApp'],
      });
    } finally {
      await prisma.$disconnect();
    }
  }
}
