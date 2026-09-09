import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../database/prisma.service';
import { ReportsService } from './reports.service';
import { NotificationsService } from '../../notifications/notifications.service';

export interface GeneralLedgerExportJobData {
  jobId: string;
  userId: string;
  tenantId: string;
  tenantDbUrl: string;
  accountId: string;
  from?: string;
  to?: string;
  sourceType?: string;
}

const SUBHEADER_BG = '475569';
const SUBHEADER_FG = 'F8FAFC';
const ALT_ROW_BG   = 'F8FAFC';
const BORDER_COLOR = 'CBD5E1';

const GROUP_COLORS: Record<string, string> = {
  'Identity': '1E3A5F', // Dark Navy
  'Details':  '334155', // Slate
  'Volume':   '1E4D2B', // Forest Green
  'Position': '7C3A00', // Bronze
};

const SOURCE_LABELS: Record<string, string> = {
  PURCHASE_INVOICE: 'Purchase Invoice',
  PAYMENT_VOUCHER: 'Payment Voucher',
  RECEIPT_VOUCHER: 'Receipt Voucher',
  JOURNAL_VOUCHER: 'Journal Voucher',
  ADVANCE_APPLICATION: 'Advance Application',
  SALES_INVOICE: 'Sales Invoice',
};

const COLUMNS: {
  header: string;
  key: string;
  width: number;
  group: string;
  numFmt?: string;
  align?: ExcelJS.Alignment['horizontal'];
}[] = [
  { header: 'Sr. No',      key: 'srNo',            width: 9,  group: 'Identity', align: 'center' },
  { header: 'Date',        key: 'transactionDate', width: 14, group: 'Identity', numFmt: 'dd-mmm-yyyy', align: 'center' },
  { header: 'VOH No.',     key: 'sourceRef',       width: 18, group: 'Identity', align: 'center' },
  { header: 'VOH TYPE',    key: 'sourceType',      width: 18, group: 'Identity', align: 'center' },
  { header: 'Cheque No',   key: 'chequeNo',        width: 15, group: 'Details',  align: 'center' },
  { header: 'Ref 1',       key: 'refBillNo',       width: 15, group: 'Details',  align: 'center' },
  { header: 'Ref 2',       key: 'refBillNo2',      width: 15, group: 'Details',  align: 'center' },
  { header: 'Narration',   key: 'narration',       width: 44, group: 'Details',  align: 'left' },
  { header: 'Debit',       key: 'debit',           width: 18, group: 'Volume',   numFmt: '#,##0.00', align: 'right' },
  { header: 'Credit',      key: 'credit',          width: 18, group: 'Volume',   numFmt: '#,##0.00', align: 'right' },
  { header: 'Balance',     key: 'runningBalance',  width: 20, group: 'Position', numFmt: '#,##0.00;(#,##0.00)', align: 'right' },
];

function sanitizeSheetName(name: string, existingNames: Set<string>): string {
  let clean = name.replace(/[\\/?*\[\]:]/g, ' ').replace(/\s+/g, ' ').trim();
  if (clean.length > 31) clean = clean.substring(0, 31).trim();
  if (!clean) clean = 'Sheet';
  let candidate = clean;
  let count = 1;
  while (existingNames.has(candidate.toLowerCase())) {
    const suffix = ` (${count++})`;
    const maxBaseLen = 31 - suffix.length;
    candidate = `${clean.substring(0, maxBaseLen).trim()}${suffix}`;
  }
  existingNames.add(candidate.toLowerCase());
  return candidate;
}

@Processor('general-ledger-export')
export class GeneralLedgerExportProcessor {
  private readonly logger = new Logger(GeneralLedgerExportProcessor.name);

  constructor(
    private readonly notificationsService: NotificationsService,
  ) {}

