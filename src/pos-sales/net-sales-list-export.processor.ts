import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import * as fs from 'fs';
import * as path from 'path';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { ExportHistoryService } from '../warehouse/export-history/export-history.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  NetSalesListExportService,
  NetSalesListPreviewJobData,
  NetSalesListExportJobData,
} from './net-sales-list-export.service';

@Processor('net-sales-list-export')
export class NetSalesListExportProcessor {
  private readonly logger = new Logger(NetSalesListExportProcessor.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly exportHistoryService: ExportHistoryService,
    private readonly netSalesListExportService: NetSalesListExportService,
  ) {}

  @Process('generate-net-sales-list-preview')
  async handleGeneratePreview(
    job: Job<NetSalesListPreviewJobData>,
  ): Promise<void> {
    const {
      jobId,
      tenantId,
      tenantDbUrl,
      locationId,
      locationIds,
      startDate,
      endDate,
      cashierUserId,
      docTypeFilter,
      reportType,
      search,
      paymentModeGroup,
      minAmount,
      maxAmount,
      fbrOnly,
      fiscalYear,
      year,
    } = job.data;

    const prisma =
      tenantId && tenantDbUrl
        ? PrismaService.getTenantClient(tenantId, tenantDbUrl)
        : new PrismaService({ tenantId, tenantDbUrl } as any);

    try {
      this.logger.log(
        `[NetSalesListPreview ${jobId}] Starting background net sales list preview computation`,
      );
      await job.progress({
        percent: 5,
        message: 'Queueing Net Sales List computation task...',
      });

      const onProgress = async (percent: number, message: string) => {
        if (this.netSalesListExportService.isJobCancelled(jobId)) {
          throw new Error('JOB_CANCELLED');
        }
        await job.progress({
          percent: Math.min(95, Math.max(5, percent)),
          message,
        });
      };

      await this.netSalesListExportService.generateNetSalesListReportDataInternal(
        prisma as any,
        {
          locationId,
          locationIds,
          startDate,
          endDate,
          cashierUserId,
          docTypeFilter,
          reportType,
          search,
          paymentModeGroup,
          minAmount,
          maxAmount,
          fbrOnly,
          fiscalYear,
          year,
          previewJobId: jobId,
          isAborted: () => this.netSalesListExportService.isJobCancelled(jobId),
          onProgress,
        },
      );

      await job.progress({
        percent: 100,
        message: 'Net Sales List preview generated successfully',
      });
      this.logger.log(
        `[NetSalesListPreview ${jobId}] Finished preview generation`,
      );
    } catch (err: any) {
      this.logger.error(
        `[NetSalesListPreview ${jobId}] Failed: ${err.message}`,
        err.stack,
      );
      throw err;
    }
  }

