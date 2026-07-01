import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import * as fs from 'fs';
import * as path from 'path';
import { UpdateExportDto } from './dto/export-history.dto';
import { UploadService } from '../../upload/upload.service';

@Injectable()
export class ExportHistoryService {
  private readonly logger = new Logger(ExportHistoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
  ) {}

  async completeAndUploadExport(
    tenantPrisma: any,
    jobId: string,
    localPath: string,
    fileName: string,
    mimeType: string,
  ): Promise<string> {
    const stats = fs.statSync(localPath);
    const buffer = fs.readFileSync(localPath);

    // Upload buffer to S3 / local storage via UploadService
    const uploadResult = await this.uploadService.uploadExportBuffer(buffer, fileName, mimeType);

    // Delete local temp file
    try {
      if (fs.existsSync(localPath)) {
        fs.unlinkSync(localPath);
        this.logger.log(`[ExportHistoryService] Cleaned up local temp file: ${localPath}`);
      }
    } catch (err: any) {
      this.logger.warn(`[ExportHistoryService] Could not delete temp local file ${localPath}: ${err.message}`);
    }

    // Update database record using tenantPrisma (since Bull jobs run outside tenant context)
    await tenantPrisma.exportHistory.update({
      where: { id: jobId },
      data: {
        status: 'COMPLETED',
        fileSize: stats.size,
        completedAt: new Date(),
        filePath: uploadResult.url,
      },
    });

    return uploadResult.url;
  }

  async failExport(tenantPrisma: any, jobId: string) {
    try {
      await tenantPrisma.exportHistory.update({
        where: { id: jobId },
        data: { status: 'FAILED' },
      });
    } catch (dbErr: any) {
      this.logger.warn(`[ExportHistoryService] Could not update export job status to FAILED in database: ${dbErr.message}`);
    }
  }


  async createFolder(userId: string, name: string) {
    return this.prisma.exportFolder.create({
      data: {
        name,
        userId,
      },
    });
  }

