import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { PrismaService } from '../../database/prisma.service';
import {
  CsvParserService,
  ParsedRecord,
} from '../../common/services/csv-parser.service';
import { MasterDataService } from '../../common/services/master-data.service';
import { ItemValidatorService } from '../../common/services/item-validator.service';
import { UploadEventsService } from '../../finance/item/upload-events.service';
import { NotificationsService } from '../../notifications/notifications.service';
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';

export interface UploadJobData {
  uploadId: string;
  fileBuffer: Buffer;
  filename: string;
  userId: string;
  tenantId: string;
  tenantDbUrl: string;
}

export interface UploadProgress {
  totalRecords: number;
  processedRecords: number;
  successRecords: number;
  failedRecords: number;
  skippedRecords: number;
  recsPerSec?: number;
  memoryUsageMB?: number;
  errors: Array<{
    row: number;
    reason: string;
    data: any;
  }>;
}

@Processor('item-upload')
export class UploadProcessor {
  private readonly logger = new Logger(UploadProcessor.name);

  constructor(
    private readonly csvParser: CsvParserService,
    private readonly validator: ItemValidatorService,
    private readonly eventsService: UploadEventsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @Process()
  async handleUpload(job: Job<any>): Promise<void> {
    let {
      uploadId,
      fileBuffer,
      filename,
      userId,
      tenantId,
      tenantDbUrl,
      mode,
    } = job.data;
    mode = mode || 'import';

    this.logger.log(
      `[Job ${job.id}] ${mode.toUpperCase()} phase started for ${filename} (Upload ID: ${uploadId})`,
    );

    const prisma = new PrismaService({ tenantId, tenantDbUrl } as any);
    const tenantMasterData = new MasterDataService(prisma);

    // Resolve file path once — used by both validate and import modes
    const ext = filename.split('.').pop();
    const filePath = path.join(
      process.cwd(),
      'uploads',
      'bulk',
      `upload-${uploadId}.${ext}`,
    );
    if (!fs.existsSync(filePath)) {
      this.logger.error(`[Job ${job.id}] File not found on disk: ${filePath}`);
      throw new Error(`Upload file not found on disk at ${filePath}`);
    }

    try {
      await prisma.bulkUpload.update({
        where: { id: uploadId },
        data: { status: mode === 'validate' ? 'validating' : 'processing' },
      });

      // Heartbeat — fires immediately so the client unfreezes before any parsing begins
      this.eventsService.emit({
        uploadId,
        type: 'status',
        data: {
          status: mode === 'validate' ? 'validating' : 'processing',
          message:
            mode === 'validate' ? 'Reading file...' : 'Starting Import...',
          progress: 1,
        },
      });

      const progress: UploadProgress = {
        totalRecords: 0,
        processedRecords: 0,
        successRecords: 0,
        failedRecords: 0,
        skippedRecords: 0,
        errors: [],
      };

      let totalRecordsCount = 0;
      let successRecordsCount = 0;
      let lastEmitTime = Date.now();
      const itemIdSet = new Set<string>();
      const carryOverItemIds = new Set<string>();
      const newItemIds = new Set<string>();

      if (mode === 'import') {
        // Stage 2: Streaming Batch Import
        this.logger.log(
          `[Job ${job.id}] Starting Streaming Import for ${uploadId}`,
        );

        // Pre-warm master data cache — turns all getOrCreate calls into sync hits
        await tenantMasterData.warmCache();

        // Load existing validation errors from DB to know which rows to skip
        const uploadRecord = await prisma.bulkUpload.findUnique({
          where: { id: uploadId },
          select: { errors: true, totalRecords: true },
        });

        const allValidationErrors = (
          Array.isArray(uploadRecord?.errors) ? uploadRecord.errors : []
        ) as any[];
        const invalidRows = new Set(allValidationErrors.map((e) => e.row));
        const totalToBeProcessed =
          (uploadRecord?.totalRecords || 0) - invalidRows.size;

        progress.totalRecords = uploadRecord?.totalRecords || 0;
        progress.failedRecords = invalidRows.size;
        progress.errors = allValidationErrors.map((e) => ({
          row: e.row,
          reason: `${e.field}: ${e.reason}`,
          data: { field: e.field, value: e.value },
        }));

        const startTime = Date.now();
        let importBatch: ParsedRecord[] = [];

        await this.csvParser.parseFileFromPath(
          filePath,
          filename,
          async (record) => {
            totalRecordsCount++;
            if (invalidRows.has(record.row)) return;

            importBatch.push(record);

            if (importBatch.length >= 1000) {
              await this.processBatch(
                importBatch,
                progress,
                uploadId,
                prisma,
                tenantMasterData,
                carryOverItemIds,
                newItemIds,
              );
              importBatch = []; // Clear memory

              // Yield to event loop to prevent blocking other requests
              await new Promise((resolve) => setImmediate(resolve));

              // Throttled Progress Update (10Hz / 100ms for "highly realtime")
              const now = Date.now();
              if (now - lastEmitTime > 100) {
                lastEmitTime = now;
                const elapsedSec = (now - startTime) / 1000;
                const recsPerSec = Math.round(
                  progress.processedRecords / (elapsedSec || 1),
                );
                const memoryUsageMB = Math.round(
                  process.memoryUsage().heapUsed / 1024 / 1024,
                );
                const currentProgress =
                  totalToBeProcessed > 0
                    ? Math.round(
                        (progress.processedRecords / totalToBeProcessed) * 100,
                      )
                    : 0;

                // Don't update DB on every 100ms (too much IO), update DB every 5 seconds
                if (now % 5000 < 100) {
                  await prisma.bulkUpload.update({
                    where: { id: uploadId },
                    data: {
                      processedRecords: progress.processedRecords,
                      successRecords: progress.successRecords,
                      failedRecords: progress.failedRecords,
                      message: `Importing: ${progress.processedRecords} @ ${recsPerSec} recs/s (Mem: ${memoryUsageMB}MB)`,
                    },
                  });
                }

                await job.progress(currentProgress);
                this.eventsService.emit({
                  uploadId,
                  type: 'progress',
                  data: {
                    progress: currentProgress,
                    processedRecords: progress.processedRecords,
                    successRecords: progress.successRecords,
                    failedRecords: progress.failedRecords,
                    recsPerSec,
                    memoryUsageMB,
                    status: 'processing',
                  },
                });
              }
            }
          },
        );

        // Final small batch
        if (importBatch.length > 0) {
          await this.processBatch(
            importBatch,
            progress,
            uploadId,
            prisma,
            tenantMasterData,
            carryOverItemIds,
            newItemIds,
          );
        }

        // Generate success report if we had successes (100% backend/DB data in multi-sheet Excel format)
        if (carryOverItemIds.size > 0 || newItemIds.size > 0) {
          this.logger.log(
            `[Job ${job.id}] Generating success export report for ${carryOverItemIds.size} carry overs and ${newItemIds.size} new items...`,
          );
          const successReportPath = path.join(
            process.cwd(),
            'uploads',
            'bulk',
            `success-${uploadId}.xlsx`,
          );
          const errorReportDir = path.dirname(successReportPath);
          if (!fs.existsSync(errorReportDir)) {
            fs.mkdirSync(errorReportDir, { recursive: true });
          }

          const mapItemToExcelRow = (item: any) => ({
            'Item ID': item.itemId,
            SKU: item.sku,
            Barcode: item.barCode,
            Description: item.description,
            'Unit Price': item.unitPrice,
            'Unit Cost': item.unitCost,
            FOB: item.fob,
            'Sale Tax Rate': item.taxRate1 ?? 0,
            'Additional Sales Tax': item.taxRate2 ?? 0,
            'Discount %': item.discountRate ?? 0,
            'Discount Amount': item.discountAmount ?? 0,
            Status: item.status,
            'Is Active': item.isActive ? 'Yes' : 'No',
            Brand: item.brand?.name || '',
            Division: item.division?.name || '',
            Gender: item.gender?.name || '',
            Size: item.size?.name || '',
            Silhouette: item.silhouette?.name || '',
            'Channel Class': item.channelClass?.name || '',
            Color: item.color?.name || '',
            Category: item.category?.name || '',
            'Sub Category': item.subCategory?.name || '',
            'Item Class': item.itemClass?.name || '',
            'Item Subclass': item.itemSubclass?.name || '',
            Season: item.season?.name || '',
            Segment: item.segment?.name || '',
            'HS Code': item.hsCode?.hsCode || '',
            UOM: item.uom || '',
            Currency: item.currency || '',
            'Launch Date': item.launchDate
              ? item.launchDate.toISOString().split('T')[0]
              : '',
            'Old Season': item.oldSeason || '',
            'Case Material': item.case || '',
            Band: item.band || '',
            'Movement Type': item.movementType || '',
            'Movement Name': item.movementName || '',
            'Unique No': item.uniqueNo || '',
            'Heel Height': item.heelHeight || '',
            Width: item.width || '',
            'Created At': item.createdAt ? item.createdAt.toISOString() : '',
            'Updated At': item.updatedAt ? item.updatedAt.toISOString() : '',
          });

          let carryOversRows: any[] = [];
          if (carryOverItemIds.size > 0) {
            const carryOverItems = await prisma.item.findMany({
              where: { itemId: { in: Array.from(carryOverItemIds) } },
              include: {
                brand: true,
                division: true,
                gender: true,
                size: true,
                silhouette: true,
                channelClass: true,
                color: true,
                category: true,
                subCategory: true,
                itemClass: true,
                itemSubclass: true,
                season: true,
                segment: true,
                hsCode: true,
              },
            });
            carryOversRows = carryOverItems.map(mapItemToExcelRow);
          }

          let newItemsRows: any[] = [];
          if (newItemIds.size > 0) {
            const newItems = await prisma.item.findMany({
              where: { itemId: { in: Array.from(newItemIds) } },
              include: {
                brand: true,
                division: true,
                gender: true,
                size: true,
                silhouette: true,
                channelClass: true,
                color: true,
                category: true,
                subCategory: true,
                itemClass: true,
                itemSubclass: true,
                season: true,
                segment: true,
                hsCode: true,
              },
            });
            newItemsRows = newItems.map(mapItemToExcelRow);
          }

          const wb = XLSX.utils.book_new();
          const wsCarryOvers = XLSX.utils.json_to_sheet(carryOversRows);
          const wsNewItems = XLSX.utils.json_to_sheet(newItemsRows);

          XLSX.utils.book_append_sheet(wb, wsCarryOvers, 'Carry Overs');
          XLSX.utils.book_append_sheet(wb, wsNewItems, 'New Items');

          XLSX.writeFile(wb, successReportPath);
          this.logger.log(
            `[Job ${job.id}] Success export report generated successfully at ${successReportPath}`,
          );
        }
      } else {
        // Stage 1: Validation Mode
        // Emit heartbeats during warm-up so SSE connection stays alive
        this.eventsService.emit({
          uploadId,
          type: 'status',
          data: { message: 'Loading master data...' },
        });

        // Heartbeat interval during potentially long warm-up phase
        const warmupHeartbeat = setInterval(() => {
          this.eventsService.emit({
            uploadId,
            type: 'status',
            data: { message: 'Loading master data...', progress: 1 },
          });
        }, 15000);

        try {
          await tenantMasterData.warmHsCodeCache();
        } finally {
          clearInterval(warmupHeartbeat);
        }

        this.eventsService.emit({
          uploadId,
          type: 'status',
          data: { message: 'Streaming validation scan...' },
        });

        let validationBatch: ParsedRecord[] = [];
        const previewErrors: any[] = []; // first 100 — stored in DB for UI preview
        const invalidRowSet = new Set<number>();
        const MAX_PREVIEW_ERRORS = 100;

        // Write ALL errors to a JSONL file on disk — no DB size limit, streamable for report
        const errorReportDir = path.join(process.cwd(), 'uploads', 'bulk');
        const errorReportPath = path.join(
          errorReportDir,
          `errors-${uploadId}.jsonl`,
        );
        // Use a tmp path — rename atomically when complete so prepareErrorReport
        // never sees a partial file
        const errorReportTmp = errorReportPath + '.tmp';
        const errorFileStream = fs.createWriteStream(errorReportTmp, {
          flags: 'w',
        });
        let totalErrorsWritten = 0;

        // Promisified write — respects backpressure so no lines are dropped
        const writeError = (e: any): Promise<void> => {
          totalErrorsWritten++;
          if (previewErrors.length < MAX_PREVIEW_ERRORS) previewErrors.push(e);
          invalidRowSet.add(e.row);
          const line = JSON.stringify(e) + '\n';
          const ok = errorFileStream.write(line);
          if (!ok) {
            // Wait for drain before continuing — prevents buffer overflow
            return new Promise((resolve) =>
              errorFileStream.once('drain', resolve),
            );
          }
          return Promise.resolve();
        };

        const itemIdSet = new Set<string>();
        const barCodeSet = new Set<string>();
        await this.csvParser.parseFileFromPath(
          filePath,
          filename,
          async (record) => {
            totalRecordsCount++;

            const itemId = record.data.itemId
              ? String(record.data.itemId).trim()
              : undefined;
            const barCode = record.data.barCode
              ? String(record.data.barCode).trim()
              : undefined;

            if (record.data.itemId) {
              const normalized = String(record.data.itemId)
                .trim()
                .toLowerCase();
              if (itemIdSet.has(normalized)) {
                await writeError({
                  row: record.row,
                  field: 'ItemID',
                  value: record.data.itemId,
                  reason: 'Duplicate ItemID found within file.',
                  itemId,
                  barCode,
                });
              } else {
                itemIdSet.add(normalized);
              }
            }
            // rows without itemId are fine — processor will auto-assign a sequential ID

            if (record.data.hsCode) {
              const hsCode = String(record.data.hsCode).trim();
              if (hsCode !== '') {
                const hsCodeId = await tenantMasterData.findHsCode(hsCode);
                if (!hsCodeId) {
                  await writeError({
                    row: record.row,
                    field: 'HSCode',
                    value: record.data.hsCode,
                    reason: `HS Code '${record.data.hsCode}' not found in master data.`,
                    itemId,
                    barCode,
                  });
                }
              }
            }

            validationBatch.push(record);

            if (validationBatch.length >= 5000) {
              const batchErrors =
                this.validator.validateRecords(validationBatch);
              for (const e of batchErrors) await writeError(e);
              validationBatch = [];

              await new Promise((resolve) => setImmediate(resolve));

              const now = Date.now();
              if (now - lastEmitTime > 500) {
                lastEmitTime = now;
                this.eventsService.emit({
                  uploadId,
                  type: 'progress',
                  data: {
                    progress: 10,
                    processedRecords: totalRecordsCount,
                    failedRecords: invalidRowSet.size,
                    status: 'validating',
                    message: `Validating: ${totalRecordsCount.toLocaleString()} rows scanned...`,
                  },
                });
              }
            }
          },
        );

        if (validationBatch.length > 0) {
          const batchErrors = this.validator.validateRecords(validationBatch);
          for (const e of batchErrors) await writeError(e);
        }

        // Close stream and wait for flush, then atomic rename
        await new Promise<void>((resolve, reject) =>
          errorFileStream.end((err: any) => (err ? reject(err) : resolve())),
        );
        fs.renameSync(errorReportTmp, errorReportPath);

        itemIdSet.clear();

        const totalInvalidRows = invalidRowSet.size;
        const totalValidRows = totalRecordsCount - totalInvalidRows;

        // Store only preview errors in DB — full report is on disk at errorReportPath
        await prisma.bulkUpload.update({
          where: { id: uploadId },
          data: {
            status: 'validated',
            totalRecords: totalRecordsCount,
            failedRecords: totalInvalidRows,
            successRecords: totalValidRows,
            errors: previewErrors as any,
            message: `Validation complete: ${totalValidRows} valid, ${totalInvalidRows} invalid rows.${totalInvalidRows > MAX_PREVIEW_ERRORS ? ` Showing first ${MAX_PREVIEW_ERRORS} of ${totalInvalidRows} errors — download full report for all.` : ''}`,
            completedAt: new Date(),
          },
        });

        await this.notificationsService.create({
          userId,
          title: 'Validation Completed',
          message: `Bulk validation finished: ${totalValidRows} valid rows, ${totalInvalidRows} invalid.`,
          category: 'system',
          priority: 'normal',
          channels: ['inApp'],
        });

        await job.progress(100);
        this.eventsService.emit({
          uploadId,
          type: 'completed',
          data: {
            status: 'validated',
            totalRecords: totalRecordsCount,
            successRecords: totalValidRows,
            failedRecords: totalInvalidRows,
            // Don't send errors over SSE — client fetches them via status endpoint
            // to avoid sending potentially MBs of JSON through the event stream
            progress: 100,
          },
        });
        return;
      }

      await prisma.bulkUpload.update({
        where: { id: uploadId },
        data: {
          status: 'completed',
          message: `Import completed successfully: ${progress.successRecords} records added.`,
          completedAt: new Date(),
        },
      });

      await this.notificationsService.create({
        userId,
        title: 'Import Completed',
        message: `Bulk import finished: ${progress.successRecords} added, ${progress.failedRecords} failed.`,
        category: 'system',
        priority: 'high',
        channels: ['inApp'],
      });

      this.logger.log(
        `[Job ${job.id}] Import COMPLETED: ${progress.successRecords} success, ${progress.failedRecords} failed`,
      );

      this.eventsService.emit({
        uploadId,
        type: 'completed',
        data: {
          status: 'completed',
          successRecords: progress.successRecords,
          failedRecords: progress.failedRecords,
          progress: 100,
        },
      });
    } catch (error) {
      this.logger.error(
        `[Job ${job.id}] FAILED: ${error.message}`,
        error.stack,
      );
      try {
        await prisma.bulkUpload.update({
          where: { id: uploadId },
          data: {
            status: 'failed',
            completedAt: new Date(),
            message: `Error: ${error.message}`,
          },
        });

        await this.notificationsService.create({
          userId,
          title: 'Bulk Job Failed',
          message: `The requested ${mode} job failed unexpectedly: ${error.message}`,
          category: 'system',
          priority: 'urgent',
          channels: ['inApp'],
        });

        this.eventsService.emit({
          uploadId,
          type: 'failed',
          data: { message: error.message },
        });
      } catch (e) {
        this.logger.error(
          `Failed to update failure status in DB: ${e.message}`,
        );
      }
    } finally {
      await prisma.$disconnect();
    }
  }

  private async processBatch(
    batch: ParsedRecord[],
    progress: UploadProgress,
    uploadId: string,
    prisma: PrismaService,
    tenantMasterData: MasterDataService,
    carryOverItemIds: Set<string>,
    newItemIds: Set<string>,
  ): Promise<void> {
    // ── Bulk existence check by ItemID and Barcode only ──────────────────
    // NOTE: SKU is NOT unique — the same SKU can exist across multiple sizes/colors.
    // Using SKU as a match key caused items with the same SKU (e.g. size 8 & size 9)
    // to collide: the second row would update the first item instead of creating a new one.
    const itemIds = batch
      .map((r) => (r.data.itemId ? String(r.data.itemId).trim() : ''))
      .filter(Boolean);
    const barcodes = batch
      .map((r) => (r.data.barCode ? String(r.data.barCode).trim() : ''))
      .filter(Boolean);

    const orConditions: any[] = [];
    if (itemIds.length > 0) orConditions.push({ itemId: { in: itemIds } });
    if (barcodes.length > 0) orConditions.push({ barCode: { in: barcodes } });

    const existingItems =
      orConditions.length > 0
        ? await prisma.item.findMany({
            where: { OR: orConditions },
            select: { id: true, itemId: true, barCode: true },
          })
        : [];

    // Build lookup maps — only truly unique fields
    const itemIdMap = new Map<string, string>();
    const barcodeMap = new Map<string, { id: string; itemId: string }>();

    for (const item of existingItems) {
      itemIdMap.set(item.itemId, item.id);
      if (item.barCode)
        barcodeMap.set(item.barCode.trim(), {
          id: item.id,
          itemId: item.itemId,
        });
    }

    // Determine which records already exist and which ones need auto-generated IDs
    const matchedRecordMap = new Map<number, { id: string; itemId: string }>();
    const recordsNeedingId: ParsedRecord[] = [];

    for (const record of batch) {
      const itemId = record.data.itemId
        ? String(record.data.itemId).trim()
        : undefined;
      const barCode = record.data.barCode
        ? String(record.data.barCode).trim()
        : undefined;
      const sku = record.data.sku ? String(record.data.sku).trim() : undefined;

      let match: { id: string; itemId: string } | undefined = undefined;

      // Match priority: itemId first (explicit), then barCode (unique per variant).
      // SKU is intentionally excluded — it is NOT unique across sizes/colors.
      if (itemId && itemIdMap.has(itemId)) {
        match = { id: itemIdMap.get(itemId)!, itemId };
      } else if (barCode && barcodeMap.has(barCode)) {
        match = barcodeMap.get(barCode);
      }

      if (match) {
        this.logger.log(
          `[UploadProcessor] Row ${record.row}: Match found - Carry Over Item. SKU: ${sku || 'N/A'}, Barcode: ${barCode || 'N/A'}, matched to existing database ItemID: ${match.itemId}`,
        );
        matchedRecordMap.set(record.row, match);
        // Sync the matched ID back to record data so prepareItemData gets the correct mapped context
        record.data.itemId = match.itemId;
      } else {
        this.logger.log(
          `[UploadProcessor] Row ${record.row}: No match found - Outstanding (New) Item. SKU: ${sku || 'N/A'}, Barcode: ${barCode || 'N/A'}`,
        );
        if (!itemId) {
          recordsNeedingId.push(record);
        }
      }
    }

    // ── Auto-generate itemIds for new records ────────────────────────────
    if (recordsNeedingId.length > 0) {
      // Use raw SQL MAX(CAST) so we get the true numeric maximum regardless
      // of string padding differences that fool Postgres lexicographic ordering.
      const maxResult = await prisma.$queryRaw<{ max_id: number | null }[]>`
                SELECT MAX(CAST("itemId" AS BIGINT)) AS max_id
                FROM "Item"
                WHERE "itemId" ~ '^[0-9]+$'
            `;
      const lastNum = maxResult[0]?.max_id ? Number(maxResult[0].max_id) : 0;
      this.logger.log(
        `[UploadProcessor] Current max numeric itemId: ${lastNum}. Generating ${recordsNeedingId.length} new IDs starting from ${lastNum + 1}.`,
      );

      let counter = lastNum;
      for (const record of recordsNeedingId) {
        counter++;
        if (counter > 9999999)
          throw new Error('Item ID sequence exceeded maximum 9999999');
        record.data.itemId = String(counter).padStart(6, '0');
        this.logger.log(
          `[UploadProcessor] Row ${record.row}: Assigned new itemId: ${record.data.itemId}`,
        );
      }
    }

    const toCreate: any[] = [];
    const toUpdate: Array<{
      id: string;
      data: any;
      row: number;
      itemId: string;
    }> = [];

    for (const record of batch) {
      try {
        const itemData = await this.prepareItemData(record, tenantMasterData);
        const match = matchedRecordMap.get(record.row);

        if (match) {
          toUpdate.push({
            id: match.id,
            data: itemData,
            row: record.row,
            itemId: match.itemId,
          });
        } else {
          toCreate.push({
            ...itemData,
            itemId: String(record.data.itemId),
          });
        }
      } catch (error) {
        this.logger.warn(
          `Failed to prepare row ${record.row}: ${error.message}`,
        );
        progress.failedRecords++;
        progress.errors.push({
          row: record.row,
          reason: error.message,
          data: record.data,
        });
        progress.processedRecords++;
      }
    }

    // Execute Bulk Creation — use upsert per record so nothing is ever silently skipped.
    // createMany+skipDuplicates returns 0 when it perceives ANY duplicate in the batch,
    // causing entire batches to be discarded. Upsert guarantees every row is handled.
    if (toCreate.length > 0) {
      this.logger.log(
        `[UploadProcessor] Creating ${toCreate.length} new items via upsert...`,
      );
      for (const item of toCreate) {
        try {
          await prisma.item.upsert({
            where: { itemId: item.itemId },
            update: item, // Overwrite if somehow the ID already exists
            create: item,
          });
          progress.successRecords++;
          newItemIds.add(item.itemId); // Only track confirmed inserts/upserts
          this.logger.log(
            `[UploadProcessor] Created/upserted new item: itemId=${item.itemId}, sku=${item.sku}, barCode=${item.barCode}`,
          );
        } catch (e) {
          this.logger.error(
            `[UploadProcessor] Failed to upsert new item itemId=${item.itemId} sku=${item.sku}: ${e.message}`,
          );
          progress.failedRecords++;
          progress.errors.push({
            row: -1,
            reason: `Create failed for itemId ${item.itemId}: ${e.message}`,
            data: { itemId: item.itemId, sku: item.sku },
          });
        }
        progress.processedRecords++;
      }
    }

    // Batch updates via $transaction — chunked to avoid transaction timeouts (default 5s)
    if (toUpdate.length > 0) {
      const chunkSize = 200;
      for (let i = 0; i < toUpdate.length; i += chunkSize) {
        const chunk = toUpdate.slice(i, i + chunkSize);
        try {
          await prisma.$transaction(
            chunk.map((item) =>
              prisma.item.update({ where: { id: item.id }, data: item.data }),
            ),
          );
          progress.successRecords += chunk.length;
          progress.processedRecords += chunk.length;
          for (const item of chunk) {
            carryOverItemIds.add(item.itemId);
          }
        } catch (error) {
          // Transaction failed — fall back to individual so we can isolate which rows failed
          this.logger.warn(
            `Batch update transaction failed for chunk ${i / chunkSize + 1}, falling back to individual: ${error.message}`,
          );
          for (const item of chunk) {
            try {
              await prisma.item.update({
                where: { id: item.id },
                data: item.data,
              });
              progress.successRecords++;
              carryOverItemIds.add(item.itemId);
            } catch (e) {
              progress.failedRecords++;
              progress.errors.push({
                row: item.row,
                reason: `Update failed: ${e.message}`,
                data: { id: item.id },
              });
            }
            progress.processedRecords++;
          }
        }
      }
    }
  }

  private async prepareItemData(
    record: ParsedRecord,
    tenantMasterData: MasterDataService,
  ): Promise<any> {
    const { data } = record;

    // Step 1: All independent master data resolved in parallel
    const [
      brandId,
      itemClassId,
      categoryId,
      sizeId,
      colorId,
      genderId,
      silhouetteId,
      channelClassId,
      seasonId,
      segmentId,
      hsCodeId,
    ] = await Promise.all([
      tenantMasterData.getOrCreateBrand(data.concept as string),
      tenantMasterData.getOrCreateItemClass(data.class as string),
      // "Department" in the sheet is a top-level product category (e.g. "Footwear").
      // "ProductCategory/Series" is its child (e.g. "Shoes").
      // We resolve the department-level category first so productCategory can be nested under it.
      tenantMasterData.getOrCreateCategory(data.department as string),
      tenantMasterData.getOrCreateSize(data.size as string),
      tenantMasterData.getOrCreateColor(data.color as string),
      tenantMasterData.getOrCreateGender(data.gender as string),
      tenantMasterData.getOrCreateSilhouette(data.silhouette as string),
      tenantMasterData.getOrCreateChannelClass(data.channelClass as string),
      tenantMasterData.getOrCreateSeason(data.season as string),
      tenantMasterData.getOrCreateSegment(data.segment as string),
      tenantMasterData.getOrCreateHsCode(
        data.hsCode ? String(data.hsCode) : '',
      ),
    ]);

    // Step 2: Dependent master data (needs brandId / itemClassId / categoryId from above)
    // productCategory is a child of the department-level category resolved above
    const [divisionId, itemSubclassId, subCategoryId] = await Promise.all([
      tenantMasterData.getOrCreateDivision(data.division as string, brandId),
      tenantMasterData.getOrCreateItemSubclass(
        data.subclass as string,
        itemClassId,
      ),
      tenantMasterData.getOrCreateSubCategory(
        data.productCategory as string,
        categoryId,
      ),
    ]);

    return {
      sku: data.sku ? String(data.sku) : null,
      barCode: data.barCode ? String(data.barCode) : null,
      description: data.description ? String(data.description) : null,
      unitPrice: data.unitPrice ? Number(data.unitPrice) : 0,
      unitCost: data.unitCost ? Number(data.unitCost) : 0,
      fob: data.fob ? Number(data.fob) : 0,
      taxRate1: data.taxRate1 ? Number(data.taxRate1) : 0,
      taxRate2: data.taxRate2 ? Number(data.taxRate2) : 0,
      discountRate: data.discountRate ? Number(data.discountRate) : 0,
      discountAmount: data.discountAmount ? Number(data.discountAmount) : 0,
      discountStartDate: data.discountStartDate ?? null,
      discountEndDate: data.discountEndDate ?? null,
      status: data.isActive === false ? 'inactive' : 'active',
      isActive: data.isActive !== false,
      // Scalar string fields stored directly on Item
      case: data.case ? String(data.case) : null,
      band: data.band ? String(data.band) : null,
      movementType: data.movementType ? String(data.movementType) : null,
      movementName: data.movementName ? String(data.movementName) : null,
      uniqueNo: data.uniqueNo ? String(data.uniqueNo) : null,
      heelHeight: data.heelHeight ? String(data.heelHeight) : null,
      width: data.width ? String(data.width) : null,
      hsCodeStr: data.hsCode ? String(data.hsCode) : null,
      uom: data.uom ? String(data.uom) : null,
      currency: data.currency ? String(data.currency) : null,
      launchDate: data.launchDate ?? null,
      oldSeason: data.oldSeason ? String(data.oldSeason) : null,
      // Resolved FK IDs
      brandId,
      itemClassId,
      itemSubclassId,
      silhouetteId,
      sizeId,
      colorId,
      seasonId,
      genderId,
      categoryId,
      subCategoryId,
      hsCodeId,
      divisionId,
      channelClassId,
      segmentId,
    };
  }
}
