import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

export interface MerchantExportJobData {
    jobId: string;
    userId: string;
    tenantId: string;
    tenantDbUrl: string;
    search?: string;
    locationId?: string;
    bankName?: string;
    isActive?: boolean;
}

// ── Colour palette ─────────────────────────────────────────────────────────────
const SUBHEADER_BG = '1E3A5F';
const SUBHEADER_FG = 'F1F5F9';
const ALT_ROW_BG   = 'F0F4F8';
const BORDER_COLOR = 'CBD5E1';
const ACTIVE_FG    = '15803D';
const INACTIVE_FG  = 'B91C1C';

const COLUMNS: {
    header: string;
    key: string;
    width: number;
    numFmt?: string;
    align?: ExcelJS.Alignment['horizontal'];
}[] = [
    { header: 'Cost Centre',            key: 'costCentreTag',         width: 25 },
    { header: 'Tag ID',                  key: 'tagId',                 width: 14, align: 'center' },
    { header: 'Description',             key: 'description',           width: 32 },
    { header: 'Bank',                    key: 'bankName',              width: 18 },
    { header: 'Merchant code',           key: 'merchantCode',          width: 15, align: 'center' },
    { header: 'Commission Rate Decimal', key: 'commissionRateDecimal', width: 24, numFmt: '0.00000', align: 'right' },
    { header: 'Commission Rate %',       key: 'commissionRatePercent', width: 20, align: 'right' },
    { header: 'Bank GL Code',            key: 'bankGlCode',            width: 18, align: 'center' },
    { header: 'Status',                  key: 'status',                width: 12, align: 'center' },
    { header: 'Created At',              key: 'createdAt',             width: 20, numFmt: 'dd-mmm-yyyy hh:mm', align: 'center' },
    { header: 'Updated At',              key: 'updatedAt',             width: 20, numFmt: 'dd-mmm-yyyy hh:mm', align: 'center' },
];

@Processor('merchant-export')
export class MerchantExportProcessor {
    private readonly logger = new Logger(MerchantExportProcessor.name);

    constructor(
        private readonly notificationsService: NotificationsService,
    ) { }

    @Process()
    async handleExport(job: Job<MerchantExportJobData>): Promise<void> {
        const { jobId, userId, tenantId, tenantDbUrl, search, locationId, bankName, isActive } = job.data;

        this.logger.log(`[MerchantExport ${jobId}] Starting for user ${userId}`);

        const prisma = new PrismaService({ tenantId, tenantDbUrl } as any);

        const exportDir = path.join(process.cwd(), 'uploads', 'exports');
        fs.mkdirSync(exportDir, { recursive: true });
        const filePath = path.join(exportDir, `export-${jobId}.xlsx`);

        try {
            // ── Build WHERE ──────────────────────────────────────────────────────
            const andClauses: any[] = [];
            if (search) {
                const t = search.trim();
                andClauses.push({
                    OR: [
                        { description: { contains: t, mode: 'insensitive' } },
                        { tagId: { contains: t, mode: 'insensitive' } },
                        { bankName: { contains: t, mode: 'insensitive' } },
                        { bankGlCode: { contains: t, mode: 'insensitive' } },
                    ],
                });
            }
            if (bankName) {
                andClauses.push({ bankName: { contains: bankName, mode: 'insensitive' } });
            }
            if (locationId) {
                andClauses.push({
                    locations: {
                        some: { locationId },
                    },
                });
            }
            if (isActive !== undefined) {
                andClauses.push({ isActive });
            }
            const where: any = andClauses.length ? { AND: andClauses } : {};

            const total = await prisma.merchantConfig.count({ where });
            this.logger.log(`[MerchantExport ${jobId}] ${total} rows to export`);

            // ── Streaming workbook writer ────────────────────────────────────────
            const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
                filename: filePath,
                useStyles: true,
                useSharedStrings: false,
            });

            const ws = workbook.addWorksheet('Merchants', {
                pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
                views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
            });

            ws.columns = COLUMNS.map((c) => ({ key: c.key, width: c.width }));