  @Process()
  async handleExport(job: Job<GeneralLedgerExportJobData>): Promise<void> {
    const { jobId, userId, tenantId, tenantDbUrl, accountId, from, to, sourceType } = job.data;

    this.logger.log(`[GeneralLedgerExport ${jobId}] Starting general ledger export for user ${userId}`);

    const prisma = new PrismaService({ tenantId, tenantDbUrl } as any);
    const reportsService = new ReportsService(prisma);

    const exportDir = path.join(process.cwd(), 'uploads', 'exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const filePath = path.join(exportDir, `export-${jobId}.xlsx`);

    try {
      // 1. Fetch general ledger data using ReportsService (with safe limit)
      const result = await reportsService.getGeneralLedger(
        accountId,
        from,
        to,
        1,
        1000000,
        sourceType === 'all' ? undefined : sourceType,
      );

      const heads: any[] = result.heads && result.heads.length > 0
        ? result.heads
        : [
            {
              head: { id: result.account.id, code: result.account.code, name: result.account.name },
              openingBalance: result.openingBalance,
              rangeTotalDebit: result.rangeTotalDebit,
              rangeTotalCredit: result.rangeTotalCredit,
              rangeClosingBalance: result.rangeClosingBalance,
              ledgerCount: result.ledgers?.length || 1,
              transactionCount: result.rows?.length || 0,
              ledgers: result.ledgers && result.ledgers.length > 0 ? result.ledgers : [result],
            },
          ];

      const totalAccounts = heads.reduce((sum, h) => sum + (h.ledgers?.length || 0), 0);
      const totalTransactions = heads.reduce((sum, h) => sum + (h.transactionCount || 0), 0);

      // 2. Initialize streaming Excel writer
      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
        filename: filePath,
        useStyles: true,
        useSharedStrings: false,
      });

      const sheetNames = new Set<string>();

      // ── SHEET 1: Executive Summary & Index ─────────────────────────────────
      const summarySheetName = sanitizeSheetName('Summary & Index', sheetNames);
      const summaryWs = workbook.addWorksheet(summarySheetName, {
        pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
      });

      const summaryCols = [
        { header: 'Sr.',             key: 'sr',             width: 6,  align: 'center' },
        { header: 'Head Code',       key: 'headCode',       width: 14, align: 'center' },
        { header: 'Head Name',       key: 'headName',       width: 26, align: 'left' },
        { header: 'Account Code',    key: 'accCode',        width: 14, align: 'center' },
        { header: 'Account Name',    key: 'accName',        width: 28, align: 'left' },
        { header: 'Account Type',    key: 'type',           width: 14, align: 'center' },
        { header: 'Opening Balance', key: 'opening',        width: 20, align: 'right', numFmt: '#,##0.00;(#,##0.00)' },
        { header: 'Debit Volume',    key: 'debit',          width: 20, align: 'right', numFmt: '#,##0.00' },
        { header: 'Credit Volume',   key: 'credit',         width: 20, align: 'right', numFmt: '#,##0.00' },
        { header: 'Closing Balance', key: 'closing',        width: 22, align: 'right', numFmt: '#,##0.00;(#,##0.00)' },
        { header: 'Tx Count',        key: 'txCount',        width: 10, align: 'center' },
      ];
      summaryWs.columns = summaryCols.map(c => ({ key: c.key, width: c.width }));

      // Row 1: Title Banner
      const sRow1 = summaryWs.getRow(1);
      sRow1.getCell(1).value = 'GENERAL LEDGER — EXECUTIVE SUMMARY & INDEX';
      sRow1.getCell(1).font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 13 };
      sRow1.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
      sRow1.getCell(1).alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
      for (let c = 2; c <= summaryCols.length; c++) {
        sRow1.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
      }
      sRow1.height = 28;
      sRow1.commit();

      // Row 2: Metadata Subtitle
      const sRow2 = summaryWs.getRow(2);
      sRow2.getCell(1).value = `Period: ${from ? new Date(from).toLocaleDateString('en-GB') : 'Beginning'} to ${to ? new Date(to).toLocaleDateString('en-GB') : 'Present'}  |  Exported: ${new Date().toLocaleString('en-PK')}  |  Document Filter: ${sourceType ?? 'All Documents'}`;
      sRow2.getCell(1).font = { italic: true, size: 9, color: { argb: 'FF475569' } };
      sRow2.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      sRow2.getCell(1).alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
      for (let c = 2; c <= summaryCols.length; c++) {
        sRow2.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      }
      sRow2.height = 20;
      sRow2.commit();