  @Process('generate-net-sales-list-export')
  async handleGenerateExport(
    job: Job<NetSalesListExportJobData>,
  ): Promise<void> {
    const { jobId, tenantId, tenantDbUrl, userId, format = 'xlsx' } = job.data;
    const prisma =
      tenantId && tenantDbUrl
        ? PrismaService.getTenantClient(tenantId, tenantDbUrl)
        : new PrismaService({ tenantId, tenantDbUrl } as any);

    try {
      this.logger.log(
        `[NetSalesListExport ${jobId}] Starting background export`,
      );
      await job.progress({
        percent: 10,
        message: 'Calculating net sales data for export...',
      });

      const data =
        await this.netSalesListExportService.generateNetSalesListReportDataInternal(
          prisma as any,
          {
            ...job.data,
            onProgress: async (p, msg) => {
              await job.progress({
                percent: Math.min(70, Math.floor(p * 0.7)),
                message: msg,
              });
            },
          },
        );

      await job.progress({ percent: 75, message: 'Building Excel file...' });

      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Speed Limit POS ERP';
      workbook.created = new Date();

      const ws = workbook.addWorksheet('Net Sales List');

      // Styles
      const headerFill: ExcelJS.Fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1E293B' },
      };
      const headerFont: Partial<ExcelJS.Font> = {
        name: 'Segoe UI',
        size: 10,
        bold: true,
        color: { argb: 'FFFFFFFF' },
      };

      ws.columns = [
        { header: 'Type', key: 'docType', width: 10 },
        { header: 'Doc #', key: 'docNumber', width: 18 },
        { header: 'Ref / Orig Inv #', key: 'refDocNumber', width: 18 },
        { header: 'Date', key: 'docDate', width: 14 },
        { header: 'Store', key: 'locationName', width: 20 },
        { header: 'Cashier', key: 'cashierName', width: 16 },
        { header: 'Customer', key: 'customerName', width: 18 },
        { header: 'Phone', key: 'customerPhone', width: 14 },
        { header: 'Payment / Refund Mode', key: 'paymentMethod', width: 22 },
        { header: 'SKU', key: 'sku', width: 18 },
        { header: 'Barcode', key: 'barCode', width: 16 },
        { header: 'Description', key: 'description', width: 25 },
        { header: 'Size', key: 'sizeName', width: 10 },
        { header: 'Color', key: 'colorName', width: 12 },
        { header: 'Net Qty', key: 'quantity', width: 12 },
        { header: 'Unit Price', key: 'unitPrice', width: 14 },
        { header: 'Unit Price WOST', key: 'priceWost', width: 15 },
        { header: 'Gross Value', key: 'grossValue', width: 15 },
        { header: 'Gross WOST', key: 'valueExcl', width: 15 },
        { header: 'Discount', key: 'discountAmount', width: 14 },
        { header: 'Discount WOST', key: 'discountAmountWost', width: 15 },
        { header: 'Amount After Disc', key: 'amountAfterDiscount', width: 18 },
        { header: 'Sales Tax', key: 'taxAmount', width: 14 },
        { header: 'Net Revenue', key: 'lineTotal', width: 16 },
        { header: 'Cash (Net)', key: 'cashNet', width: 14 },
        { header: 'Card (Net)', key: 'cardNet', width: 14 },
        { header: 'Credit Sale', key: 'creditSale', width: 14 },
        { header: 'Gift Voucher', key: 'giftVoucher', width: 14 },
        { header: 'Exchange Voucher', key: 'exchangeVoucher', width: 16 },
        { header: 'Credit Voucher', key: 'creditVoucher', width: 15 },
        { header: 'Claim Voucher', key: 'claimVoucher', width: 14 },
        { header: 'Reward Voucher', key: 'rewardVoucher', width: 15 },
      ];

      const headerRow = ws.getRow(1);
      headerRow.eachCell((cell) => {
        cell.fill = headerFill;
        cell.font = headerFont;
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      });
      headerRow.height = 26;

      for (const f of data.flatItems) {
        const row = ws.addRow({
          docType: f.docType,
          docNumber: f.docNumber,
          refDocNumber: f.refDocNumber || '',
          docDate: f.docDate ? f.docDate.slice(0, 10) : '',
          locationName: f.locationName,
          cashierName: f.cashierName,
          customerName: f.customerName,
          customerPhone: f.customerPhone || '',
          paymentMethod: f.paymentMethod,
          sku: f.sku,
          barCode: f.barCode,
          description: f.description,
          sizeName: f.sizeName,
          colorName: f.colorName,
          quantity: f.quantity,
          unitPrice: f.unitPrice,
          priceWost: f.priceWost,
          grossValue: f.quantity * f.unitPrice,
          valueExcl: f.valueExcl,
          discountAmount: f.discountAmount,
          discountAmountWost: f.discountAmountWost,
          amountAfterDiscount: f.amountAfterDiscount,
          taxAmount: f.taxAmount,
          lineTotal: f.lineTotal,
          cashNet: f.cashSale - f.cashRefund,
          cardNet: f.cardSale - f.cardRefund,
          creditSale: f.creditSale,
          giftVoucher: f.giftVoucher,
          exchangeVoucher: f.exchangeVoucher,
          creditVoucher: f.creditVoucher,
          claimVoucher: f.claimVoucher,
          rewardVoucher: f.rewardVoucher,
        });

        // Highlight return rows with soft red
        if (f.docType === 'RETURN') {
          row.eachCell((cell) => {
            cell.font = { color: { argb: 'FFBE123C' } };
          });
        }
      }

      const outDir = path.join(process.cwd(), 'uploads', 'exports');
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      const fileName = `net-sales-list-${new Date().toISOString().slice(0, 10)}.xlsx`;
      const filePath = path.join(outDir, `${jobId}-${fileName}`);
      await workbook.xlsx.writeFile(filePath);

      await this.exportHistoryService.completeAndUploadExport(
        prisma as any,
        jobId,
        filePath,
        fileName,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );

      await job.progress({ percent: 100, message: 'Export completed' });
      this.logger.log(
        `[NetSalesListExport ${jobId}] Export file uploaded and completed`,
      );
    } catch (err: any) {
      this.logger.error(
        `[NetSalesListExport ${jobId}] Failed: ${err.message}`,
        err.stack,
      );
      await this.exportHistoryService.failExport(prisma as any, jobId);
      throw err;
    }
  }
}
