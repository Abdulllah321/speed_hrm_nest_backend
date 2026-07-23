import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { PrismaService } from '../../database/prisma.service';
import { CsvParserService, ParsedRecord } from '../../common/services/csv-parser.service';
import { AttendanceValidatorService } from '../../common/services/attendance-validator.service';
import { AttendanceUploadEventsService } from '../../attendance/attendance-upload-events.service';
import * as fs from 'fs';
import * as path from 'path';

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

@Processor('attendance-upload')
export class AttendanceUploadProcessor {
    private readonly logger = new Logger(AttendanceUploadProcessor.name);

    constructor(
        private readonly csvParser: CsvParserService,
        private readonly validator: AttendanceValidatorService,
        private readonly eventsService: AttendanceUploadEventsService,
    ) { }

    @Process()
    async handleUpload(job: Job<any>): Promise<void> {
        let { uploadId, filename, userId, tenantId, tenantDbUrl, mode } = job.data;
        mode = mode || 'import';

        this.logger.log(`[Job ${job.id}] ${mode.toUpperCase()} phase started for ${filename} (Upload ID: ${uploadId})`);

        const prisma = new PrismaService({ tenantId, tenantDbUrl } as any);

        const ext = filename.split('.').pop();
        const filePath = path.join(process.cwd(), 'uploads', 'bulk', `upload-${uploadId}.${ext}`);
        if (!fs.existsSync(filePath)) {
            this.logger.error(`[Job ${job.id}] File not found on disk: ${filePath}`);
            throw new Error(`Upload file not found on disk at ${filePath}`);
        }

        try {
            await prisma.bulkUpload.update({
                where: { id: uploadId },
                data: { status: mode === 'validate' ? 'validating' : 'processing' },
            });

            this.eventsService.emit({
                uploadId,
                type: 'status',
                data: {
                    status: mode === 'validate' ? 'validating' : 'processing',
                    message: mode === 'validate' ? 'Reading file...' : 'Starting Import...',
                    progress: 1,
                }
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
            let lastEmitTime = Date.now();

            if (mode === 'import') {
                const uploadRecord = await prisma.bulkUpload.findUnique({
                    where: { id: uploadId },
                    select: { errors: true, totalRecords: true }
                });

                const allValidationErrors = (Array.isArray(uploadRecord?.errors) ? uploadRecord.errors : []) as any[];
                const invalidRows = new Set(allValidationErrors.map(e => e.row));
                const totalToBeProcessed = (uploadRecord?.totalRecords || 0) - invalidRows.size;

                progress.totalRecords = uploadRecord?.totalRecords || 0;
                progress.failedRecords = invalidRows.size;
                progress.successRecords = 0;

                const startTime = Date.now();
                let importBatch: ParsedRecord[] = [];

                await this.csvParser.parseFileFromPath(filePath, filename, async (record) => {
                    totalRecordsCount++;
                    if (invalidRows.has(record.row)) return;

                    importBatch.push(record);

                    if (importBatch.length >= 1000) {
                        await this.processBatch(importBatch, progress, uploadId, prisma);
                        importBatch = [];

                        await new Promise(resolve => setImmediate(resolve));

                        const now = Date.now();
                        if (now - lastEmitTime > 200) {
                            lastEmitTime = now;
                            const elapsedSec = (now - startTime) / 1000;
                            const recsPerSec = Math.round(progress.processedRecords / (elapsedSec || 1));
                            const currentProgress = totalToBeProcessed > 0 ? Math.round((progress.processedRecords / totalToBeProcessed) * 100) : 0;

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
                                    status: 'processing'
                                }
                            });
                        }
                    }
                });

                if (importBatch.length > 0) {
                    await this.processBatch(importBatch, progress, uploadId, prisma);
                }
            } else {
                // Validation Mode
                this.eventsService.emit({ uploadId, type: 'status', data: { message: 'Streaming validation scan...' } });

                let validationBatch: ParsedRecord[] = [];
                const previewErrors: any[] = [];
                let totalValidRows = 0;
                let totalInvalidRows = 0;

                const errorFilePath = path.join(process.cwd(), 'uploads', 'bulk', `errors-${uploadId}.jsonl`);
                const errorStream = fs.createWriteStream(errorFilePath, { flags: 'a' });

                await this.csvParser.parseFileFromPath(filePath, filename, async (record) => {
                    totalRecordsCount++;
                    validationBatch.push(record);

                    if (validationBatch.length >= 1000) {
                        const batchErrors = this.validator.validateRecords(validationBatch);
                        const dupErrors = this.validator.checkInternalDuplicates(validationBatch);
                        const allBatchErrors = [...batchErrors, ...dupErrors];

                        const invalidRowNums = new Set(allBatchErrors.map(e => e.row));
                        const validCount = validationBatch.length - invalidRowNums.size;

                        totalValidRows += validCount;
                        totalInvalidRows += invalidRowNums.size;

                        for (const err of allBatchErrors) {
                            errorStream.write(JSON.stringify(err) + '\n');
                            if (previewErrors.length < 50) previewErrors.push(err);
                        }

                        validationBatch = [];

                        const now = Date.now();
                        if (now - lastEmitTime > 500) {
                            lastEmitTime = now;
                            this.eventsService.emit({
                                uploadId,
                                type: 'status',
                                data: {
                                    message: `Validating... (${totalRecordsCount} rows checked)`,
                                    progress: 50,
                                }
                            });
                        }
                    }
                });

                if (validationBatch.length > 0) {
                    const batchErrors = this.validator.validateRecords(validationBatch);
                    const dupErrors = this.validator.checkInternalDuplicates(validationBatch);
                    const allBatchErrors = [...batchErrors, ...dupErrors];

                    const invalidRowNums = new Set(allBatchErrors.map(e => e.row));
                    const validCount = validationBatch.length - invalidRowNums.size;

                    totalValidRows += validCount;
                    totalInvalidRows += invalidRowNums.size;

                    for (const err of allBatchErrors) {
                        errorStream.write(JSON.stringify(err) + '\n');
                        if (previewErrors.length < 50) previewErrors.push(err);
                    }
                }

                errorStream.end();

                await prisma.bulkUpload.update({
                    where: { id: uploadId },
                    data: {
                        status: 'validated',
                        totalRecords: totalRecordsCount,
                        failedRecords: totalInvalidRows,
                        successRecords: totalValidRows,
                        errors: previewErrors as any,
                        message: `Validation complete: ${totalValidRows} valid, ${totalInvalidRows} invalid rows.`,
                        completedAt: new Date(),
                    },
                });

                await job.progress(100);
                this.eventsService.emit({
                    uploadId,
                    type: 'completed',
                    data: {
                        status: 'validated',
                        progress: 100,
                        totalRecords: totalRecordsCount,
                        successRecords: totalValidRows,
                        failedRecords: totalInvalidRows,
                        errors: previewErrors
                    }
                });
                return;
            }

            await prisma.bulkUpload.update({
                where: { id: uploadId },
                data: {
                    status: 'completed',
                    message: `Import completed successfully: ${progress.successRecords} attendance records added.`,
                    successRecords: progress.successRecords,
                    failedRecords: progress.failedRecords,
                    processedRecords: progress.processedRecords,
                    completedAt: new Date(),
                },
            });

            this.eventsService.emit({
                uploadId,
                type: 'completed',
                data: {
                    status: 'completed',
                    progress: 100,
                    successRecords: progress.successRecords,
                    failedRecords: progress.failedRecords,
                    processedRecords: progress.processedRecords,
                    totalRecords: progress.totalRecords,
                    message: `Import completed: ${progress.successRecords} added, ${progress.failedRecords} failed.`,
                }
            });

        } catch (error) {
            this.logger.error(`[Job ${job.id}] Failed: ${error.message}`, error.stack);

            await prisma.bulkUpload.update({
                where: { id: uploadId },
                data: {
                    status: 'failed',
                    message: `Critical Error: ${error.message}`,
                    completedAt: new Date(),
                },
            });

            this.eventsService.emit({
                uploadId,
                type: 'failed',
                data: { status: 'failed', message: error.message }
            });

            throw error;
        }
    }

    private async processBatch(batch: ParsedRecord[], progress: UploadProgress, uploadId: string, prisma: PrismaService): Promise<void> {
        // 1. Bulk lookup for employees in the batch
        const employeeIds = batch.map(record => {
            const data = record.data;
            return String(data.employeeId || data.employeeID || data['Employee ID'] || data['EmployeeID'] || '').trim();
        }).filter(Boolean);

        const employees = employeeIds.length > 0
            ? await prisma.employee.findMany({
                where: { employeeId: { in: employeeIds } },
                select: { id: true, employeeId: true }
              })
            : [];

        const employeeMap = new Map<string, string>();
        for (const emp of employees) {
            employeeMap.set(emp.employeeId, emp.id);
        }

        // 2. Parse batch data and resolve conditions for existing attendance records
        const conditions: { employeeId: string; date: Date }[] = [];
        const parsedRecords: Array<{
            record: ParsedRecord;
            employeeId: string;
            date: Date;
            dateStr: string;
            checkIn: Date | null;
            checkOut: Date | null;
            notes: string | null;
            status: string;
        }> = [];

        for (const record of batch) {
            try {
                const data = record.data;
                const empIdString = String(data.employeeId || data.employeeID || data['Employee ID'] || data['EmployeeID'] || '').trim();
                if (!empIdString) {
                    throw new Error('Employee ID is missing in record.');
                }

                const dbEmpId = employeeMap.get(empIdString);
                if (!dbEmpId) {
                    throw new Error(`Employee with ID ${empIdString} not found in database.`);
                }

                const dateInput = data.date || data.Date;
                const { date, dateStr } = this.getCalendarDate(dateInput);

                const checkInStr = data.checkIn || data['Check In'];
                const checkOutStr = data.checkOut || data['Check Out'];

                const checkInTime = this.getTimeString(checkInStr);
                const checkOutTime = this.getTimeString(checkOutStr);

                const checkIn = checkInTime ? new Date(`${dateStr}T${checkInTime}`) : null;
                const checkOut = checkOutTime ? new Date(`${dateStr}T${checkOutTime}`) : null;
                const notes = data.notes || data.Notes || null;

                const statusInput = data.status || data.Status;
                let status = 'present';
                if (statusInput) {
                    const normStatus = String(statusInput).trim().toLowerCase();
                    if (['present', 'absent', 'leave', 'halfday', 'late', 'holiday'].includes(normStatus)) {
                        status = normStatus;
                    }
                } else if (!checkIn && !checkOut) {
                    status = 'absent';
                }

                parsedRecords.push({
                    record,
                    employeeId: dbEmpId,
                    date,
                    dateStr,
                    checkIn,
                    checkOut,
                    notes,
                    status
                });

                conditions.push({ employeeId: dbEmpId, date });
            } catch (error) {
                this.logger.warn(`Failed row ${record.row}: ${error.message}`);
                progress.failedRecords++;
                progress.errors.push({
                    row: record.row,
                    reason: error.message,
                    data: record.data,
                });

                const errorFilePath = path.join(process.cwd(), 'uploads', 'bulk', `errors-${uploadId}.jsonl`);
                fs.appendFileSync(errorFilePath, JSON.stringify({
                    row: record.row,
                    field: 'System',
                    reason: error.message,
                    employeeId: record.data.employeeId || record.data['Employee ID']
                }) + '\n');

                progress.processedRecords++;
            }
        }

        // 3. Find existing attendance records for the batch of employees & dates
        const existingAttendances = conditions.length > 0
            ? await prisma.attendance.findMany({
                where: { OR: conditions },
                select: { id: true, employeeId: true, date: true }
              })
            : [];

        const existingAttendanceMap = new Map<string, string>(); // "employeeId_epoch" -> id
        for (const att of existingAttendances) {
            const epoch = att.date.getTime();
            existingAttendanceMap.set(`${att.employeeId}_${epoch}`, att.id);
        }

        // 4. Map into updates and creations (handling batch duplicates using maps)
        const toCreateMap = new Map<string, { record: ParsedRecord, data: any }>();
        const toUpdateMap = new Map<string, { record: ParsedRecord, id: string, data: any }>();

        for (const item of parsedRecords) {
            const key = `${item.employeeId}_${item.date.getTime()}`;
            const attendanceData = {
                employeeId: item.employeeId,
                date: item.date,
                checkIn: item.checkIn,
                checkOut: item.checkOut,
                notes: item.notes,
                status: item.status
            };

            const existingId = existingAttendanceMap.get(key);
            if (existingId) {
                toUpdateMap.set(key, { record: item.record, id: existingId, data: attendanceData });
            } else {
                toCreateMap.set(key, { record: item.record, data: attendanceData });
            }
        }

        const toCreate = Array.from(toCreateMap.values());
        const toUpdate = Array.from(toUpdateMap.values());

        // 5. Bulk Creation via createMany (fallback to individual if fails)
        if (toCreate.length > 0) {
            try {
                await prisma.attendance.createMany({
                    data: toCreate.map(x => x.data)
                });
                progress.successRecords += toCreate.length;
                progress.processedRecords += toCreate.length;
            } catch (error) {
                this.logger.warn(`Bulk create failed, falling back to individual creates: ${error.message}`);
                for (const item of toCreate) {
                    try {
                        await prisma.attendance.create({
                            data: item.data
                        });
                        progress.successRecords++;
                    } catch (e) {
                        progress.failedRecords++;
                        progress.errors.push({
                            row: item.record.row,
                            reason: `Create failed: ${e.message}`,
                            data: item.record.data
                        });

                        const errorFilePath = path.join(process.cwd(), 'uploads', 'bulk', `errors-${uploadId}.jsonl`);
                        fs.appendFileSync(errorFilePath, JSON.stringify({
                            row: item.record.row,
                            field: 'System',
                            reason: e.message,
                            employeeId: item.record.data.employeeId || item.record.data['Employee ID']
                        }) + '\n');
                    }
                    progress.processedRecords++;
                }
            }
        }

        // 6. Batch updates via $transaction chunking (fallback to individual if fails)
        if (toUpdate.length > 0) {
            const chunkSize = 200;
            for (let i = 0; i < toUpdate.length; i += chunkSize) {
                const chunk = toUpdate.slice(i, i + chunkSize);
                try {
                    await prisma.$transaction(
                        chunk.map(item =>
                            prisma.attendance.update({
                                where: { id: item.id },
                                data: item.data
                            })
                        )
                    );
                    progress.successRecords += chunk.length;
                    progress.processedRecords += chunk.length;
                } catch (error) {
                    this.logger.warn(`Batch update transaction failed for chunk, falling back to individual updates: ${error.message}`);
                    for (const item of chunk) {
                        try {
                            await prisma.attendance.update({
                                where: { id: item.id },
                                data: item.data
                            });
                            progress.successRecords++;
                        } catch (e) {
                            progress.failedRecords++;
                            progress.errors.push({
                                row: item.record.row,
                                reason: `Update failed: ${e.message}`,
                                data: item.record.data
                            });

                            const errorFilePath = path.join(process.cwd(), 'uploads', 'bulk', `errors-${uploadId}.jsonl`);
                            fs.appendFileSync(errorFilePath, JSON.stringify({
                                row: item.record.row,
                                field: 'System',
                                reason: e.message,
                                employeeId: item.record.data.employeeId || item.record.data['Employee ID']
                            }) + '\n');
                        }
                        progress.processedRecords++;
                    }
                }
            }
        }
    }

    private parseDateString(str: string): Date | null {
        let d = new Date(str);
        if (!isNaN(d.getTime())) return d;

        // Try DD-MM-YYYY or DD/MM/YYYY
        const dmyMatch = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
        if (dmyMatch) {
            const day = parseInt(dmyMatch[1], 10);
            const month = parseInt(dmyMatch[2], 10) - 1; // 0-indexed
            const year = parseInt(dmyMatch[3], 10);
            d = new Date(year, month, day);
            if (!isNaN(d.getTime())) return d;
        }
        return null;
    }

    private getCalendarDate(val: any): { date: Date; dateStr: string } {
        let d: Date | null = null;
        if (val instanceof Date) {
            d = val;
        } else if (typeof val === 'number') {
            d = new Date(Math.round((val - 25569) * 86400 * 1000));
        } else if (val) {
            const str = String(val).trim();
            d = this.parseDateString(str);
        }

        if (!d || isNaN(d.getTime())) {
            throw new Error(`Invalid date format: ${val}`);
        }

        // Add 12 hours before setting UTCHours to 0 to preserve the intended calendar day
        const utcDate = new Date(d.getTime() + 12 * 60 * 60 * 1000);
        utcDate.setUTCHours(0, 0, 0, 0);

        const year = utcDate.getUTCFullYear();
        const month = String(utcDate.getUTCMonth() + 1).padStart(2, '0');
        const day = String(utcDate.getUTCDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;

        return {
            date: utcDate,
            dateStr,
        };
    }

    private getTimeString(val: any): string | null {
        if (!val) return null;
        if (val instanceof Date) {
            const hh = String(val.getUTCHours()).padStart(2, '0');
            const mm = String(val.getUTCMinutes()).padStart(2, '0');
            const ss = String(val.getUTCSeconds()).padStart(2, '0');
            return `${hh}:${mm}:${ss}`;
        }
        if (typeof val === 'number') {
            const totalSeconds = Math.round(val * 24 * 3600);
            const hh = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
            const mm = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
            const ss = String(totalSeconds % 60).padStart(2, '0');
            return `${hh}:${mm}:${ss}`;
        }
        const str = String(val).trim();
        if (str.includes('T')) {
            const d = new Date(str);
            if (!isNaN(d.getTime())) {
                const hh = String(d.getHours()).padStart(2, '0');
                const mm = String(d.getMinutes()).padStart(2, '0');
                const ss = String(d.getSeconds()).padStart(2, '0');
                return `${hh}:${mm}:${ss}`;
            }
        }
        const match = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
        if (match) {
            const hh = match[1].padStart(2, '0');
            const mm = match[2];
            const ss = match[3] || '00';
            return `${hh}:${mm}:${ss}`;
        }
        return str;
    }
}