  async listFolders(userId: string) {
    return this.prisma.exportFolder.findMany({
      where: { userId },
      include: {
        _count: {
          select: { exports: true },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async renameFolder(userId: string, folderId: string, name: string) {
    const folder = await this.prisma.exportFolder.findFirst({
      where: { id: folderId, userId },
    });
    if (!folder) {
      throw new NotFoundException(`Folder not found`);
    }
    return this.prisma.exportFolder.update({
      where: { id: folderId },
      data: { name },
    });
  }

  async deleteFolder(userId: string, folderId: string) {
    const folder = await this.prisma.exportFolder.findFirst({
      where: { id: folderId, userId },
    });
    if (!folder) {
      throw new NotFoundException(`Folder not found`);
    }
    return this.prisma.exportFolder.delete({
      where: { id: folderId },
    });
  }

  async listExports(
    userId: string,
    filters: {
      folderId?: string | null;
      isFavorite?: boolean;
      search?: string;
      moduleName?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const whereClause: any = { userId };

    if (filters.isFavorite !== undefined) {
      whereClause.isFavorite = filters.isFavorite;
    }

    if (filters.moduleName) {
      whereClause.moduleName = filters.moduleName;
    }

    if (filters.search) {
      whereClause.fileName = {
        contains: filters.search,
        mode: 'insensitive',
      };
    }

    if (filters.folderId !== undefined) {
      if (filters.folderId === 'null' || filters.folderId === 'root' || filters.folderId === null) {
        whereClause.folderId = null;
      } else {
        whereClause.folderId = filters.folderId;
      }
    }

    const page = Math.max(1, filters.page || 1);
    const limit = Math.max(1, filters.limit || 10);
    const skip = (page - 1) * limit;

    const [totalCount, records] = await Promise.all([
      this.prisma.exportHistory.count({ where: whereClause }),
      this.prisma.exportHistory.findMany({
        where: whereClause,
        include: {
          folder: {
            select: { id: true, name: true }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      data: records,
      meta: {
        totalCount,
        page,
        limit,
        totalPages: Math.ceil(totalCount / limit),
      },
    };
  }

  async updateExport(userId: string, exportId: string, data: UpdateExportDto) {
    const record = await this.prisma.exportHistory.findFirst({
      where: { id: exportId, userId },
    });
    if (!record) {
      throw new NotFoundException(`Export history record not found`);
    }

    const updateData: any = {};

    if (data.isFavorite !== undefined) {
      updateData.isFavorite = data.isFavorite;
    }

    if (data.folderId !== undefined) {
      if (data.folderId === null || data.folderId === 'null' || data.folderId === 'root') {
        updateData.folderId = null;
      } else {
        const folder = await this.prisma.exportFolder.findFirst({
          where: { id: data.folderId, userId },
        });
        if (!folder) {
          throw new NotFoundException(`Target folder not found`);
        }
        updateData.folderId = data.folderId;
      }
    }

    if (data.fileName) {
      const originalExt = path.extname(record.fileName);
      let newName = data.fileName;
      const newExt = path.extname(newName);
      if (newExt !== originalExt) {
        newName = newName + originalExt;
      }
      updateData.fileName = newName;
    }

    return this.prisma.exportHistory.update({
      where: { id: exportId },
      data: updateData,
    });
  }

  async deleteExport(userId: string, exportId: string) {
    const record = await this.prisma.exportHistory.findFirst({
      where: { id: exportId, userId },
    });
    if (!record) {
      throw new NotFoundException(`Export history record not found`);
    }

    const result = await this.prisma.exportHistory.delete({
      where: { id: exportId },
    });

    if (record.filePath) {
      if (record.filePath.startsWith('s3://')) {
        const s3Key = record.filePath.replace('s3://', '');
        await this.uploadService.deleteS3Object(s3Key);
      } else if (record.filePath.startsWith('http://') || record.filePath.startsWith('https://')) {
        const cdnHost = process.env.AWS_S3_CDN_URL || process.env.CDN_URL;
        let s3Key: string | null = null;
        if (cdnHost && record.filePath.includes(cdnHost)) {
          s3Key = record.filePath.split(cdnHost).pop()?.replace(/^\//, '') || null;
        } else if (record.filePath.includes('.amazonaws.com/')) {
          s3Key = record.filePath.split('.amazonaws.com/').pop() || null;
        }
        if (s3Key) {
          await this.uploadService.deleteS3Object(s3Key);
        }
      } else {
        const fullPath = path.isAbsolute(record.filePath)
          ? record.filePath
          : path.join(process.cwd(), record.filePath);
        
        try {
          if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
            this.logger.log(`Deleted export file on disk: ${fullPath}`);
          }
        } catch (err: any) {
          this.logger.warn(`Could not delete file ${fullPath}: ${err.message}`);
        }
      }
    }

    return result;
  }

  async downloadExport(userId: string, exportId: string, res: any, query?: { inline?: boolean }) {
    const record = await this.prisma.exportHistory.findFirst({
      where: { id: exportId, userId },
    });
    if (!record) {
      throw new NotFoundException(`Export record not found`);
    }

    try {
      await this.prisma.exportHistory.update({
        where: { id: exportId },
        data: {
          downloadCount: { increment: 1 },
        },
      });
    } catch (err: any) {
      this.logger.warn(`Could not update export download count: ${err.message}`);
    }

    if (record.filePath.startsWith('s3://')) {
      const s3Key = record.filePath.replace('s3://', '');
      const signedUrl = await this.uploadService.getSignedUrlForDownload(s3Key);
      return res.redirect(signedUrl, 302);
    }

    if (record.filePath.startsWith('http://') || record.filePath.startsWith('https://')) {
      return res.redirect(record.filePath, 302);
    }

    const filePath = path.isAbsolute(record.filePath)
      ? record.filePath
      : path.join(process.cwd(), record.filePath);

    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('Export file not found on server disk.');
    }

    const stat = fs.statSync(filePath);

    const isPdf = record.fileName.endsWith('.pdf');
    const isXlsx = record.fileName.endsWith('.xlsx');
    
    let contentType = 'application/octet-stream';
    if (isPdf) {
      contentType = 'application/pdf';
    } else if (isXlsx) {
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    }

    const disposition = query?.inline ? 'inline' : 'attachment';

    res.header('Content-Type', contentType);
    res.header('Content-Disposition', `${disposition}; filename="${record.fileName}"`);
    res.header('Content-Length', stat.size);
    res.header('Cache-Control', 'no-cache, no-store, must-revalidate');

    const stream = fs.createReadStream(filePath);
    stream.on('error', (err) => {
      this.logger.error(`[ExportHistoryDownload] Stream error: ${err.message}`);
    });
    res.send(stream);
  }

  async bulkDelete(userId: string, ids: string[]) {
    const records = await this.prisma.exportHistory.findMany({
      where: {
        id: { in: ids },
        userId,
      },
      select: { id: true, filePath: true },
    });

    if (records.length === 0) return { deletedCount: 0 };

    const deleteResult = await this.prisma.exportHistory.deleteMany({
      where: {
        id: { in: records.map(r => r.id) },
        userId,
      },
    });

    for (const record of records) {
      if (record.filePath) {
        if (record.filePath.startsWith('s3://')) {
          const s3Key = record.filePath.replace('s3://', '');
          await this.uploadService.deleteS3Object(s3Key);
        } else if (record.filePath.startsWith('http://') || record.filePath.startsWith('https://')) {
          const cdnHost = process.env.AWS_S3_CDN_URL || process.env.CDN_URL;
          let s3Key: string | null = null;
          if (cdnHost && record.filePath.includes(cdnHost)) {
            s3Key = record.filePath.split(cdnHost).pop()?.replace(/^\//, '') || null;
          } else if (record.filePath.includes('.amazonaws.com/')) {
            s3Key = record.filePath.split('.amazonaws.com/').pop() || null;
          }
          if (s3Key) {
            await this.uploadService.deleteS3Object(s3Key);
          }
        } else {
          const fullPath = path.isAbsolute(record.filePath)
            ? record.filePath
            : path.join(process.cwd(), record.filePath);
          try {
            if (fs.existsSync(fullPath)) {
              fs.unlinkSync(fullPath);
              this.logger.log(`[BulkDelete] Deleted file from disk: ${fullPath}`);
            }
          } catch (err: any) {
            this.logger.warn(`[BulkDelete] Could not delete file ${fullPath}: ${err.message}`);
          }
        }
      }
    }

    return { deletedCount: deleteResult.count };
  }

  async bulkMove(userId: string, ids: string[], folderId: string | null) {
    let destFolderId: string | null = null;
    
    if (folderId !== null && folderId !== 'null' && folderId !== 'root') {
      const folder = await this.prisma.exportFolder.findFirst({
        where: { id: folderId, userId },
      });
      if (!folder) {
        throw new NotFoundException(`Target folder not found`);
      }
      destFolderId = folderId;
    }

    const updateResult = await this.prisma.exportHistory.updateMany({
      where: {
        id: { in: ids },
        userId,
      },
      data: {
        folderId: destFolderId,
      },
    });

    return { movedCount: updateResult.count };
  }

  async bulkRename(userId: string, ids: string[], baseName: string) {
    const records = await this.prisma.exportHistory.findMany({
      where: {
        id: { in: ids },
        userId,
      },
      select: { id: true, fileName: true },
    });

    let renamedCount = 0;

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const originalExt = path.extname(record.fileName);
      const newName = `${baseName} (${i + 1})${originalExt}`;
      
      await this.prisma.exportHistory.update({
        where: { id: record.id },
        data: { fileName: newName },
      });
      renamedCount++;
    }

    return { renamedCount };
  }
}