      // Row 3: Scope KPIs
      const sRow3 = summaryWs.getRow(3);
      sRow3.getCell(1).value = `SCOPE: ${heads.length} Account Head(s)  •  ${totalAccounts} Sub-Account(s)  •  ${totalTransactions} Total Transactions`;
      sRow3.getCell(1).font = { bold: true, size: 9, color: { argb: 'FF1E293B' } };
      sRow3.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
      sRow3.getCell(1).alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
      for (let c = 2; c <= summaryCols.length; c++) {
        sRow3.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
      }
      sRow3.height = 20;
      sRow3.commit();

      // Row 4: Empty space
      summaryWs.getRow(4).height = 10;
      summaryWs.getRow(4).commit();

      // Row 5: Table Column Headers
      const sHeaderRow = summaryWs.getRow(5);
      summaryCols.forEach((col, idx) => {
        const cell = sHeaderRow.getCell(idx + 1);
        cell.value = col.header.toUpperCase();
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
        cell.alignment = { horizontal: (col.align as any) || 'left', vertical: 'middle' };
        cell.border = {
          top:    { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
          left:   { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
          bottom: { style: 'medium', color: { argb: `FF${BORDER_COLOR}` } },
          right:  { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
        };
      });
      sHeaderRow.height = 22;
      sHeaderRow.commit();

      // Summary Table Rows
      let sIdx = 0;
      let grandOpening = 0;
      let grandDebit = 0;
      let grandCredit = 0;
      let grandClosing = 0;

      for (const head of heads) {
        for (const ledger of head.ledgers) {
          sIdx++;
          const row = summaryWs.getRow(sIdx + 5);
          const isAlt = sIdx % 2 === 1;

          grandOpening += Number(ledger.openingBalance || 0);
          grandDebit   += Number(ledger.rangeTotalDebit || 0);
          grandCredit  += Number(ledger.rangeTotalCredit || 0);
          grandClosing += Number(ledger.rangeClosingBalance || 0);

          const values: Record<string, any> = {
            sr: sIdx,
            headCode: head.head.code,
            headName: head.head.name,
            accCode: ledger.account.code,
            accName: ledger.account.name,
            type: ledger.account.type,
            opening: Number(ledger.openingBalance || 0),
            debit: Number(ledger.rangeTotalDebit || 0),
            credit: Number(ledger.rangeTotalCredit || 0),
            closing: Number(ledger.rangeClosingBalance || 0),
            txCount: ledger.rows?.length || 0,
          };

          summaryCols.forEach((col, cIdx) => {
            const cell = row.getCell(cIdx + 1);
            cell.value = values[col.key];
            if (col.numFmt) cell.numFmt = col.numFmt;
            cell.alignment = { horizontal: (col.align as any) || 'left', vertical: 'middle' };
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: isAlt ? ALT_ROW_BG : 'FFFFFFFF' },
            };
            cell.font = { size: 9 };
            if (col.key === 'closing') {
              cell.font = {
                bold: true,
                size: 9,
                color: values.closing >= 0 ? { argb: 'FF065F46' } : { argb: 'FF991B1B' },
              };
            }
            cell.border = {
              top:    { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
              left:   { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
              bottom: { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
              right:  { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
            };
          });

          row.height = 19;
          row.commit();
        }
      }

      // Grand Total Row on Summary Sheet
      const grandTotalRow = summaryWs.getRow(sIdx + 6);
      const grandValues: Record<string, any> = {
        headName: 'GRAND TOTALS',
        opening: grandOpening,
        debit: grandDebit,
        credit: grandCredit,
        closing: grandClosing,
        txCount: totalTransactions,
      };

      summaryCols.forEach((col, cIdx) => {
        const cell = grandTotalRow.getCell(cIdx + 1);
        cell.value = grandValues[col.key] !== undefined ? grandValues[col.key] : '';
        if (col.numFmt) cell.numFmt = col.numFmt;
        cell.alignment = { horizontal: (col.align as any) || 'left', vertical: 'middle' };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
        cell.font = { bold: true, size: 9, color: { argb: 'FF1E293B' } };
        cell.border = {
          top:    { style: 'thin', color: { argb: 'FF000000' } },
          left:   { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
          bottom: { style: 'double', color: { argb: 'FF000000' } },
          right:  { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
        };
      });
      grandTotalRow.height = 22;
      grandTotalRow.commit();
      summaryWs.commit();

      // ── SHEETS 2..N: Dedicated Worksheets per Account Head ─────────────────
      let totalProcessedRows = 0;

      for (let hIdx = 0; hIdx < heads.length; hIdx++) {
        const headGroup = heads[hIdx];
        const rawSheetTitle = `${headGroup.head.code} - ${headGroup.head.name}`;
        const sheetTitle = sanitizeSheetName(rawSheetTitle, sheetNames);

        const ws = workbook.addWorksheet(sheetTitle, {
          pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
        });

        ws.columns = COLUMNS.map(c => ({ key: c.key, width: c.width }));

        let curRowIdx = 1;

        // Master Head Banner
        const headTitleRow = ws.getRow(curRowIdx++);
        headTitleRow.getCell(1).value = `HEAD: ${headGroup.head.code} — ${headGroup.head.name}`;
        headTitleRow.getCell(1).font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
        headTitleRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
        headTitleRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
        for (let c = 2; c <= COLUMNS.length; c++) {
          headTitleRow.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
        }
        headTitleRow.height = 26;
        headTitleRow.commit();

        const headSubRow = ws.getRow(curRowIdx++);
        headSubRow.getCell(1).value = `Period: ${from ? new Date(from).toLocaleDateString('en-GB') : 'Beginning'} to ${to ? new Date(to).toLocaleDateString('en-GB') : 'Present'}  |  Sub-Accounts: ${headGroup.ledgers.length}  |  Total Head Debit: ${headGroup.rangeTotalDebit.toLocaleString('en-PK')}  |  Total Head Credit: ${headGroup.rangeTotalCredit.toLocaleString('en-PK')}`;
        headSubRow.getCell(1).font = { italic: true, size: 9, color: { argb: 'FF475569' } };
        headSubRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
        headSubRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
        for (let c = 2; c <= COLUMNS.length; c++) {
          headSubRow.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
        }
        headSubRow.height = 20;
        headSubRow.commit();

        ws.getRow(curRowIdx++).height = 10;
        ws.getRow(curRowIdx - 1).commit();

        // Iterate through all sub-accounts under this Head
        for (let lIdx = 0; lIdx < headGroup.ledgers.length; lIdx++) {
          const ledgerItem = headGroup.ledgers[lIdx];
          const isDebitNormal = ledgerItem.account.type === 'ASSET' || ledgerItem.account.type === 'EXPENSE';

          // Sub-Account Header Bar
          const accHeaderRow = ws.getRow(curRowIdx++);
          accHeaderRow.getCell(1).value = `ACCOUNT: ${ledgerItem.account.code} — ${ledgerItem.account.name}   [${ledgerItem.account.type} • ${isDebitNormal ? 'Debit Normal' : 'Credit Normal'}]`;
          accHeaderRow.getCell(1).font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
          accHeaderRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
          accHeaderRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
          for (let c = 2; c <= COLUMNS.length; c++) {
            accHeaderRow.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
          }
          accHeaderRow.height = 22;
          accHeaderRow.commit();

          // Group Header Bands Row
          const groups: Record<string, { start: number; end: number }> = {};
          COLUMNS.forEach((col, idx) => {
            const n = idx + 1;
            if (!groups[col.group]) groups[col.group] = { start: n, end: n };
            else groups[col.group].end = n;
          });

          const groupRow = ws.getRow(curRowIdx++);
          COLUMNS.forEach((col, idx) => {
            const cell = groupRow.getCell(idx + 1);
            const { start } = groups[col.group];
            if (idx + 1 === start) cell.value = col.group.toUpperCase();
            cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${GROUP_COLORS[col.group] ?? '1E293B'}` } };
            cell.font      = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.border    = {
              top:    { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
              left:   { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
              bottom: { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
              right:  { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
            };
          });
          groupRow.height = 20;
          groupRow.commit();

          // Column headers
          const headerRow = ws.getRow(curRowIdx++);
          COLUMNS.forEach((col, idx) => {
            const cell = headerRow.getCell(idx + 1);
            cell.value     = col.header;
            cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${SUBHEADER_BG}` } };
            cell.font      = { bold: true, color: { argb: `FF${SUBHEADER_FG}` }, size: 9 };
            cell.alignment = { horizontal: col.align ?? 'left', vertical: 'middle' };
            cell.border    = {
              top:    { style: 'thin',   color: { argb: `FF${BORDER_COLOR}` } },
              left:   { style: 'thin',   color: { argb: `FF${BORDER_COLOR}` } },
              bottom: { style: 'medium', color: { argb: `FF${BORDER_COLOR}` } },
              right:  { style: 'thin',   color: { argb: `FF${BORDER_COLOR}` } },
            };
          });
          headerRow.height = 20;
          headerRow.commit();

          // Opening Balance Row
          const opRow = ws.getRow(curRowIdx++);
          opRow.getCell(1).value = '';
          opRow.getCell(2).value = '';
          opRow.getCell(3).value = '—';
          opRow.getCell(4).value = 'Opening Balance';
          opRow.getCell(5).value = '';
          opRow.getCell(6).value = '';
          opRow.getCell(7).value = '';
          opRow.getCell(8).value = 'Balance brought forward';
          opRow.getCell(9).value = null;
          opRow.getCell(10).value = null;
          opRow.getCell(11).value = Number(ledgerItem.openingBalance);
          opRow.getCell(11).numFmt = '#,##0.00;(#,##0.00)';
          opRow.getCell(11).alignment = { horizontal: 'right', vertical: 'middle' };
          opRow.getCell(11).font = {
            bold: true,
            size: 9,
            color: ledgerItem.openingBalance >= 0 ? { argb: 'FF065F46' } : { argb: 'FF991B1B' },
          };

          for (let c = 1; c <= 11; c++) {
            const cell = opRow.getCell(c);
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
            cell.border = {
              top:    { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
              left:   { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
              bottom: { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
              right:  { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
            };
          }
          opRow.height = 18;
          opRow.commit();

          // Data Rows
          const rows = ledgerItem.rows || [];
          if (rows.length === 0) {
            const noTxRow = ws.getRow(curRowIdx++);
            noTxRow.getCell(1).value = '';
            noTxRow.getCell(4).value = 'No transactions recorded in this period';
            noTxRow.getCell(4).font = { italic: true, size: 9, color: { argb: 'FF64748B' } };
            for (let c = 1; c <= 11; c++) {
              const cell = noTxRow.getCell(c);
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
              cell.border = {
                top:    { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
                left:   { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
                bottom: { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
                right:  { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
              };
            }
            noTxRow.height = 18;
            noTxRow.commit();
          } else {
            let rowCounter = 0;
            for (const r of rows) {
              rowCounter++;
              totalProcessedRows++;
              const isAlt = rowCounter % 2 === 1;

              const dataRow = ws.getRow(curRowIdx++);
              const rowData: Record<string, any> = {
                srNo:            rowCounter,
                transactionDate: r.transactionDate ? new Date(r.transactionDate) : null,
                sourceRef:       r.sourceRef,
                sourceType:      SOURCE_LABELS[r.sourceType] ?? r.sourceType,
                chequeNo:        r.chequeNo || '',
                refBillNo:       r.refBillNo || '',
                refBillNo2:      r.refBillNo2 || '',
                narration:       r.narration || r.description || '—',
                debit:           r.debit > 0 ? Number(r.debit) : null,
                credit:          r.credit > 0 ? Number(r.credit) : null,
                runningBalance:  Number(r.runningBalance),
              };

              COLUMNS.forEach((col, colIdx) => {
                const cell = dataRow.getCell(colIdx + 1);
                cell.value = rowData[col.key];

                if (col.numFmt) cell.numFmt = col.numFmt;
                cell.alignment = { horizontal: col.align ?? 'left', vertical: 'middle' };

                cell.fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: isAlt ? ALT_ROW_BG : 'FFFFFFFF' },
                };

                cell.font = { size: 9 };
                if (col.key === 'runningBalance') {
                  cell.font = {
                    bold: true,
                    size: 9,
                    color: r.runningBalance >= 0 ? { argb: 'FF065F46' } : { argb: 'FF991B1B' },
                  };
                }

                cell.border = {
                  top:    { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
                  left:   { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
                  bottom: { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
                  right:  { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
                };
              });

              dataRow.height = 18;
              dataRow.commit();

              if (totalProcessedRows % 100 === 0 && totalTransactions > 0) {
                const pct = Math.min(95, Math.round((totalProcessedRows / totalTransactions) * 90));
                await job.progress(pct);
                await new Promise(res => setImmediate(res));
              }
            }
          }

          // Sub-Account Closing Total Row
          const subTotalRow = ws.getRow(curRowIdx++);
          const subTotalsData: Record<string, any> = {
            sourceType:      `TOTAL (${ledgerItem.account.code})`,
            debit:           Number(ledgerItem.rangeTotalDebit),
            credit:          Number(ledgerItem.rangeTotalCredit),
            runningBalance:  Number(ledgerItem.rangeClosingBalance),
          };

          COLUMNS.forEach((col, colIdx) => {
            const cell = subTotalRow.getCell(colIdx + 1);
            if (col.key === 'sourceType') {
              cell.value = subTotalsData.sourceType;
            } else if (subTotalsData[col.key] !== undefined) {
              cell.value = subTotalsData[col.key];
            } else {
              cell.value = null;
            }

            if (col.numFmt) cell.numFmt = col.numFmt;
            cell.alignment = { horizontal: col.align ?? 'left', vertical: 'middle' };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
            cell.font = { bold: true, size: 9, color: { argb: 'FF1E293B' } };
            cell.border = {
              top:    { style: 'thin', color: { argb: 'FF000000' } },
              left:   { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
              bottom: { style: 'double', color: { argb: 'FF000000' } },
              right:  { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
            };
          });

          subTotalRow.height = 20;
          subTotalRow.commit();

          // Spacing row between sub-accounts
          ws.getRow(curRowIdx++).height = 12;
          ws.getRow(curRowIdx - 1).commit();
        }

        // Head Grand Total Row (if more than 1 sub-account under this Head)
        if (headGroup.ledgers.length > 1) {
          const headGrandRow = ws.getRow(curRowIdx++);
          const headGrandData: Record<string, any> = {
            sourceType:      `HEAD TOTAL (${headGroup.head.code})`,
            debit:           Number(headGroup.rangeTotalDebit),
            credit:          Number(headGroup.rangeTotalCredit),
            runningBalance:  Number(headGroup.rangeClosingBalance),
          };

          COLUMNS.forEach((col, colIdx) => {
            const cell = headGrandRow.getCell(colIdx + 1);
            if (col.key === 'sourceType') {
              cell.value = headGrandData.sourceType;
            } else if (headGrandData[col.key] !== undefined) {
              cell.value = headGrandData[col.key];
            } else {
              cell.value = null;
            }

            if (col.numFmt) cell.numFmt = col.numFmt;
            cell.alignment = { horizontal: col.align ?? 'left', vertical: 'middle' };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCBD5E1' } };
            cell.font = { bold: true, size: 9.5, color: { argb: 'FF0F172A' } };
            cell.border = {
              top:    { style: 'medium', color: { argb: 'FF000000' } },
              left:   { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
              bottom: { style: 'double', color: { argb: 'FF000000' } },
              right:  { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
            };
          });

          headGrandRow.height = 22;
          headGrandRow.commit();
        }

        ws.commit();
      }

      await workbook.commit();
      await job.progress(100);

      this.logger.log(`[GeneralLedgerExport ${jobId}] Finished multi-sheet Excel export successfully`);

      // ── Push In-App Notification ──────────────────────────────────────────
      await this.notificationsService.create({
        userId,
        title: 'General Ledger Export Ready',
        message: `Your General Ledger Excel export with ${heads.length} Head(s) & ${totalAccounts} Sub-Account(s) is ready.`,
        category: 'export',
        priority: 'high',
        actionType: 'general-ledger-export.ready',
        actionPayload: { jobId },
        entityType: 'general-ledger-export',
        entityId: jobId,
        channels: ['inApp'],
      });

    } catch (error: any) {
      this.logger.error(`[GeneralLedgerExport ${jobId}] FAILED: ${error.message}`, error.stack);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

      await this.notificationsService.create({
        userId,
        title: 'General Ledger Export Failed',
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
