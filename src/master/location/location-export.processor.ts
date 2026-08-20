import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';

export interface LocationExportJobData {
  jobId: string;
  userId: string;
  tenantId: string;
  tenantDbUrl: string;
  search?: string;
  status?: string;
  isOnline?: string;
  isStockLocation?: string;
}

// ── Colour palette ─────────────────────────────────────────────────────────────
const SUBHEADER_BG = '1E3A5F';
const SUBHEADER_FG = 'F1F5F9';
const ALT_ROW_BG = 'F0F4F8';
const BORDER_COLOR = 'CBD5E1';

const GROUP_COLORS: Record<string, string> = {
  Identity: '1E3A5F',
  'Contact & Address': '1E4D2B',
  'POS & Integration': '4A1942',
  Audit: '3D2B00',
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
  { header: 'Location Code', key: 'code', width: 14, group: 'Identity', align: 'center' },
  { header: 'Short Code', key: 'shortCode', width: 12, group: 'Identity', align: 'center' },
  { header: 'Center ID', key: 'centerId', width: 14, group: 'Identity', align: 'center' },
  { header: 'Location Name', key: 'name', width: 30, group: 'Identity' },
  { header: 'Status', key: 'status', width: 12, group: 'Identity', align: 'center' },
  { header: 'Stock Location', key: 'isStockLocation', width: 15, group: 'Identity', align: 'center' },
  { header: 'Online Status', key: 'isOnline', width: 14, group: 'Identity', align: 'center' },
  { header: 'Last Online At', key: 'lastOnlineAt', width: 18, group: 'Identity', numFmt: 'dd-mmm-yyyy hh:mm', align: 'center' },

  // Contact & Address
  { header: 'Phone', key: 'phone', width: 16, group: 'Contact & Address' },
  { header: 'Address', key: 'address', width: 34, group: 'Contact & Address' },
  { header: 'City', key: 'cityName', width: 18, group: 'Contact & Address' },
  { header: 'Latitude', key: 'latitude', width: 14, group: 'Contact & Address', align: 'right' },
  { header: 'Longitude', key: 'longitude', width: 14, group: 'Contact & Address', align: 'right' },
  { header: 'Geo Fence', key: 'geoFenceEnabled', width: 12, group: 'Contact & Address', align: 'center' },
  { header: 'Geo Radius (m)', key: 'geoFenceRadius', width: 16, group: 'Contact & Address', numFmt: '#,##0', align: 'right' },
  { header: 'IP Whitelist', key: 'ipWhitelist', width: 22, group: 'Contact & Address' },

  // POS & Integration
  { header: 'Registered Brands', key: 'brands', width: 26, group: 'POS & Integration' },
  { header: 'POS Count', key: 'posCount', width: 12, group: 'POS & Integration', numFmt: '#,##0', align: 'right' },
  { header: 'POS Terminals', key: 'posNames', width: 28, group: 'POS & Integration' },
  { header: 'Cash GL Code', key: 'cashGLCode', width: 16, group: 'POS & Integration', align: 'center' },
  { header: 'FBR Integration', key: 'fbrEnabled', width: 14, group: 'POS & Integration', align: 'center' },
  { header: 'FBR BPOS ID', key: 'fbrBposId', width: 16, group: 'POS & Integration', align: 'center' },
  { header: 'FBR Seller Name', key: 'fbrSellerName', width: 24, group: 'POS & Integration' },
  { header: 'FBR NTN', key: 'fbrNtn', width: 16, group: 'POS & Integration', align: 'center' },

  // Audit
  { header: 'Created At', key: 'createdAt', width: 18, group: 'Audit', numFmt: 'dd-mmm-yyyy hh:mm', align: 'center' },
  { header: 'Updated At', key: 'updatedAt', width: 18, group: 'Audit', numFmt: 'dd-mmm-yyyy hh:mm', align: 'center' },
];

@Processor('location-export')
export class LocationExportProcessor {
  private readonly logger = new Logger(LocationExportProcessor.name);

  constructor(private readonly notificationsService: NotificationsService) {}

