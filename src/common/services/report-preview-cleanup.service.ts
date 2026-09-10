import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class ReportPreviewCleanupService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ReportPreviewCleanupService.name);
  private readonly previewStorageDir = path.join(process.cwd(), 'uploads', 'report-previews');
  
  // Default TTL: 2 hours (in milliseconds)
  private readonly DEFAULT_TTL_MS = 2 * 60 * 60 * 1000;

  async onApplicationBootstrap() {
    // Run an initial sweep on application startup to remove leftover stale chunks
    this.logger.log('[PreviewCleanup] Running startup cleanup sweep on preview chunks storage...');
    await this.cleanupExpiredPreviews();
  }

  /**
   * Periodic cron scheduled every 15 minutes.
   * Scans uploads/report-previews and deletes any chunk file older than the TTL.
   */
  @Cron('0 */15 * * * *')
  async handleScheduledCleanup() {
    await this.cleanupExpiredPreviews();
  }

  /**
   * Prune expired preview chunks based on file last modified time (mtime).
   * @param maxAgeMs Maximum age in milliseconds before a file is considered expired (default: 2 hours).
   */
  async cleanupExpiredPreviews(maxAgeMs: number = this.DEFAULT_TTL_MS): Promise<{ deletedCount: number; bytesFreed: number }> {
    if (!fs.existsSync(this.previewStorageDir)) {
      return { deletedCount: 0, bytesFreed: 0 };
    }

    let deletedCount = 0;
    let bytesFreed = 0;
    const now = Date.now();

    try {
      const files = await fs.promises.readdir(this.previewStorageDir);

      for (const file of files) {
        // Only target preview chunks (.gz, .json, .ndjson, .tmp)
        if (!file.includes('-preview-') && !file.endsWith('.gz') && !file.endsWith('.tmp')) {
          continue;
        }

        const filePath = path.join(this.previewStorageDir, file);
        try {
          const stats = await fs.promises.stat(filePath);
          const ageMs = now - stats.mtimeMs;

          if (ageMs > maxAgeMs) {
            bytesFreed += stats.size;
            await fs.promises.unlink(filePath);
            deletedCount++;
          }
        } catch (fileErr: any) {
          // File may have been removed concurrently or in use
          this.logger.debug(`[PreviewCleanup] Could not stat/unlink file ${file}: ${fileErr.message}`);
        }
      }

      if (deletedCount > 0) {
        const mbFreed = (bytesFreed / (1024 * 1024)).toFixed(2);
        this.logger.log(
          `[PreviewCleanup] Successfully pruned ${deletedCount} expired preview chunk(s), freeing ${mbFreed} MB of disk space.`,
        );
      }
    } catch (err: any) {
      this.logger.error(`[PreviewCleanup] Error during preview cleanup sweep: ${err.message}`, err.stack);
    }

    return { deletedCount, bytesFreed };
  }

  /**
   * Delete a specific preview job's file(s) immediately.
   * Useful when a user invalidates or refreshes a report.
   */
  async deletePreviewByJobId(jobId: string): Promise<boolean> {
    if (!jobId || !fs.existsSync(this.previewStorageDir)) return false;

    let deleted = false;
    try {
      const files = await fs.promises.readdir(this.previewStorageDir);
      for (const file of files) {
        if (file.includes(jobId)) {
          const filePath = path.join(this.previewStorageDir, file);
          await fs.promises.unlink(filePath).catch(() => null);
          deleted = true;
        }
      }
    } catch (err: any) {
      this.logger.warn(`[PreviewCleanup] Failed to delete preview for jobId ${jobId}: ${err.message}`);
    }

    return deleted;
  }
}
