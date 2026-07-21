import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import * as puppeteer from 'puppeteer';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaMasterService } from '../database/prisma-master.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ExportHistoryService } from '../warehouse/export-history/export-history.service';

export interface AllianceRegisterExportJobData {
  jobId: string;
  userId: string;
  tenantId: string;
  tenantDbUrl: string;
  locationId?: string;
  startDate?: string;
  endDate?: string;
  cashierUserId?: string;
  format: 'xlsx' | 'pdf';
  search?: string;
}

const COLUMNS = [
  { header: 'Sales Tax Invoice', key: 'invoiceNo',      width: 22 },
  { header: 'Date',              key: 'date',            width: 12 },
  { header: 'Time',              key: 'time',            width: 10 },
  { header: 'Retail Price',      key: 'retailPrice',     width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Retail Price WOST', key: 'retailWost',      width: 16, align: 'right', numFmt: '#,##0.00' },
  { header: 'Discount',          key: 'discount',        width: 12, align: 'right', numFmt: '#,##0.00' },
  { header: 'S. Tax',            key: 'sTax',            width: 12, align: 'right', numFmt: '#,##0.00' },
  { header: 'Net Sale',          key: 'netSale',         width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Cash',              key: 'cash',            width: 12, align: 'right', numFmt: '#,##0.00' },
  { header: 'Card',              key: 'card',            width: 12, align: 'right', numFmt: '#,##0.00' },
  { header: 'Prefix Card No.',   key: 'prefixCardNo',    width: 18 },
  { header: 'Auth ID',           key: 'authId',          width: 10, align: 'center' },
  { header: 'Card No.',          key: 'cardNo',          width: 10, align: 'center' },
  { header: 'Alliance Option',   key: 'allianceOption',  width: 40 },
  { header: 'Remarks',           key: 'remarks',         width: 35 },
  { header: 'Gift Voucher No.',  key: 'giftVoucherCode', width: 18 },
  { header: 'Amount',            key: 'giftVoucherAmt',  width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Credit Voucher No.', key: 'creditCode',      width: 18 },
  { header: 'Amount',            key: 'creditAmt',       width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Claim Voucher No.',  key: 'claimCode',       width: 18 },
  { header: 'Amount',            key: 'claimAmt',        width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Corporate Voucher No.', key: 'corporateCode', width: 18 },
  { header: 'Amount',            key: 'corporateAmt',    width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Exchange Voucher No.', key: 'exchangeCode',   width: 18 },
  { header: 'Amount',            key: 'exchangeAmt',     width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Credit Voucher Issued', key: 'creditVoucherIssued', width: 22 },
  { header: 'Amount',            key: 'creditVoucherIssuedAmt', width: 14, align: 'right', numFmt: '#,##0.00' },
];

// ─── Helper to parse alliance metadata from the notes field ──────────────────
function parseAllianceNotes(notes: string | null) {
  const notesStr = notes || '';
  const binMatch     = notesStr.match(/BIN:\s*([\d\-]+)/i);
  const slipMatch    = notesStr.match(/Slip:\s*(\d{6})/i);
  const cardMatch    = notesStr.match(/Card:\s*\*{4}(\d{4})/i);
  return {
    binNumber: binMatch  ? binMatch[1]  : '',
    authId:    slipMatch ? slipMatch[1] : '',
    cardLast4: cardMatch ? cardMatch[1] : '',
  };
}

@Processor('alliance-register-export')
export class AllianceRegisterExportProcessor {
  private readonly logger = new Logger(AllianceRegisterExportProcessor.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly exportHistoryService: ExportHistoryService,
  ) {
    if (process.platform === 'linux') {
      try {
        const { exec } = require('child_process');
        exec(
          'apt-get update && apt-get install -y libatk1.0-0 libatk-bridge2.0-0 libcups2 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpangocairo-1.0-0 libasound2 libnss3 libxshmfence1 libgtk-3-0',
          () => {}
        );
      } catch (e: any) {
        this.logger.warn(`Error installing Chromium dependencies: ${e.message}`);
      }
    }
  }

  @Process({ concurrency: 1 })
  async handleExport(job: Job<AllianceRegisterExportJobData>): Promise<void> {
    const {
      jobId, userId, tenantId, tenantDbUrl,
      locationId, startDate: startStr, endDate: endStr,
      cashierUserId, format, search,
    } = job.data;

    this.logger.log(`[AllianceRegisterExport ${jobId}] Starting ${format.toUpperCase()} export`);

    const prisma        = new PrismaService({ tenantId, tenantDbUrl } as any);
    const prismaMaster  = new PrismaMasterService();
    const exportDir     = path.join(process.cwd(), 'uploads', 'exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const ext      = format === 'pdf' ? 'pdf' : 'xlsx';
    const filePath = path.join(exportDir, `export-${jobId}.${ext}`);

    try {
      await job.progress(10);

      // ── Location info ─────────────────────────────────────────
      const location = locationId && locationId !== 'all'
        ? await prisma.location.findUnique({
            where: { id: locationId },
            select: { name: true },
          })
        : null;
      const locationName = location?.name || 'All Outlets';

      const now       = new Date();
      const startDate = startStr ? new Date(startStr) : new Date(now.getFullYear(), now.getMonth(), 1);
      const endDate   = endStr ? new Date(endStr) : new Date(now);
      endDate.setHours(23, 59, 59, 999);

      // ── Fetch alliance-only sales orders (offset pagination per architecture rules) ──
      const records: any[] = [];
      let skip = 0;
      const CHUNK = 500;
      let hasMore = true;

      while (hasMore) {
        const chunk = await prisma.salesOrder.findMany({
          where: {
            ...(locationId && locationId !== 'all' ? { locationId } : {}),
            status: { in: ['completed', 'partially_returned'] },
            createdAt: { gte: startDate, lte: endDate },
            // Alliance filter: pure alliance OR manual-with-alliance
            OR: [
              { allianceId: { not: null } },
              { manualDiscountNote: { contains: '[Manual Alliance]', mode: 'insensitive' } },
            ],
            ...(cashierUserId ? { cashierUserId } : {}),
            ...(search ? { orderNumber: { contains: search, mode: 'insensitive' } } : {}),
          },
          include: {
            alliance: true,
            items: true,
            voucherRedemptions: {
              include: {
                voucher: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
          skip,
          take: CHUNK,
        });

        records.push(...chunk);
        skip += CHUNK;
        if (chunk.length < CHUNK) hasMore = false;
      }

      const orderIds = records.map((o) => o.id);
      const issuedVouchers = orderIds.length > 0
        ? await prisma.voucher.findMany({
            where: {
              sourceOrderId: { in: orderIds },
              voucherType: 'CREDIT',
              isDeleted: false,
            },
          })
        : [];

      const issuedVouchersMap = new Map<string, any[]>();
      for (const v of issuedVouchers) {
        if (v.sourceOrderId) {
          const list = issuedVouchersMap.get(v.sourceOrderId) || [];
          list.push(v);
          issuedVouchersMap.set(v.sourceOrderId, list);
        }
      }

      await job.progress(50);

      // ── Map to report rows ───────────────────────────────────
      const rows: any[] = [];

      for (const order of records) {
        // Retail Price = sum of (unitPrice × qty) — with tax included
        let retailPrice = 0;
        for (const item of order.items) {
          retailPrice += Number(item.unitPrice || 0) * Number(item.quantity || 1);
        }

        // Parse BIN / Auth ID / Card Last 4 from notes
        const { binNumber, authId, cardLast4 } = parseAllianceNotes(order.notes);

        // Alliance Option label
        let allianceOption = '';
        if (order.alliance) {
          const pct = Number(order.alliance.discountPercent);
          const cap = order.alliance.maxDiscount ? ` cap ${Number(order.alliance.maxDiscount).toLocaleString()}` : '';
          const bin = binNumber ? ` | BIN: ${binNumber}` : '';
          allianceOption = `${order.alliance.partnerName} ${pct}%${cap}${bin}`;
        } else if (order.manualDiscountNote) {
          // Manual alliance: strip the prefix tag and show note
          allianceOption = order.manualDiscountNote.replace(/\[Manual Alliance\]/gi, '').trim();
        }

        // Vouchers Used / Redeemed mapping
        let giftVoucherAmt = 0;
        let giftVoucherCode = '';
        let creditAmt = 0;
        let creditCode = '';
        let claimAmt = 0;
        let claimCode = '';
        let corporateAmt = 0;
        let corporateCode = '';
        let exchangeAmt = 0;
        let exchangeCode = '';

        const giftCodes: string[] = [];
        const creditCodes: string[] = [];
        const claimCodes: string[] = [];
        const corpCodes: string[] = [];
        const exchCodes: string[] = [];

        for (const red of order.voucherRedemptions || []) {
          const type = red.voucher?.voucherType;
          const code = red.voucher?.code || '';
          const amt = Number(red.amountUsed);

          if (type === 'GIFT' || type === 'OUTLET_GIFT') {
            giftVoucherAmt += amt;
            giftCodes.push(code);
          } else if (type === 'CREDIT') {
            creditAmt += amt;
            creditCodes.push(code);
          } else if (type === 'CLAIM') {
            claimAmt += amt;
            claimCodes.push(code);
          } else if (type === 'CORPORATE') {
            corporateAmt += amt;
            corpCodes.push(code);
          } else if (type === 'EXCHANGE') {
            exchangeAmt += amt;
            exchCodes.push(code);
          }
        }

        giftVoucherCode = giftCodes.join(', ');
        creditCode = creditCodes.join(', ');
        claimCode = claimCodes.join(', ');
        corporateCode = corpCodes.join(', ');
        exchangeCode = exchCodes.join(', ');

        // Credit Voucher Issued mapping
        const orderIssued = issuedVouchersMap.get(order.id) || [];
        const creditVoucherIssued = orderIssued.map(v => v.code).join(', ');
        const creditVoucherIssuedAmt = orderIssued.reduce((sum, v) => sum + Number(v.faceValue || 0), 0);

        const createdAt = new Date(order.createdAt);

        rows.push({
          invoiceNo:     order.orderNumber,
          date:          createdAt.toLocaleDateString('en-PK', { day: '2-digit', month: '2-digit', year: 'numeric' }),
          time:          createdAt.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', hour12: false }),
          retailPrice,
          retailWost:    Number(order.subtotal || 0),
          discount:      Number(order.discountAmount || 0),
          sTax:          Number(order.taxAmount || 0),
          netSale:       Number(order.grandTotal || 0),
          cash:          Number(order.cashAmount || 0),
          card:          Number(order.cardAmount || 0),
          prefixCardNo:  binNumber,
          authId,
          cardNo:        cardLast4,
          allianceOption,
          remarks:       order.manualDiscountNote || order.notes || '',
          giftVoucherCode,
          giftVoucherAmt,
          creditCode,
          creditAmt,
          claimCode,
          claimAmt,
          corporateCode,
          corporateAmt,
          exchangeCode,
          exchangeAmt,
          creditVoucherIssued,
          creditVoucherIssuedAmt,
          // raw date for sorting
          _createdAt:    createdAt,
        });
      }

      // Sort by date ascending
      rows.sort((a, b) => a._createdAt.getTime() - b._createdAt.getTime());

      // ── Grand totals ─────────────────────────────────────────
      const grandTotals = rows.reduce(
        (acc, r) => {
          acc.retailPrice += r.retailPrice;
          acc.retailWost  += r.retailWost;
          acc.discount    += r.discount;
          acc.sTax        += r.sTax;
          acc.netSale     += r.netSale;
          acc.cash        += r.cash;
          acc.card        += r.card;
          acc.giftVoucherAmt += r.giftVoucherAmt;
          acc.creditAmt      += r.creditAmt;
          acc.claimAmt       += r.claimAmt;
          acc.corporateAmt   += r.corporateAmt;
          acc.exchangeAmt    += r.exchangeAmt;
          acc.creditVoucherIssuedAmt += r.creditVoucherIssuedAmt;
          return acc;
        },
        {
          retailPrice: 0, retailWost: 0, discount: 0, sTax: 0, netSale: 0, cash: 0, card: 0,
          giftVoucherAmt: 0, creditAmt: 0, claimAmt: 0, corporateAmt: 0, exchangeAmt: 0, creditVoucherIssuedAmt: 0
        },
      );

      await job.progress(75);

      // ── Generate file ─────────────────────────────────────────
      if (format === 'pdf') {
        const fromDateStr = startDate.toLocaleDateString();
        const toDateStr   = endDate.toLocaleDateString();
        const html        = this.buildPdfHtml(rows, locationName, fromDateStr, toDateStr, grandTotals);

        const launchArgs = process.platform === 'linux'
          ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-first-run', '--no-zygote']
          : [];

        const browser = await puppeteer.launch({ headless: true, args: launchArgs });

        try {
          const page = await browser.newPage();
          page.setDefaultTimeout(0);
          page.setDefaultNavigationTimeout(0);
          await page.setContent(html, { waitUntil: 'domcontentloaded' });

          const pdfBuffer = await page.pdf({
            format: 'A4',
            landscape: true,
            margin: { top: '15mm', bottom: '15mm', left: '10mm', right: '10mm' },
            printBackground: true,
            displayHeaderFooter: true,
            headerTemplate: '<div style="font-size: 7px; width: 100%; text-align: right; padding-right: 15mm; color: #94a3b8;">Alliance Register Report</div>',
            footerTemplate: '<div style="font-size: 7px; width: 100%; text-align: center; color: #94a3b8;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
          });

          fs.writeFileSync(filePath, pdfBuffer);
        } finally {
          await browser.close();
        }
      } else {
        // ── XLSX ─────────────────────────────────────────────────
        const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
          filename: filePath,
          useStyles: true,
          useSharedStrings: false,
        });

        const ws = workbook.addWorksheet('Alliance Register', {
          pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
        });

        ws.columns = COLUMNS.map(c => ({ key: c.key, width: c.width }));

        // Header row
        const headerRow = ws.getRow(1);
        COLUMNS.forEach((col, idx) => {
          const cell = headerRow.getCell(idx + 1);
          cell.value     = col.header;
          cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
          cell.font      = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
          cell.alignment = {
            horizontal: col.align === 'right' ? 'right' : col.align === 'center' ? 'center' : 'left',
            vertical: 'middle',
            wrapText: false,
          };
        });
        headerRow.height = 26;
        headerRow.commit();

        const borderThin = {
          top:    { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
          left:   { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
          right:  { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
        };

        for (const r of rows) {
          const rowData = {
            invoiceNo:    r.invoiceNo,
            date:         r.date,
            time:         r.time,
            retailPrice:  r.retailPrice,
            retailWost:   r.retailWost,
            discount:     r.discount,
            sTax:         r.sTax,
            netSale:      r.netSale,
            cash:         r.cash,
            card:         r.card,
            prefixCardNo: r.prefixCardNo,
            authId:       r.authId,
            cardNo:       r.cardNo,
            allianceOption: r.allianceOption,
            remarks:      r.remarks,
            giftVoucherCode: r.giftVoucherCode,
            giftVoucherAmt: r.giftVoucherAmt,
            creditCode:   r.creditCode,
            creditAmt:    r.creditAmt,
            claimCode:    r.claimCode,
            claimAmt:     r.claimAmt,
            corporateCode: r.corporateCode,
            corporateAmt: r.corporateAmt,
            exchangeCode: r.exchangeCode,
            exchangeAmt:  r.exchangeAmt,
            creditVoucherIssued: r.creditVoucherIssued,
            creditVoucherIssuedAmt: r.creditVoucherIssuedAmt,
          };

          const row = ws.addRow(rowData);
          for (let colNum = 1; colNum <= COLUMNS.length; colNum++) {
            const cell = row.getCell(colNum);
            cell.border = borderThin;
            cell.font   = { size: 9 };
            const c = COLUMNS[colNum - 1];
            cell.alignment = {
              horizontal: c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : 'left',
              vertical: 'middle',
            };
            if (c.numFmt) cell.numFmt = c.numFmt;
          }
          row.height = 20;
          row.commit();
        }

        // Grand Totals row
        const totalRow = ws.addRow({
          invoiceNo:     'GRAND TOTAL',
          date:          '',
          time:          '',
          retailPrice:   grandTotals.retailPrice,
          retailWost:    grandTotals.retailWost,
          discount:      grandTotals.discount,
          sTax:          grandTotals.sTax,
          netSale:       grandTotals.netSale,
          cash:          grandTotals.cash,
          card:          grandTotals.card,
          prefixCardNo:  '',
          authId:        '',
          cardNo:        '',
          allianceOption: `${rows.length} transaction(s)`,
          remarks:       '',
          giftVoucherCode: '',
          giftVoucherAmt: grandTotals.giftVoucherAmt,
          creditCode:   '',
          creditAmt:    grandTotals.creditAmt,
          claimCode:    '',
          claimAmt:     grandTotals.claimAmt,
          corporateCode: '',
          corporateAmt: grandTotals.corporateAmt,
          exchangeCode: '',
          exchangeAmt:  grandTotals.exchangeAmt,
          creditVoucherIssued: '',
          creditVoucherIssuedAmt: grandTotals.creditVoucherIssuedAmt,
        });

        for (let colNum = 1; colNum <= COLUMNS.length; colNum++) {
          const cell = totalRow.getCell(colNum);
          cell.font   = { bold: true, size: 9.5, color: { argb: 'FF0F172A' } };
          cell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCBDCF5' } };
          cell.border = {
            top:    { style: 'medium', color: { argb: 'FF1E3A5F' } },
            bottom: { style: 'double', color: { argb: 'FF1E3A5F' } },
            left:   { style: 'thin',   color: { argb: 'FFCBD5E1' } },
            right:  { style: 'thin',   color: { argb: 'FFCBD5E1' } },
          };
          const c = COLUMNS[colNum - 1];
          cell.alignment = {
            horizontal: c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : 'left',
            vertical: 'middle',
          };
          if (c.numFmt) cell.numFmt = c.numFmt;
        }
        totalRow.height = 24;
        totalRow.commit();

        await workbook.commit();
      }

      await job.progress(95);

      const mimeType = format === 'pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      const fileName = format === 'pdf'
        ? `alliance-register-report-${new Date().toISOString().slice(0, 10)}.pdf`
        : `alliance-register-report-${new Date().toISOString().slice(0, 10)}.xlsx`;

      await this.exportHistoryService.completeAndUploadExport(
        prisma,
        jobId,
        filePath,
        fileName,
        mimeType,
      );

      await this.notificationsService.create({
        userId,
        title: 'Alliance Register Export Ready',
        message: `Your Alliance Register ${format.toUpperCase()} report has been processed successfully.`,
        category: 'export',
        priority: 'high',
        actionType: 'alliance-register-export.ready',
        actionPayload: JSON.stringify({ jobId }),
      });

      await job.progress(100);
      this.logger.log(`[AllianceRegisterExport ${jobId}] Finished processing successfully`);
    } catch (err) {
      this.logger.error(`[AllianceRegisterExport ${jobId}] Failed: ${err.message}`, err.stack);
      await this.exportHistoryService.failExport(prisma, jobId);
      throw err;
    } finally {
      await prismaMaster.$disconnect();
    }
  }

  // ─── PDF HTML Builder ───────────────────────────────────────────────────────
  private buildPdfHtml(
    data: any[],
    locationName: string,
    fromDateStr: string,
    toDateStr: string,
    grandTotals: any,
  ): string {
    const formatVal = (val: number) =>
      val === 0
        ? '-'
        : val.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    let rowsHtml = '';
    for (const r of data) {
      rowsHtml += `
        <tr>
          <td>${r.invoiceNo}</td>
          <td class="center">${r.date}</td>
          <td class="center">${r.time}</td>
          <td class="num">${formatVal(r.retailPrice)}</td>
          <td class="num">${formatVal(r.retailWost)}</td>
          <td class="num disc">${r.discount > 0 ? formatVal(r.discount) : '-'}</td>
          <td class="num">${formatVal(r.sTax)}</td>
          <td class="num bold">${formatVal(r.netSale)}</td>
          <td class="num">${r.cash > 0 ? formatVal(r.cash) : '-'}</td>
          <td class="num">${r.card > 0 ? formatVal(r.card) : '-'}</td>
          <td class="center mono">${r.prefixCardNo || '-'}</td>
          <td class="center mono">${r.authId || '-'}</td>
          <td class="center mono">${r.cardNo ? '****' + r.cardNo : '-'}</td>
          <td class="alliance">${r.allianceOption || '-'}</td>
          <td class="remarks">${r.remarks || '-'}</td>
          <td class="mono">${r.giftVoucherCode || '-'}</td>
          <td class="num">${formatVal(r.giftVoucherAmt)}</td>
          <td class="mono">${r.creditCode || '-'}</td>
          <td class="num">${formatVal(r.creditAmt)}</td>
          <td class="mono">${r.claimCode || '-'}</td>
          <td class="num">${formatVal(r.claimAmt)}</td>
          <td class="mono">${r.corporateCode || '-'}</td>
          <td class="num">${formatVal(r.corporateAmt)}</td>
          <td class="mono">${r.exchangeCode || '-'}</td>
          <td class="num">${formatVal(r.exchangeAmt)}</td>
          <td class="mono">${r.creditVoucherIssued || '-'}</td>
          <td class="num">${formatVal(r.creditVoucherIssuedAmt)}</td>
        </tr>
      `;
    }

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          * { box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            color: #0f172a;
            font-size: 5px;
            margin: 0;
            padding: 0;
            background: #ffffff;
          }
          .header-block {
            border-bottom: 2px solid #1e3a5f;
            padding-bottom: 6px;
            margin-bottom: 8px;
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
          }
          .company-name {
            font-size: 11px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #0f172a;
          }
          .report-title {
            font-size: 9px;
            font-weight: 700;
            color: #1e3a5f;
            margin-top: 2px;
          }
          .meta-info {
            font-size: 6.5px;
            color: #475569;
            margin-top: 3px;
          }
          .badge {
            display: inline-block;
            background: #1e3a5f;
            color: #fff;
            font-size: 5px;
            font-weight: 700;
            padding: 1px 4px;
            border-radius: 2px;
            letter-spacing: 0.3px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
          }
          /* Define specific widths for 27 columns to fit landscape A4 nicely */
          colgroup col:nth-child(1)  { width: 5.0%; } /* Invoice */
          colgroup col:nth-child(2)  { width: 3.5%; } /* Date */
          colgroup col:nth-child(3)  { width: 2.5%; } /* Time */
          colgroup col:nth-child(4)  { width: 3.5%; } /* Retail Price */
          colgroup col:nth-child(5)  { width: 3.8%; } /* Retail WOST */
          colgroup col:nth-child(6)  { width: 3.2%; } /* Discount */
          colgroup col:nth-child(7)  { width: 3.2%; } /* Tax */
          colgroup col:nth-child(8)  { width: 3.5%; } /* Net Sale */
          colgroup col:nth-child(9)  { width: 3.2%; } /* Cash */
          colgroup col:nth-child(10) { width: 3.2%; } /* Card */
          colgroup col:nth-child(11) { width: 4.5%; } /* Prefix Card No */
          colgroup col:nth-child(12) { width: 3.0%; } /* Auth ID */
          colgroup col:nth-child(13) { width: 3.0%; } /* Card No */
          colgroup col:nth-child(14) { width: 7.0%; } /* Alliance Option */
          colgroup col:nth-child(15) { width: 5.0%; } /* Remarks */
          colgroup col:nth-child(16) { width: 4.0%; } /* Gift No */
          colgroup col:nth-child(17) { width: 3.0%; } /* Gift Amt */
          colgroup col:nth-child(18) { width: 4.0%; } /* Credit No */
          colgroup col:nth-child(19) { width: 3.0%; } /* Credit Amt */
          colgroup col:nth-child(20) { width: 4.0%; } /* Claim No */
          colgroup col:nth-child(21) { width: 3.0%; } /* Claim Amt */
          colgroup col:nth-child(22) { width: 4.0%; } /* Corp No */
          colgroup col:nth-child(23) { width: 3.0%; } /* Corp Amt */
          colgroup col:nth-child(24) { width: 4.0%; } /* Exch No */
          colgroup col:nth-child(25) { width: 3.0%; } /* Exch Amt */
          colgroup col:nth-child(26) { width: 4.5%; } /* Issued No */
          colgroup col:nth-child(27) { width: 3.5%; } /* Issued Amt */

          thead { display: table-header-group; }
          th {
            background-color: #1e3a5f;
            color: #ffffff;
            font-weight: 700;
            text-transform: uppercase;
            font-size: 4px;
            padding: 3px 1px;
            border: 0.5px solid #2d5a8e;
            text-align: center;
          }
          td {
            padding: 2px 1px;
            border: 0.5px solid #e2e8f0;
            vertical-align: middle;
            word-wrap: break-word;
            font-size: 4px;
          }
          td.num   { text-align: right; }
          td.center { text-align: center; }
          td.mono  { font-family: monospace; font-size: 3.5px; }
          td.disc  { color: #b91c1c; }
          td.bold  { font-weight: 700; }
          td.alliance, td.remarks {
            font-size: 3.8px;
            color: #1e3a5f;
          }
          tr { page-break-inside: auto; }
          tr.header-row { page-break-inside: avoid; }
          tr:nth-child(even) { background-color: #f8faff; }
          .grand-total-row {
            background-color: #cbdcf5 !important;
            color: #0f172a;
            font-weight: bold;
            font-size: 4.5px;
            border-top: 1.5px solid #1e3a5f;
            border-bottom: 1.5px double #1e3a5f;
          }
        </style>
      </head>
      <body>
        <div class="header-block">
          <div>
            <div class="company-name">Speed (Pvt.) Limited</div>
            <div class="report-title">Alliance Register Report</div>
            <div class="meta-info">
              <strong>Location:</strong> ${locationName} &nbsp;|&nbsp;
              <strong>Period:</strong> ${fromDateStr} &ndash; ${toDateStr} &nbsp;|&nbsp;
              <strong>Total:</strong> ${data.length} transaction(s)
            </div>
          </div>
          <div>
            <span class="badge">ALLIANCE SALES ONLY</span>
          </div>
        </div>
        <table>
          <colgroup>
            <col/><col/><col/><col/><col/><col/><col/>
            <col/><col/><col/><col/><col/><col/><col/>
            <col/><col/><col/><col/><col/><col/><col/>
            <col/><col/><col/><col/><col/><col/>
          </colgroup>
          <thead>
            <tr class="header-row">
              <th>Sales Tax Invoice</th>
              <th>Date</th>
              <th>Time</th>
              <th>Retail Price</th>
              <th>Retail WOST</th>
              <th>Discount</th>
              <th>S. Tax</th>
              <th>Net Sale</th>
              <th>Cash</th>
              <th>Card</th>
              <th>Prefix Card No.</th>
              <th>Auth ID</th>
              <th>Card No.</th>
              <th>Alliance Option</th>
              <th>Remarks</th>
              <th>Gift Voucher No.</th>
              <th>Amt</th>
              <th>Credit Voucher No.</th>
              <th>Amt</th>
              <th>Claim Voucher No.</th>
              <th>Amt</th>
              <th>Corp Voucher No.</th>
              <th>Amt</th>
              <th>Exch Voucher No.</th>
              <th>Amt</th>
              <th>Credit Issued</th>
              <th>Amt</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
            <tr class="grand-total-row">
              <td colspan="3">GRAND TOTAL (${data.length} txns)</td>
              <td class="num">${formatVal(grandTotals.retailPrice)}</td>
              <td class="num">${formatVal(grandTotals.retailWost)}</td>
              <td class="num disc">${formatVal(grandTotals.discount)}</td>
              <td class="num">${formatVal(grandTotals.sTax)}</td>
              <td class="num bold">${formatVal(grandTotals.netSale)}</td>
              <td class="num">${formatVal(grandTotals.cash)}</td>
              <td class="num">${formatVal(grandTotals.card)}</td>
              <td>-</td>
              <td>-</td>
              <td>-</td>
              <td>-</td>
              <td>-</td>
              <td>-</td>
              <td class="num">${formatVal(grandTotals.giftVoucherAmt)}</td>
              <td>-</td>
              <td class="num">${formatVal(grandTotals.creditAmt)}</td>
              <td>-</td>
              <td class="num">${formatVal(grandTotals.claimAmt)}</td>
              <td>-</td>
              <td class="num">${formatVal(grandTotals.corporateAmt)}</td>
              <td>-</td>
              <td class="num">${formatVal(grandTotals.exchangeAmt)}</td>
              <td>-</td>
              <td class="num">${formatVal(grandTotals.creditVoucherIssuedAmt)}</td>
            </tr>
          </tbody>
        </table>
      </body>
      </html>
    `;
  }
}