  @Process()
  async handleExport(job: Job<LocationExportJobData>): Promise<void> {
    const { jobId, userId, tenantId, tenantDbUrl, search, status, isOnline, isStockLocation } = job.data;

    this.logger.log(`[LocationExport ${jobId}] Starting for user ${userId}`);

    const prisma = new PrismaService({ tenantId, tenantDbUrl } as any);

    const exportDir = path.join(process.cwd(), 'uploads', 'exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const filePath = path.join(exportDir, `export-${jobId}.xlsx`);

    try {
      // ── Build WHERE ──────────────────────────────────────────────────────
      const andClauses: any[] = [{ isDeleted: false }];

      if (search) {
        const t = search.trim();
        andClauses.push({
          OR: [
            { name: { contains: t, mode: 'insensitive' } },
            { code: { contains: t, mode: 'insensitive' } },
            { shortCode: { contains: t, mode: 'insensitive' } },
            { centerId: { contains: t, mode: 'insensitive' } },
            { phone: { contains: t, mode: 'insensitive' } },
            { address: { contains: t, mode: 'insensitive' } },
            { fbrNtn: { contains: t, mode: 'insensitive' } },
          ],
        });
      }

      if (status) {
        andClauses.push({ status });
      }

      if (isOnline !== undefined && isOnline !== '') {
        andClauses.push({ isOnline: String(isOnline) === 'true' });
      }

      if (isStockLocation !== undefined && isStockLocation !== '') {
        andClauses.push({ isStockLocation: String(isStockLocation) === 'true' });
      }

      const where: any = { AND: andClauses };

      const total = await prisma.location.count({ where });
      this.logger.log(`[LocationExport ${jobId}] ${total} locations to export`);

      // ── Streaming workbook writer ────────────────────────────────────────
      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
        filename: filePath,
        useStyles: true,
        useSharedStrings: false,
      });

      const ws = workbook.addWorksheet('Locations', {
        pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
        views: [{ state: 'frozen', xSplit: 0, ySplit: 2 }],
      });

      ws.columns = COLUMNS.map((c) => ({ key: c.key, width: c.width }));

      // ── Row 1: Group header bands ────────────────────────────────────────
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
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: `FF${GROUP_COLORS[col.group] ?? '1E293B'}` },
        };
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = {
          top: { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
          left: { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
          bottom: { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
          right: { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
        };
      });
      groupRow.height = 22;
      groupRow.commit();

      // ── Row 2: Column headers ────────────────────────────────────────────
      const headerRow = ws.getRow(2);
      COLUMNS.forEach((col, idx) => {
        const cell = headerRow.getCell(idx + 1);
        cell.value = col.header;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${SUBHEADER_BG}` } };
        cell.font = { bold: true, color: { argb: `FF${SUBHEADER_FG}` }, size: 9 };
        cell.alignment = { horizontal: col.align ?? 'left', vertical: 'middle' };
        cell.border = {
          top: { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
          left: { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
          bottom: { style: 'medium', color: { argb: `FF${BORDER_COLOR}` } },
          right: { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
        };
      });
      headerRow.height = 20;
      headerRow.commit();

      // ── Data rows — cursor-paginated in chunks of 500 ────────────────────
      const CHUNK = 500;
      let cursor: string | undefined;
      let rowIdx = 0;
      let processed = 0;

      while (true) {
        const chunk = await prisma.location.findMany({
          where,
          include: {
            pos: {
              select: {
                id: true,
                posId: true,
                name: true,
                status: true,
              },
            },
            locationBrands: {
              select: {
                brand: {
                  select: { id: true, name: true },
                },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: CHUNK,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });

        if (!chunk.length) break;

        // Batch fetch city names for the current chunk
        const cityIds = Array.from(
          new Set(chunk.map((c) => c.cityId).filter(Boolean)),
        ) as string[];
        const cityMap: Record<string, string> = {};
        if (cityIds.length > 0) {
          const cities = await prisma.city.findMany({
            where: { id: { in: cityIds } },
            select: { id: true, name: true },
          });
          cities.forEach((ct) => {
            cityMap[ct.id] = ct.name;
          });
        }

        for (const loc of chunk) {
          const isAlt = rowIdx % 2 === 1;
          const brandNames = (loc.locationBrands || [])
            .map((lb: any) => lb.brand?.name)
            .filter(Boolean)
            .join(', ');
          const posNames = (loc.pos || []).map((p: any) => p.name || p.posId).join(', ');

          const rowData: Record<string, any> = {
            code: loc.code || '',
            shortCode: loc.shortCode || '',
            centerId: loc.centerId || '',
            name: loc.name || '',
            status: loc.status ? loc.status.toUpperCase() : 'ACTIVE',
            isStockLocation: loc.isStockLocation !== false ? 'Yes' : 'No',
            isOnline: loc.isOnline ? 'Online' : 'Offline',
            lastOnlineAt: loc.lastOnlineAt ? new Date(loc.lastOnlineAt) : null,

            phone: loc.phone || '',
            address: loc.address || '',
            cityName: loc.cityId ? cityMap[loc.cityId] || '' : '',
            latitude: loc.latitude ? Number(loc.latitude) : null,
            longitude: loc.longitude ? Number(loc.longitude) : null,
            geoFenceEnabled: loc.geoFenceEnabled ? 'Enabled' : 'Disabled',
            geoFenceRadius: Number(loc.geoFenceRadius ?? 100),
            ipWhitelist: loc.ipWhitelist || '',

            brands: brandNames,
            posCount: loc.pos?.length || 0,
            posNames: posNames,
            cashGLCode: loc.cashGLCode || '',
            fbrEnabled: loc.fbrEnabled ? 'Enabled' : 'Disabled',
            fbrBposId: loc.fbrBposId || '',
            fbrSellerName: loc.fbrSellerName || '',
            fbrNtn: loc.fbrNtn || '',

            createdAt: new Date(loc.createdAt),
            updatedAt: new Date(loc.updatedAt),
          };

          const dataRow = ws.getRow(rowIdx + 3);
          COLUMNS.forEach((col, colIdx) => {
            const cell = dataRow.getCell(colIdx + 1);
            cell.value = rowData[col.key] ?? null;
            if (col.numFmt) cell.numFmt = col.numFmt;
            cell.alignment = { horizontal: col.align ?? 'left', vertical: 'middle' };
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: `FF${isAlt ? ALT_ROW_BG : 'FFFFFF'}` },
            };
            cell.font = { size: 9 };
            cell.border = {
              top: { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
              left: { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
              bottom: { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
              right: { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
            };
          });
          dataRow.height = 16;
          dataRow.commit();
          rowIdx++;
        }

        processed += chunk.length;
        cursor = chunk[chunk.length - 1].id;

        const pct = total > 0 ? Math.round((processed / total) * 95) : 50;
        await job.progress(pct);
        await new Promise((r) => setImmediate(r));

        if (chunk.length < CHUNK) break;
      }

      // ── Summary sheet ────────────────────────────────────────────────────
      const summary = workbook.addWorksheet('Summary');
      summary.columns = [{ key: 'label', width: 28 }, { key: 'value', width: 26 }];

      const titleRow = summary.getRow(1);
      titleRow.getCell(1).value = 'Location Export Summary';
      titleRow.getCell(1).font = { bold: true, size: 14, color: { argb: 'FF1E293B' } };
      titleRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
      titleRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      titleRow.height = 28;
      titleRow.commit();

      const summaryRows = [
        ['Export Date', new Date().toLocaleString('en-PK')],
        ['Total Locations', rowIdx],
        ['Search Filter', search ?? '(none)'],
        ['Status Filter', status ?? '(all)'],
        ['Online Filter', isOnline ? (isOnline === 'true' ? 'Online' : 'Offline') : '(all)'],
        ['Stock Location Filter', isStockLocation ? (isStockLocation === 'true' ? 'Stock' : 'Non-Stock') : '(all)'],
      ];

      summaryRows.forEach(([label, value], idx) => {
        const r = summary.getRow(idx + 2);
        r.getCell(1).value = label;
        r.getCell(1).font = { bold: true, size: 10 };
        r.getCell(1).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: idx % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF' },
        };
        r.getCell(2).value = value;
        r.getCell(2).font = { size: 10 };
        r.getCell(2).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: idx % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF' },
        };
        r.height = 18;
        r.commit();
      });

      await workbook.commit();
      await job.progress(100);

      this.logger.log(`[LocationExport ${jobId}] File written (${rowIdx} rows)`);

      await this.notificationsService.create({
        userId,
        title: 'Location Export Ready',
        message: `Your export of ${rowIdx.toLocaleString()} location${rowIdx !== 1 ? 's' : ''} is ready to download.`,
        category: 'export',
        priority: 'high',
        actionType: 'location-export.ready',
        actionPayload: { jobId },
        entityType: 'location-export',
        entityId: jobId,
        channels: ['inApp'],
      });
    } catch (error: any) {
      this.logger.error(`[LocationExport ${jobId}] FAILED: ${error.message}`, error.stack);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

      await this.notificationsService.create({
        userId,
        title: 'Location Export Failed',
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
