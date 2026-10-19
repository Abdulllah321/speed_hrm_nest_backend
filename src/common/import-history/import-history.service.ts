import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../database/prisma.service';
import { ListImportsQueryDto } from './dto/import-history.dto';

// Human-readable label map for module names
const MODULE_LABELS: Record<string, string> = {
  ITEMS: 'Items',
  ITEMS_UPDATE: 'Items Update',
  COA: 'Chart of Accounts',
  STOCK: 'Stock Upload',
  CUSTOMERS: 'Customers',
  MERCHANTS: 'Merchants',
  ALLIANCES: 'Alliances',
  PURCHASE_ORDERS: 'Purchase Orders',
  SRN: 'Stock Requisition Notes',
  SALES_HISTORY: 'Sales History',
  HS_CODES: 'HS Codes',
  UNKNOWN: 'Unknown',
};

@Injectable()
export class ImportHistoryService {
  private readonly logger = new Logger(ImportHistoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  async listImports(userId: string, query: ListImportsQueryDto) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.max(1, Math.min(100, query.limit ?? 20));
    const skip = (page - 1) * limit;

    const where: any = { uploadedBy: userId };

    if (query.moduleName) {
      where.moduleName = query.moduleName.toUpperCase();
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.search) {
      where.filename = { contains: query.search, mode: 'insensitive' };
    }

    const [totalCount, records] = await Promise.all([
      this.prisma.bulkUpload.count({ where }),
      this.prisma.bulkUpload.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          filename: true,
          moduleName: true,
          status: true,
          totalRecords: true,
          processedRecords: true,
          successRecords: true,
          failedRecords: true,
          skippedRecords: true,
          message: true,
          createdAt: true,
          completedAt: true,
        },
      }),
    ]);

    const data = records.map((r) => ({
      ...r,
      moduleLabel: MODULE_LABELS[r.moduleName] ?? r.moduleName,
    }));

    return {
      data,
      meta: {
        totalCount,
        page,
        limit,
        totalPages: Math.ceil(totalCount / limit),
      },
    };
  }

  async getImportDetail(userId: string, uploadId: string) {
    const record = await this.prisma.bulkUpload.findFirst({
      where: { id: uploadId, uploadedBy: userId },
    });

    if (!record) {
      throw new NotFoundException(`Import record ${uploadId} not found`);
    }

    return {
      ...record,
      moduleLabel: MODULE_LABELS[record.moduleName] ?? record.moduleName,
    };
  }

  async streamErrorReport(userId: string, uploadId: string, res: any) {
    const record = await this.prisma.bulkUpload.findFirst({
      where: { id: uploadId, uploadedBy: userId },
      select: { id: true, filename: true, errorReportPath: true, errors: true, moduleName: true },
    });

    if (!record) {
      throw new NotFoundException(`Import record ${uploadId} not found`);
    }

    // 1. Try the saved error-report file path first
    if (record.errorReportPath) {
      const filePath = path.isAbsolute(record.errorReportPath)
        ? record.errorReportPath
        : path.join(process.cwd(), record.errorReportPath);

      if (fs.existsSync(filePath)) {
        res.header('Content-Type', 'text/csv');
        res.header(
          'Content-Disposition',
          `attachment; filename="import-errors-${uploadId}.csv"`,
        );
        const stream = fs.createReadStream(filePath);
        stream.pipe(res);
        return;
      }
    }

    // 2. Fall back to inline errors JSON → CSV
    const errors: any[] = Array.isArray(record.errors) ? record.errors : [];
    let csv = 'Row,Field,Reason,Value\n';
    errors.forEach((e) => {
      const row = e.row ?? 'N/A';
      const field = e.field ?? e.data?.field ?? 'N/A';
      const reason = String(e.reason ?? '').replace(/"/g, '""');
      const value = e.value ?? e.data?.value ?? 'N/A';
      csv += `${row},${field},"${reason}",${value}\n`;
    });

    res.header('Content-Type', 'text/csv');
    res.header(
      'Content-Disposition',
      `attachment; filename="import-errors-${uploadId}.csv"`,
    );
    res.status(200).send(csv);
  }

  getAvailableModules() {
    return Object.entries(MODULE_LABELS)
      .filter(([key]) => key !== 'UNKNOWN')
      .map(([key, label]) => ({ value: key, label }));
  }
}
