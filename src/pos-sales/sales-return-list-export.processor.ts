import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import * as fs from 'fs';
import * as path from 'path';
import * as puppeteer from 'puppeteer';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaMasterService } from '../database/prisma-master.service';
import { ExportHistoryService } from '../warehouse/export-history/export-history.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  SalesReturnListExportService,
  ReturnSubType,
} from './sales-return-list-export.service';

interface SalesReturnListExportJobData {
  jobId: string;
  userId: string;
  tenantId: string;
  tenantDbUrl: string;
  locationId?: string;
  locationIds?: string[];
  startDate?: string;
  endDate?: string;
  cashierUserId?: string;
  format: 'xlsx' | 'pdf';
  search?: string;
  subType?: ReturnSubType;
  refundMode?: string;
  exportType?: 'flat' | 'hierarchical';
}

export interface SalesReturnListPreviewJobData {
  jobId: string;
  userId: string;
  tenantId: string;
  tenantDbUrl: string;
  locationId?: string;
  startDate?: string;
  endDate?: string;
  cashierUserId?: string;
  reportType?: 'merged' | 'separate';
  search?: string;
  subType?: ReturnSubType;
  refundMode?: string;
  fiscalYear?: string;
  year?: number | string;
}

const FLAT_COLUMNS = [
  { header: 'Outlet / Location', key: 'locationName', width: 22, align: 'left' },
  { header: 'Return #', key: 'returnNumber', width: 18, align: 'left' },
  { header: 'Original Invoice #', key: 'originalOrderNumber', width: 18, align: 'left' },
  { header: 'Sub Type', key: 'subTypeLabel', width: 16, align: 'center' },
  { header: 'Return Date', key: 'returnDate', width: 20, align: 'center' },
  { header: 'Cashier', key: 'cashierName', width: 16, align: 'left' },
  { header: 'Customer', key: 'customerName', width: 18, align: 'left' },
  { header: 'Phone', key: 'customerPhone', width: 14, align: 'left' },
  { header: 'CNIC', key: 'customerCnic', width: 16, align: 'left' },
  { header: 'Customer Code', key: 'customerCode', width: 14, align: 'left' },
  { header: 'Refund Mode', key: 'refundMode', width: 14, align: 'center' },
  { header: 'Return Reason', key: 'returnReason', width: 24, align: 'left' },
  { header: 'Voucher Issued Code', key: 'voucherCode', width: 20, align: 'left' },
  { header: 'Voucher Issued Amount', key: 'voucherAmount', width: 20, align: 'right', numFmt: '#,##0.00' },
  { header: 'SKU', key: 'sku', width: 16, align: 'left' },
  { header: 'Barcode', key: 'barCode', width: 16, align: 'left' },
  { header: 'Description', key: 'description', width: 26, align: 'left' },
  { header: 'Size', key: 'sizeName', width: 10, align: 'center' },
  { header: 'Color', key: 'colorName', width: 12, align: 'center' },
  { header: 'Return Quantity', key: 'quantity', width: 12, align: 'right', numFmt: '#,##0' },
  { header: 'Unit Price', key: 'unitPrice', width: 12, align: 'right', numFmt: '#,##0.00' },
  { header: 'Unit Price WOST', key: 'priceWost', width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Value Excl.', key: 'valueExcl', width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Discount %', key: 'discountPercent', width: 11, align: 'right', numFmt: '#,##0.00' },
  { header: 'Discount', key: 'discountAmount', width: 12, align: 'right', numFmt: '#,##0.00' },
  { header: 'Discount WOST', key: 'discountAmountWost', width: 13, align: 'right', numFmt: '#,##0.00' },
  { header: 'Amount After Discount', key: 'amountAfterDiscount', width: 18, align: 'right', numFmt: '#,##0.00' },
  { header: 'Sales Tax', key: 'taxAmount', width: 12, align: 'right', numFmt: '#,##0.00' },
  { header: 'Value Incl. (Net Return)', key: 'lineTotal', width: 18, align: 'right', numFmt: '#,##0.00' },
  { header: 'Cash Refund', key: 'cashRefund', width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Card Refund', key: 'cardRefund', width: 14, align: 'right', numFmt: '#,##0.00' },
];

const COLUMNS = [
  { header: 'Return #', key: 'returnNumber', width: 18, align: 'left' },
  { header: 'Original Invoice #', key: 'originalOrderNumber', width: 18, align: 'left' },
  { header: 'Sub Type', key: 'subTypeLabel', width: 16, align: 'center' },
  { header: 'Return Date', key: 'date', width: 20, align: 'center' },
  { header: 'Location', key: 'location', width: 18, align: 'left' },
  { header: 'Cashier', key: 'cashier', width: 16, align: 'left' },
  { header: 'Customer', key: 'customer', width: 18, align: 'left' },
  { header: 'Phone', key: 'phone', width: 14, align: 'left' },
  { header: 'CNIC', key: 'cnic', width: 16, align: 'left' },
  { header: 'Customer Code', key: 'customerCode', width: 14, align: 'left' },
  { header: 'Refund Mode', key: 'refundMode', width: 14, align: 'center' },
  { header: 'Return Reason', key: 'reason', width: 24, align: 'left' },
  { header: 'Voucher Issued Code', key: 'voucherCode', width: 20, align: 'left' },
  { header: 'Voucher Issued Amount', key: 'voucherAmount', width: 20, align: 'right', numFmt: '#,##0.00' },
  { header: 'Return Quantity', key: 'quantity', width: 12, align: 'right', numFmt: '#,##0' },
  { header: 'Unit Price WOST (Avg)', key: 'unitPriceWost', width: 18, align: 'right', numFmt: '#,##0.00' },
  { header: 'Value Excl.', key: 'valueExcl', width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Discount Total', key: 'discountTotal', width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Discount WOST', key: 'discountWost', width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Amount After Discount', key: 'amountAfterDiscount', width: 18, align: 'right', numFmt: '#,##0.00' },
  { header: 'Sales Tax', key: 'salesTax', width: 12, align: 'right', numFmt: '#,##0.00' },
  { header: 'Value Incl. (Net Return)', key: 'netTotal', width: 18, align: 'right', numFmt: '#,##0.00' },
  { header: 'Cash Refund', key: 'cashRefund', width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Exchange Voucher Issued', key: 'exchangeVoucher', width: 18, align: 'right', numFmt: '#,##0.00' },
  { header: 'Credit Voucher Issued', key: 'creditVoucher', width: 18, align: 'right', numFmt: '#,##0.00' },
  { header: 'Claim Voucher Issued', key: 'claimVoucher', width: 18, align: 'right', numFmt: '#,##0.00' },
];

@Processor('sales-return-list-export')
export class SalesReturnListExportProcessor {
  private readonly logger = new Logger(SalesReturnListExportProcessor.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly exportHistoryService: ExportHistoryService,
    private readonly salesReturnListExportService: SalesReturnListExportService,
  ) {}

  @Process('generate-sales-return-list-preview')
  async handleGeneratePreview(job: Job<SalesReturnListPreviewJobData>): Promise<void> {
    const {
      jobId,
      tenantId,
      tenantDbUrl,
      locationId,
      startDate,
      endDate,
      cashierUserId,
      reportType = 'merged',
      search,
      subType,
      refundMode,
      fiscalYear,
      year,
    } = job.data;

    const prisma =
      tenantId && tenantDbUrl
        ? PrismaService.getTenantClient(tenantId, tenantDbUrl)
        : new PrismaService({ tenantId, tenantDbUrl } as any);

    try {
      this.logger.log(`[SalesReturnListPreview ${jobId}] Starting background preview computation`);
      await job.progress({ percent: 10, message: 'Queueing sales return list computation...' });

      const onProgress = async (percent: number, message: string) => {
        if (this.salesReturnListExportService.isJobCancelled(jobId)) {
          throw new Error('JOB_CANCELLED');
        }
        await job.progress({ percent: Math.min(95, Math.max(10, percent)), message });
      };

      const result = await this.salesReturnListExportService.generateSalesReturnListReportDataInternal(
        prisma as any,
        {
          locationId,
          startDate,
          endDate,
          cashierUserId,
          reportType,
          search,
          subType,
          refundMode,
          fiscalYear,
          year,
          previewJobId: jobId,
          isAborted: () => this.salesReturnListExportService.isJobCancelled(jobId),
          onProgress,
        },
      );

      await this.salesReturnListExportService.saveReportPreviewResult(jobId, result);
      await job.progress({ percent: 100, message: 'Sales return list calculation complete.' });
      this.logger.log(`[SalesReturnListPreview] Successfully completed and saved preview job ${jobId}`);
    } catch (err: any) {
      if (err.message === 'JOB_CANCELLED') {
        this.logger.log(`[SalesReturnListPreview ${jobId}] Job was superseded or cancelled.`);
        return;
      }
      this.logger.error(`[SalesReturnListPreview ${jobId}] Exception: ${err.message}`, err.stack);
      throw err;
    }
  }

  @Process('generate-sales-return-list-export')
  async handleExport(job: Job<SalesReturnListExportJobData>): Promise<void> {
    const {
      jobId,
      userId,
      tenantId,
      tenantDbUrl,
      locationId,
      startDate,
      endDate,
      cashierUserId,
      format,
      search,
      subType,
      refundMode,
      exportType = 'hierarchical',
    } = job.data;

    const prisma =
      tenantId && tenantDbUrl
        ? PrismaService.getTenantClient(tenantId, tenantDbUrl)
        : new PrismaService({ tenantId, tenantDbUrl } as any);

    const exportDir = path.join(process.cwd(), 'uploads', 'exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const ext = format === 'pdf' ? 'pdf' : 'xlsx';
    const filePath = path.join(exportDir, `export-${jobId}.${ext}`);

    try {
      await job.progress({ percent: 15, message: 'Loading return records for export...' });

      const result = await this.salesReturnListExportService.generateSalesReturnListReportDataInternal(
        prisma as any,
        {
          locationId,
          locationIds: job.data.locationIds,
          startDate,
          endDate,
          cashierUserId,
          search,
          subType,
          refundMode,
          exportType,
          onProgress: async (p, m) => {
            await job.progress({ percent: Math.min(85, p), message: m });
          },
        },
      );

      if (format === 'xlsx') {
        const isFlat = exportType === 'flat';
        const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
          filename: filePath,
          useStyles: true,
          useSharedStrings: false,
        });

        const activeCols = isFlat ? FLAT_COLUMNS : COLUMNS;
        const ws = workbook.addWorksheet(isFlat ? 'Flat Return Items' : 'Sales Returns');
        ws.columns = activeCols.map((c) => ({ key: c.key, width: c.width }));

        // Header Row
        const headerRow = ws.getRow(1);
        activeCols.forEach((col, idx) => {
          const cell = headerRow.getCell(idx + 1);
          cell.value = col.header;
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
          cell.alignment = {
            horizontal: col.align === 'right' ? 'right' : col.align === 'center' ? 'center' : 'left',
            vertical: 'middle',
          };
        });
        headerRow.height = 24;
        headerRow.commit();

        for (const ret of result.returns) {
          if (isFlat) {
            for (const item of ret.items) {
              const row = ws.addRow({
                locationName: ret.locationName || '-',
                returnNumber: ret.returnNumber,
                originalOrderNumber: ret.originalOrderNumber || '-',
                subTypeLabel: ret.subTypeLabel || ret.subType,
                returnDate: ret.createdAt ? new Date(ret.createdAt).toISOString().replace('T', ' ').slice(0, 19) : '-',
                cashierName: ret.cashierName || '-',
                customerName: ret.customerName || 'Walk-in',
                customerPhone: ret.customerPhone || '-',
                customerCnic: ret.customerCnic || '-',
                customerCode: ret.customerCode || '-',
                refundMode: ret.refundMode || 'VOUCHER',
                returnReason: item.returnReason || ret.reason || '-',
                voucherCode: ret.voucherCode || '-',
                voucherAmount: ret.voucherAmount || 0,
                sku: item.sku || '-',
                barCode: item.barCode || '-',
                description: item.description || '-',
                sizeName: item.sizeName || '-',
                colorName: item.colorName || '-',
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                priceWost: item.priceWost,
                valueExcl: item.valueExcl,
                discountPercent: item.discountPercent || 0,
                discountAmount: item.discountAmount,
                discountAmountWost: item.discountAmountWost,
                amountAfterDiscount: item.amountAfterDiscount,
                taxAmount: item.taxAmount,
                lineTotal: item.lineTotal,
                cashRefund: ret.totals.cashRefund,
                cardRefund: ret.totals.cardRefund,
              });
              row.height = 18;
              row.commit();
            }
          } else {
            const row = ws.addRow({
              returnNumber: ret.returnNumber,
              originalOrderNumber: ret.originalOrderNumber || '-',
              subTypeLabel: ret.subTypeLabel || ret.subType,
              date: ret.createdAt ? new Date(ret.createdAt).toISOString().replace('T', ' ').slice(0, 19) : '-',
              location: ret.locationName || '-',
              cashier: ret.cashierName || '-',
              customer: ret.customerName || 'Walk-in',
              phone: ret.customerPhone || '-',
              cnic: ret.customerCnic || '-',
              customerCode: ret.customerCode || '-',
              refundMode: ret.refundMode || 'VOUCHER',
              reason: ret.reason || '-',
              voucherCode: ret.voucherCode || '-',
              voucherAmount: ret.voucherAmount || 0,
              quantity: ret.totals.totalItems,
              unitPriceWost: ret.totals.totalItems > 0 ? Number((ret.totals.wostAmount / ret.totals.totalItems).toFixed(2)) : 0,
              valueExcl: ret.totals.wostAmount,
              discountTotal: ret.totals.discountAmount,
              discountWost: ret.totals.discountWostAmount,
              amountAfterDiscount: ret.totals.amountAfterDiscount,
              salesTax: ret.totals.taxAmount,
              netTotal: ret.totals.netAmount,
              cashRefund: ret.totals.cashRefund,
              exchangeVoucher: ret.totals.exchangeVoucherAmount,
              creditVoucher: ret.totals.creditVoucherAmount,
              claimVoucher: ret.totals.claimVoucherAmount,
            });
            row.height = 18;
            row.commit();
          }
        }

        // Totals Footer Row
        const gt = result.grandTotals;
        const totalRowData = isFlat
          ? {
              locationName: 'GRAND TOTAL',
              quantity: gt.totalItems,
              unitPrice: '',
              priceWost: '',
              valueExcl: gt.wostAmount,
              discountPercent: '',
              discountAmount: gt.discountAmount,
              discountAmountWost: gt.discountWostAmount,
              amountAfterDiscount: gt.amountAfterDiscount,
              taxAmount: gt.taxAmount,
              lineTotal: gt.netAmount,
              cashRefund: gt.cashRefund,
              cardRefund: gt.cardRefund,
            }
          : {
              returnNumber: 'GRAND TOTAL',
              originalOrderNumber: `${gt.returnCount.toLocaleString()} Returns`,
              subTypeLabel: '',
              date: '',
              location: '',
              cashier: '',
              customer: `${gt.totalItems.toLocaleString()} Items`,
              phone: '',
              cnic: '',
              customerCode: '',
              refundMode: '',
              reason: '',
              voucherCode: '',
              voucherAmount: gt.voucherIssuedAmount,
              quantity: gt.totalItems,
              unitPriceWost: gt.totalItems > 0 ? Number((gt.wostAmount / gt.totalItems).toFixed(2)) : 0,
              valueExcl: gt.wostAmount,
              discountTotal: gt.discountAmount,
              discountWost: gt.discountWostAmount,
              amountAfterDiscount: gt.amountAfterDiscount,
              salesTax: gt.taxAmount,
              netTotal: gt.netAmount,
              cashRefund: gt.cashRefund,
              exchangeVoucher: gt.exchangeVoucherAmount,
              creditVoucher: gt.creditVoucherAmount,
              claimVoucher: gt.claimVoucherAmount,
            };

        const totalRow = ws.addRow(totalRowData);
        totalRow.height = 24;
        totalRow.font = { bold: true };
        totalRow.commit();

        await workbook.commit();
      }

      await job.progress(95);

      const mimeType =
        format === 'pdf'
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      const fileName =
        format === 'pdf'
          ? `sales-return-list-${new Date().toISOString().slice(0, 10)}.pdf`
          : `sales-return-list-${new Date().toISOString().slice(0, 10)}.xlsx`;

      await this.exportHistoryService.completeAndUploadExport(
        prisma,
        jobId,
        filePath,
        fileName,
        mimeType,
      );

      await this.notificationsService.create({
        userId,
        title: 'Sales Return List Export Ready',
        message: `Your Sales Return List ${format.toUpperCase()} report is ready for download.`,
        category: 'export',
        priority: 'high',
        actionType: 'sales-return-list-export.ready',
        actionPayload: JSON.stringify({ jobId }),
      });

      await job.progress(100);
      this.logger.log(`[SalesReturnListExport ${jobId}] Finished processing successfully`);
    } catch (err: any) {
      this.logger.error(`[SalesReturnListExport ${jobId}] Failed: ${err.message}`, err.stack);
      await this.exportHistoryService.failExport(prisma, jobId);
      throw err;
    }
  }
}
