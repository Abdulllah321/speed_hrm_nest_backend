import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';

export interface ChartOfAccountExportJobData {
  jobId: string;
  userId: string;
  tenantId: string;
  tenantDbUrl: string;
  search?: string;
  type?: string;
  isGroup?: boolean;
  isActive?: boolean;
}

// ── Colour palette ─────────────────────────────────────────────────────────────
const SUBHEADER_BG  = '1E3A5F';
const SUBHEADER_FG  = 'F1F5F9';
const BORDER_COLOR  = 'CBD5E1';
const ACTIVE_FG     = '15803D';
const INACTIVE_FG   = 'B91C1C';
const BALANCE_FG    = '0F766E';
const BALANCE_NEG   = 'B91C1C';

// One shade per depth level (0 = root, deepens as level increases)
const LEVEL_BG: string[] = [
  'EFF6FF', // level 0 — root  (blue-50)
  'DBEAFE', // level 1         (blue-100)
  'F0FDF4', // level 2         (green-50)
  'DCFCE7', // level 3         (green-100)
  'FFF7ED', // level 4         (orange-50)
  'FFEDD5', // level 5         (orange-100)
  'FDF4FF', // level 6+        (purple-50)
];

const GROUP_COLORS: Record<string, string> = {
  Identity:  '1E3A5F',
  Hierarchy: '1E4D2B',
  Financial: '4A1942',
  Audit:     '3D2B00',
};

const COLUMNS: {
  header: string;
  key: string;
  width: number;
  group: string;
  numFmt?: string;
  align?: ExcelJS.Alignment['horizontal'];
}[] = [
  // Identity
  { header: 'Code',          key: 'code',         width: 16, group: 'Identity' },
  { header: 'Name',          key: 'name',         width: 38, group: 'Identity' },
  { header: 'Type',          key: 'type',         width: 12, group: 'Identity', align: 'center' },
  { header: 'Status',        key: 'status',       width: 10, group: 'Identity', align: 'center' },
  { header: 'Is Group',      key: 'isGroup',      width: 10, group: 'Identity', align: 'center' },
  // Hierarchy
  { header: 'Level',         key: 'level',        width:  8, group: 'Hierarchy', align: 'center' },
  { header: 'Full Path',     key: 'fullPath',     width: 70, group: 'Hierarchy' },
  // Financial
  { header: 'Debit',         key: 'debit',        width: 20, group: 'Financial', numFmt: '#,##0.00', align: 'right' },
  { header: 'Credit',        key: 'credit',       width: 20, group: 'Financial', numFmt: '#,##0.00', align: 'right' },
  { header: 'Net Balance',   key: 'balance',      width: 20, group: 'Financial', numFmt: '#,##0.00', align: 'right' },
  // Audit
  { header: 'Created At',    key: 'createdAt',    width: 20, group: 'Audit', numFmt: 'dd-mmm-yyyy hh:mm', align: 'center' },
  { header: 'Updated At',    key: 'updatedAt',    width: 20, group: 'Audit', numFmt: 'dd-mmm-yyyy hh:mm', align: 'center' },
];

// ── Tree helpers ───────────────────────────────────────────────────────────────

type RawAccount = {
  id: string;
  code: string;
  name: string;
  type: string;
  isGroup: boolean;
  isActive: boolean;
  parentId: string | null;
  balance: any;
  createdAt: Date;
  updatedAt: Date;
};

type TreeNode = RawAccount & { children: TreeNode[] };

