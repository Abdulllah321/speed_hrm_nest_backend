import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import type { MultipartFile } from '@fastify/multipart';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import sharp from 'sharp';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PrismaService } from '../database/prisma.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { runInBackground } from '../common/utils/run-in-background.util';

// ---------------------------------------------------------------------------
// Storage strategy — resolved once at startup from env vars
// ---------------------------------------------------------------------------
const USE_S3 =
  !!process.env.AWS_S3_BUCKET &&
  !!process.env.AWS_ACCESS_KEY_ID &&
  !!process.env.AWS_SECRET_ACCESS_KEY;

let s3Client: S3Client | null = null;

if (USE_S3) {
  s3Client = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
    // Support S3-compatible providers (MinIO, Cloudflare R2, DigitalOcean Spaces, etc.)
    ...(process.env.AWS_S3_ENDPOINT
      ? { endpoint: process.env.AWS_S3_ENDPOINT, forcePathStyle: true }
      : {}),
  });
}

const S3_BUCKET = process.env.AWS_S3_BUCKET || '';
const S3_KEY_PREFIX = process.env.AWS_S3_KEY_PREFIX || 'uploads';
// Signed URL expiry for private buckets (seconds). Default 7 days.
const SIGNED_URL_EXPIRES = parseInt(process.env.AWS_S3_SIGNED_URL_EXPIRES || '604800', 10);
// Set to 'true' if your bucket/objects are publicly accessible (no signed URLs needed)
const S3_PUBLIC = process.env.AWS_S3_PUBLIC === 'true';

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);
  private readonly uploadRoot = path.join(process.cwd(), 'public', 'uploads');

  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLogs: ActivityLogsService,
  ) {
    if (!USE_S3 && !fs.existsSync(this.uploadRoot)) {
      fs.mkdirSync(this.uploadRoot, { recursive: true });
    }

    this.logger.log(
      USE_S3
        ? `Storage: S3 — bucket=${S3_BUCKET}, prefix=${S3_KEY_PREFIX}, public=${S3_PUBLIC}`
        : 'Storage: local disk',
    );
  }

  // ---------------------------------------------------------------------------
  // Upload
  // ---------------------------------------------------------------------------
  async uploadFile(
    file: MultipartFile,
    createdById: string | null = null,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    const ts = Date.now();
    const safeFilename = file.filename.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const filename = `${ts}_${safeFilename}`;

    // Read buffer once
    const buffer = await file.toBuffer();
    let finalBuffer = buffer;
    let finalMimetype = file.mimetype;
    let finalFilename = file.filename;

    // Optimise images with sharp
    if (file.mimetype.startsWith('image/')) {
      try {
        finalBuffer = await sharp(buffer)
          .rotate()
          .jpeg({ quality: 85 })
          .toBuffer();
        finalMimetype = 'image/jpeg';
        // Ensure the stored filename reflects the converted format
        finalFilename = safeFilename.replace(/\.[^.]+$/, '.jpg');
      } catch (e) {
        this.logger.warn('Image post-process failed, using original:', e);
        finalBuffer = buffer;
      }
    }

    let storedPath: string;
    let publicUrl: string | null = null;

    if (USE_S3) {
      const s3Key = `${S3_KEY_PREFIX}/${filename}`;
      await s3Client!.send(
        new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: s3Key,
          Body: finalBuffer,
          ContentType: finalMimetype,
          ContentDisposition: `inline; filename="${finalFilename}"`,
          // Cache aggressively — files are immutable (timestamp-prefixed)
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
      storedPath = s3Key; // store the S3 key in DB
      if (S3_PUBLIC) {
        // Public bucket: construct direct URL
        const endpoint = process.env.AWS_S3_ENDPOINT;
        publicUrl = endpoint
          ? `${endpoint}/${S3_BUCKET}/${s3Key}`
          : `https://${S3_BUCKET}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${s3Key}`;
      }
    } else {
      const fullPath = path.join(this.uploadRoot, filename);
      storedPath = path.join('uploads', filename);
      fs.writeFileSync(fullPath, finalBuffer);
    }

    const record = await this.prisma.fileUpload.create({
      data: {
        filename: finalFilename,
        mimetype: finalMimetype,
        size: finalBuffer.length,
        path: storedPath,
        createdById,
      },
      select: {
        id: true,
        filename: true,
        mimetype: true,
        size: true,
        createdAt: true,
        path: true,
      },
    });
    // Resolve the URL to return to the caller
    // The frontend base URL already includes /api, so return a path without it
    const fileUrl = publicUrl ? publicUrl: `/uploads/${record.id}`;

    runInBackground(
      'Upload File',
      this.activityLogs.log({
        userId: ctx?.userId || createdById || undefined,
        action: 'create',
        module: 'uploads',
        entity: 'FileUpload',
        entityId: record.id,
        description: `Uploaded file ${record.filename}`,
        newValues: JSON.stringify({ filename: record.filename, size: record.size }),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'success',
      }),
    );

    return {
      status: true,
      data: {
        id: record.id,
        url: fileUrl,
        filename: record.filename,
        mimetype: record.mimetype,
        size: record.size,
        createdAt: record.createdAt,
      },
    };
  }

  async uploadMultiple(
    files: MultipartFile[],
    createdById: string | null = null,
  ) {
    const results = await Promise.all(
      files.map((file) => this.uploadFile(file, createdById)),
    );
    return results;
  }

  // ---------------------------------------------------------------------------
  // List
  // ---------------------------------------------------------------------------
  async listUploads() {
    return this.prisma.fileUpload.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        filename: true,
        mimetype: true,
        size: true,
        createdAt: true,
        createdById: true,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Get metadata
  // ---------------------------------------------------------------------------
  async getUpload(id: string) {
    return this.prisma.fileUpload.findUnique({ where: { id } });
  }

  // ---------------------------------------------------------------------------
  // Stream / download
  // ---------------------------------------------------------------------------
  async downloadUpload(id: string): Promise<{ item: any; stream: Readable; url?: string }> {
    const item = await this.prisma.fileUpload.findUnique({ where: { id } });
    if (!item || !item.path) throw new NotFoundException('File not found');

    if (USE_S3) {
      if (S3_PUBLIC) {
        // For public buckets, redirect instead of proxying
        const endpoint = process.env.AWS_S3_ENDPOINT;
        const url = endpoint
          ? `${endpoint}/${S3_BUCKET}/${item.path}`
          : `https://${S3_BUCKET}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${item.path}`;
        return { item, stream: Readable.from([]), url };
      }

      // Private bucket: generate a signed URL and stream via it
      const signedUrl = await getSignedUrl(
        s3Client!,
        new GetObjectCommand({ Bucket: S3_BUCKET, Key: item.path ?? undefined }),
        { expiresIn: SIGNED_URL_EXPIRES },
      );
      return { item, stream: Readable.from([]), url: signedUrl };
    }

    // Local disk
    const absPath = path.join(this.uploadRoot, path.basename(item.path));
    if (!fs.existsSync(absPath)) throw new NotFoundException('File not found on disk');
    return { item, stream: fs.createReadStream(absPath) };
  }

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------
  async deleteUpload(
    id: string,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    const item = await this.prisma.fileUpload.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('File not found');

    if (USE_S3) {
      try {
        await s3Client!.send(
          new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: item.path ?? undefined }),
        );
      } catch (e) {
        this.logger.error(`Failed to delete S3 object ${item.path}:`, e);
      }
    } else if (item.path) {
      const absPath = path.join(this.uploadRoot, path.basename(item.path));
      if (fs.existsSync(absPath)) {
        try {
          fs.unlinkSync(absPath);
        } catch (e) {
          this.logger.error('Error deleting file from disk:', e);
        }
      }
    }

    await this.prisma.fileUpload.delete({ where: { id } });

    runInBackground(
      'Delete Upload',
      this.activityLogs.log({
        userId: ctx?.userId,
        action: 'delete',
        module: 'uploads',
        entity: 'FileUpload',
        entityId: item.id,
        description: `Deleted file ${item.filename}`,
        oldValues: JSON.stringify(item),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'success',
      }),
    );

    return { status: true, message: 'File deleted successfully' };
  }
}