            // ── Header Row ───────────────────────────────────────────────────────
            const headerRow = ws.getRow(1);
            COLUMNS.forEach((col, idx) => {
                const cell = headerRow.getCell(idx + 1);
                cell.value = col.header;
                cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: `FF${SUBHEADER_BG}` },
                };
                cell.alignment = { horizontal: col.align ?? 'left', vertical: 'middle' };
                cell.border = {
                    top: { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
                    left: { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
                    bottom: { style: 'medium', color: { argb: 'FF000000' } },
                    right: { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
                };
            });
            headerRow.height = 24;
            headerRow.commit();

            // ── Fetch and Stream Rows ─────────────────────────────────────────────
            const CHUNK = 500;
            let cursor: string | undefined = undefined;
            let processed = 0;
            let rowIdx = 0;

            while (true) {
                const chunk: any[] = await prisma.merchantConfig.findMany({
                    where,
                    orderBy: { id: 'asc' },
                    take: CHUNK,
                    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
                });

                if (chunk.length === 0) break;

                for (const merchant of chunk) {
                    const isAlt = rowIdx % 2 === 1;
                    const decimalRate = Number(merchant.commissionRate || 0);
                    const percentRate = `${(decimalRate * 100).toFixed(3)}%`;

                    const rowData: Record<string, any> = {
                        costCentreTag: merchant.costCentreTag,
                        tagId: merchant.tagId,
                        description: merchant.description,
                        bankName: merchant.bankName,
                        merchantCode: merchant.merchantCode,
                        commissionRateDecimal: decimalRate,
                        commissionRatePercent: percentRate,
                        bankGlCode: merchant.bankGlCode,
                        status: merchant.isActive ? 'Active' : 'Inactive',
                        createdAt: new Date(merchant.createdAt),
                        updatedAt: new Date(merchant.updatedAt),
                    };

                    const dataRow = ws.getRow(rowIdx + 2);
                    COLUMNS.forEach((col, colIdx) => {
                        const cell = dataRow.getCell(colIdx + 1);
                        cell.value = rowData[col.key] ?? null;
                        if (col.numFmt) cell.numFmt = col.numFmt;
                        cell.alignment = { horizontal: col.align ?? 'left', vertical: 'middle' };
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${isAlt ? ALT_ROW_BG : 'FFFFFF'}` } };

                        if (col.key === 'status') {
                            cell.font = { bold: true, size: 9, color: { argb: merchant.isActive ? `FF${ACTIVE_FG}` : `FF${INACTIVE_FG}` } };
                        } else {
                            cell.font = { size: 9 };
                        }

                        cell.border = {
                            top: { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
                            left: { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
                            bottom: { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
                            right: { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
                        };
                    });
                    dataRow.height = 18;
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

            // ── Summary Sheet ─────────────────────────────────────────────────────
            const summary = workbook.addWorksheet('Summary');
            summary.columns = [{ key: 'label', width: 28 }, { key: 'value', width: 22 }];

            const titleRow = summary.getRow(1);
            titleRow.getCell(1).value = 'Merchant Export Summary';
            titleRow.getCell(1).font = { bold: true, size: 14, color: { argb: 'FF1E293B' } };
            titleRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
            titleRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
            titleRow.height = 28;
            titleRow.commit();

            const summaryRows = [
                ['Export Date', new Date().toLocaleString('en-PK')],
                ['Total Merchants', rowIdx],
                ['Search Filter', search ?? '(none)'],
                ['Location Filter', locationId ?? '(all)'],
                ['Bank Name Filter', bankName ?? '(all)'],
                ['Status Filter', isActive === undefined ? '(all)' : (isActive ? 'Active Only' : 'Inactive Only')],
            ];

            summaryRows.forEach(([label, value], idx) => {
                const r = summary.getRow(idx + 2);
                r.getCell(1).value = label;
                r.getCell(1).font = { bold: true, size: 10 };
                r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: idx % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF' } };
                r.getCell(2).value = value;
                r.getCell(2).font = { size: 10 };
                r.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: idx % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF' } };
                r.height = 18;
                r.commit();
            });

            await workbook.commit();
            await job.progress(100);

            this.logger.log(`[MerchantExport ${jobId}] File written (${rowIdx} rows)`);

            await this.notificationsService.create({
                userId,
                title: 'Merchant Export Ready',
                message: `Your export of ${rowIdx.toLocaleString()} merchant config${rowIdx !== 1 ? 's' : ''} is ready to download.`,
                category: 'export',
                priority: 'high',
                actionType: 'merchant-export.ready',
                actionPayload: { jobId },
                entityType: 'merchant-export',
                entityId: jobId,
                channels: ['inApp'],
            });

        } catch (error: any) {
            this.logger.error(`[MerchantExport ${jobId}] FAILED: ${error.message}`, error.stack);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

            await this.notificationsService.create({
                userId,
                title: 'Merchant Export Failed',
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