function buildTree(flat: RawAccount[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  for (const a of flat) map.set(a.id, { ...a, children: [] });
  const roots: TreeNode[] = [];
  for (const a of flat) {
    const node = map.get(a.id)!;
    if (a.parentId && map.has(a.parentId)) {
      map.get(a.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  // Sort children by code at every level
  const sortChildren = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => a.code.localeCompare(b.code));
    for (const n of nodes) sortChildren(n.children);
  };
  sortChildren(roots);
  return roots;
}

/** Depth-first walk — yields every node with its depth and ancestor path */
function* walkTree(
  nodes: TreeNode[],
  depth = 0,
  ancestors: string[] = [],
): Generator<{ node: TreeNode; depth: number; path: string[] }> {
  for (const node of nodes) {
    const path = [...ancestors, node.name];
    yield { node, depth, path };
    if (node.children.length) yield* walkTree(node.children, depth + 1, path);
  }
}

@Processor('chart-of-account-export')
export class ChartOfAccountExportProcessor {
  private readonly logger = new Logger(ChartOfAccountExportProcessor.name);

  constructor(
    private readonly notificationsService: NotificationsService,
  ) {}

  @Process()
  async handleExport(job: Job<ChartOfAccountExportJobData>): Promise<void> {
    const { jobId, userId, tenantId, tenantDbUrl, search, type, isGroup, isActive } = job.data;

    this.logger.log(`[CoaExport ${jobId}] Starting for user ${userId}`);

    const prisma = new PrismaService({ tenantId, tenantDbUrl } as any);

    const exportDir = path.join(process.cwd(), 'uploads', 'exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const filePath = path.join(exportDir, `export-${jobId}.xlsx`);

    try {
      // ── Fetch ALL accounts (no filter yet — we need the full tree for
      //    balance roll-up and correct depth-first ordering) ────────────────
      const allAccounts: RawAccount[] = await prisma.chartOfAccount.findMany({
        orderBy: { code: 'asc' },
        select: {
          id: true, code: true, name: true, type: true,
          isGroup: true, isActive: true, parentId: true,
          balance: true, createdAt: true, updatedAt: true,
        },
      });

      // ── Balance roll-up (mirrors ChartOfAccountService.findAll) ──────────
      const balanceMap = new Map<string, number>();
      for (const a of allAccounts) balanceMap.set(a.id, Number(a.balance));
      for (const a of allAccounts) if (a.isGroup) balanceMap.set(a.id, 0);
      for (const a of allAccounts) {
        if (!a.isGroup && a.parentId) {
          let pid: string | null = a.parentId;
          const leaf = Number(a.balance);
          while (pid) {
            balanceMap.set(pid, (balanceMap.get(pid) ?? 0) + leaf);
            pid = allAccounts.find((x) => x.id === pid)?.parentId ?? null;
          }
        }
      }

      // ── Aggregate debit / credit totals per leaf account ─────────────────
      const txAgg = await prisma.accountTransaction.groupBy({
        by: ['accountId'],
        _sum: { debit: true, credit: true },
      });
      const leafDebitMap  = new Map<string, number>();
      const leafCreditMap = new Map<string, number>();
      for (const row of txAgg) {
        leafDebitMap.set(row.accountId,  Number(row._sum.debit  ?? 0));
        leafCreditMap.set(row.accountId, Number(row._sum.credit ?? 0));
      }

      // Roll debit/credit up through the tree the same way balance is rolled up
      const debitMap  = new Map<string, number>();
      const creditMap = new Map<string, number>();
      for (const a of allAccounts) {
        debitMap.set(a.id,  leafDebitMap.get(a.id)  ?? 0);
        creditMap.set(a.id, leafCreditMap.get(a.id) ?? 0);
      }
      for (const a of allAccounts) {
        if (a.isGroup) { debitMap.set(a.id, 0); creditMap.set(a.id, 0); }
      }
      for (const a of allAccounts) {
        if (!a.isGroup && a.parentId) {
          let pid: string | null = a.parentId;
          const d = leafDebitMap.get(a.id)  ?? 0;
          const c = leafCreditMap.get(a.id) ?? 0;
          while (pid) {
            debitMap.set(pid,  (debitMap.get(pid)  ?? 0) + d);
            creditMap.set(pid, (creditMap.get(pid) ?? 0) + c);
            pid = allAccounts.find((x) => x.id === pid)?.parentId ?? null;
          }
        }
      }

      const tree = buildTree(allAccounts);
      const allRows = [...walkTree(tree)];

      // Apply optional filters (search / type / isGroup / isActive)
      // We keep parent rows even if they don't match so the path makes sense,
      // but for a strict filter we just filter the flat walk result.
      const filteredRows = allRows.filter(({ node }) => {
        if (search) {
          const t = search.trim().toLowerCase();
          if (!node.name.toLowerCase().includes(t) && !node.code.toLowerCase().includes(t)) return false;
        }
        if (type     && node.type     !== type)     return false;
        if (isGroup  !== undefined && node.isGroup  !== isGroup)  return false;
        if (isActive !== undefined && node.isActive !== isActive) return false;
        return true;
      });

      const total = filteredRows.length;
      this.logger.log(`[CoaExport ${jobId}] ${total} rows to export`);

      // ── Streaming workbook writer ─────────────────────────────────────────
      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
        filename: filePath,
        useStyles: true,
        useSharedStrings: false,
      });

      const ws = workbook.addWorksheet('Chart of Accounts', {
        pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
        views: [{ state: 'frozen', xSplit: 0, ySplit: 2 }],
      });

      ws.columns = COLUMNS.map((c) => ({ key: c.key, width: c.width }));

      // ── Row 1: Group header bands ─────────────────────────────────────────
      const groups: Record<string, { start: number; end: number }> = {};
      COLUMNS.forEach((col, idx) => {
        const n = idx + 1;
        if (!groups[col.group]) groups[col.group] = { start: n, end: n };
        else groups[col.group].end = n;
      });

      const groupRow = ws.getRow(1);
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
      groupRow.height = 22;
      groupRow.commit();

      // ── Row 2: Column headers ─────────────────────────────────────────────
      const headerRow = ws.getRow(2);
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

      // ── Data rows ─────────────────────────────────────────────────────────
      const CHUNK = 500;
      let rowIdx = 0;

      for (let i = 0; i < filteredRows.length; i += CHUNK) {
        const chunk = filteredRows.slice(i, i + CHUNK);

        for (const { node, depth, path } of chunk) {
          const rolledBalance = balanceMap.get(node.id) ?? 0;
          const rolledDebit   = debitMap.get(node.id)   ?? 0;
          const rolledCredit  = creditMap.get(node.id)  ?? 0;
          const isNeg         = rolledBalance < 0;
          const bgArgb        = `FF${LEVEL_BG[Math.min(depth, LEVEL_BG.length - 1)]}`;

          const indent       = depth > 0 ? '  '.repeat(depth) + '↳ ' : '';
          const indentedName = indent + node.name;
          const fullPath     = path.join(' > ');

          const rowData: Record<string, any> = {
            code:      node.code,
            name:      indentedName,
            type:      node.type,
            status:    node.isActive ? 'Active' : 'Inactive',
            isGroup:   node.isGroup ? 'Yes' : 'No',
            level:     depth + 1,
            fullPath,
            debit:     rolledDebit,
            credit:    rolledCredit,
            balance:   rolledBalance,
            createdAt: new Date(node.createdAt),
            updatedAt: new Date(node.updatedAt),
          };

          const dataRow = ws.getRow(rowIdx + 3);
          COLUMNS.forEach((col, colIdx) => {
            const cell = dataRow.getCell(colIdx + 1);
            cell.value     = rowData[col.key] ?? null;
            if (col.numFmt) cell.numFmt = col.numFmt;
            cell.alignment = { horizontal: col.align ?? 'left', vertical: 'middle', wrapText: col.key === 'fullPath' };
            cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb } };

            if (col.key === 'status') {
              cell.font = {
                bold: true, size: 9,
                color: { argb: node.isActive ? `FF${ACTIVE_FG}` : `FF${INACTIVE_FG}` },
              };
            } else if (col.key === 'debit') {
              cell.font = { size: 9, bold: node.isGroup, color: { argb: 'FF1D4ED8' } }; // blue
            } else if (col.key === 'credit') {
              cell.font = { size: 9, bold: node.isGroup, color: { argb: 'FF7C3AED' } }; // purple
            } else if (col.key === 'balance') {
              cell.font = { size: 9, bold: node.isGroup, color: { argb: isNeg ? `FF${BALANCE_NEG}` : `FF${BALANCE_FG}` } };
            } else if (col.key === 'name') {
              cell.font = { size: 9, bold: node.isGroup, italic: depth === 0 };
            } else if (col.key === 'level') {
              cell.font = { size: 9, color: { argb: 'FF64748B' } };
            } else {
              cell.font = { size: 9 };
            }

            cell.border = {
              top:    { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
              left:   { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
              bottom: { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
              right:  { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
            };
          });

          // Taller rows for group headers so the indented name breathes
          dataRow.height = node.isGroup ? 18 : 15;
          dataRow.commit();
          rowIdx++;
        }

        const pct = total > 0 ? Math.round(((i + chunk.length) / total) * 95) : 50;
        await job.progress(pct);
        await new Promise((r) => setImmediate(r));
      }

      // ── Summary sheet ─────────────────────────────────────────────────────
      // Per-type debit/credit/balance totals (leaf accounts only)
      const typeTotals: Record<string, { debit: number; credit: number; balance: number }> = {};
      for (const { node } of filteredRows) {
        if (!node.isGroup) {
          if (!typeTotals[node.type]) typeTotals[node.type] = { debit: 0, credit: 0, balance: 0 };
          typeTotals[node.type].debit   += debitMap.get(node.id)   ?? 0;
          typeTotals[node.type].credit  += creditMap.get(node.id)  ?? 0;
          typeTotals[node.type].balance += balanceMap.get(node.id) ?? 0;
        }
      }

      // Summary sheet — 4 columns: Label | Debit | Credit | Net Balance
      const summary = workbook.addWorksheet('Summary');
      summary.columns = [
        { key: 'label',   width: 30 },
        { key: 'debit',   width: 22 },
        { key: 'credit',  width: 22 },
        { key: 'balance', width: 22 },
      ];

      const titleRow = summary.getRow(1);
      titleRow.getCell(1).value     = 'Chart of Accounts Export Summary';
      titleRow.getCell(1).font      = { bold: true, size: 14, color: { argb: 'FF1E293B' } };
      titleRow.getCell(1).fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
      titleRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      titleRow.height = 28;
      titleRow.commit();

      // Sub-header row
      const sumHdr = summary.getRow(2);
      ['', 'Total Debit', 'Total Credit', 'Net Balance'].forEach((h, i) => {
        const c = sumHdr.getCell(i + 1);
        c.value = h;
        c.font  = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
        c.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
        c.alignment = { horizontal: i === 0 ? 'left' : 'right', vertical: 'middle' };
      });
      sumHdr.height = 18;
      sumHdr.commit();

      const metaRows: [string, string, string, string][] = [
        ['Export Date',   new Date().toLocaleString('en-PK'), '', ''],
        ['Total Accounts', String(rowIdx), '', ''],
        ['Search Filter',  search ?? '(none)', '', ''],
        ['Type Filter',    type ?? '(all)', '', ''],
        ['Group Filter',   isGroup  !== undefined ? (isGroup  ? 'Groups only' : 'Leaf accounts only') : '(all)', '', ''],
        ['Status Filter',  isActive !== undefined ? (isActive ? 'Active only' : 'Inactive only')      : '(all)', '', ''],
      ];

      let sRowIdx = 3;
      for (const [label, val] of metaRows) {
        const r = summary.getRow(sRowIdx++);
        r.getCell(1).value = label;
        r.getCell(1).font  = { bold: true, size: 10 };
        r.getCell(2).value = val;
        r.getCell(2).font  = { size: 10 };
        const bg = sRowIdx % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF';
        [1, 2, 3, 4].forEach((ci) => {
          r.getCell(ci).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        });
        r.height = 16;
        r.commit();
      }

      // Blank separator
      const sep = summary.getRow(sRowIdx++);
      sep.height = 8;
      sep.commit();

      // Type totals header
      const typeHdr = summary.getRow(sRowIdx++);
      typeHdr.getCell(1).value = 'Balances by Account Type';
      typeHdr.getCell(1).font  = { bold: true, size: 11, color: { argb: 'FF1E293B' } };
      typeHdr.getCell(1).fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
      typeHdr.height = 20;
      typeHdr.commit();

      Object.entries(typeTotals).forEach(([t, { debit, credit, balance }], idx) => {
        const r = summary.getRow(sRowIdx++);
        r.getCell(1).value = t;
        r.getCell(1).font  = { bold: true, size: 10 };
        r.getCell(2).value = debit;
        r.getCell(2).numFmt = '#,##0.00';
        r.getCell(2).font  = { size: 10, color: { argb: 'FF1D4ED8' } };
        r.getCell(3).value = credit;
        r.getCell(3).numFmt = '#,##0.00';
        r.getCell(3).font  = { size: 10, color: { argb: 'FF7C3AED' } };
        r.getCell(4).value = balance;
        r.getCell(4).numFmt = '#,##0.00';
        r.getCell(4).font  = { size: 10, color: { argb: balance < 0 ? `FF${BALANCE_NEG}` : `FF${BALANCE_FG}` } };
        const bg = idx % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF';
        [1, 2, 3, 4].forEach((ci) => {
          r.getCell(ci).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
          r.getCell(ci).alignment = { horizontal: ci === 1 ? 'left' : 'right', vertical: 'middle' };
        });
        r.height = 18;
        r.commit();
      });

      await workbook.commit();
      await job.progress(100);

      this.logger.log(`[CoaExport ${jobId}] File written (${rowIdx} rows)`);

      await this.notificationsService.create({
        userId,
        title: 'Chart of Accounts Export Ready',
        message: `Your export of ${rowIdx.toLocaleString()} account${rowIdx !== 1 ? 's' : ''} is ready to download.`,
        category: 'export',
        priority: 'high',
        actionType: 'chart-of-account-export.ready',
        actionPayload: { jobId },
        entityType: 'chart-of-account-export',
        entityId: jobId,
        channels: ['inApp'],
      });

    } catch (error: any) {
      this.logger.error(`[CoaExport ${jobId}] FAILED: ${error.message}`, error.stack);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

      await this.notificationsService.create({
        userId,
        title: 'Chart of Accounts Export Failed',
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
