import { Injectable, NotFoundException } from '@nestjs/common';
import { MultipartFile } from 'fastify-multipart';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UploadService {
  private readonly uploadRoot = path.join(process.cwd(), 'public', 'uploads');

  constructor(private readonly prisma: PrismaService) {
    if (!fs.existsSync(this.uploadRoot)) {
      fs.mkdirSync(this.uploadRoot, { recursive: true });
    }
  }

  async uploadFile(file: MultipartFile, createdById: string | null = null) {
    const ts = Date.now();
    const safeFilename = file.filename.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const filename = `${ts}_${safeFilename}`;
    const fullPath = path.join(this.uploadRoot, filename);
    const relativePath = path.join('uploads', filename);

    await new Promise<void>((resolve, reject) => {
      const writeStream = fs.createWriteStream(fullPath);
      file.file.pipe(writeStream);
      writeStream.on('finish', () => resolve());
      writeStream.on('error', reject);
    });

    let finalSize = 0;
    const buffer = await file.toBuffer();
    finalSize = buffer.length;

    if (file.mimetype.startsWith('image/')) {
      try {
        const processedBuffer = await sharp(buffer)
          .rotate()
          .jpeg({ quality: 85 })
          .toBuffer();
        fs.writeFileSync(fullPath, processedBuffer);
        finalSize = processedBuffer.length;
      } catch (e) {
        console.warn('Image post-process failed:', e);
      }
    }

    const record = await this.prisma.fileUpload.create({
      data: {
        filename: file.filename,
        mimetype: file.mimetype,
        size: finalSize,
        path: relativePath,
        createdById: createdById,
      },
      select: { id: true, filename: true, mimetype: true, size: true, createdAt: true },
    });

    return record;
  }

  async uploadMultiple(files: MultipartFile[], createdById: string | null = null) {
    const uploadedRecords = await Promise.all(
      files.map((file) => this.uploadFile(file, createdById))
    );
    return uploadedRecords;
  }

  async listUploads() {
    return this.prisma.fileUpload.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, filename: true, mimetype: true, size: true, createdAt: true, createdById: true },
    });
  }

  async getUpload(id: string) {
    return this.prisma.fileUpload.findUnique({ where: { id } });
  }

  async downloadUpload(id: string) {
    const item = await this.prisma.fileUpload.findUnique({ where: { id } });
    if (!item || !item.path) throw new NotFoundException('File not found');

    const absPath = path.join(this.uploadRoot, path.basename(item.path));
    if (!fs.existsSync(absPath)) throw new NotFoundException('File not found on disk');

    return { item, stream: fs.createReadStream(absPath) };
  }

  async deleteUpload(id: string) {
    const item = await this.prisma.fileUpload.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('File not found');

    if (item.path) {
      const absPath = path.join(this.uploadRoot, path.basename(item.path));
      if (fs.existsSync(absPath)) {
        try {
          fs.unlinkSync(absPath);
        } catch (e) {
          console.error('Error deleting file from disk:', e);
        }
      }
    }
    await this.prisma.fileUpload.delete({ where: { id } });
    return { status: true, message: 'File deleted successfully' };
  }
}
