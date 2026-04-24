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

                    if (importBatch.length >= 500) {
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
        for (const record of batch) {
            try {
                const data = record.data;
                const empIdString = String(data.employeeId || data.employeeID || data['Employee ID'] || data['EmployeeID']);
                
                const employee = await prisma.employee.findUnique({
                    where: { employeeId: empIdString },
                    select: { id: true }
                });

                if (!employee) {
                    throw new Error(`Employee with ID ${empIdString} not found in database.`);
                }

                const dateInput = data.date || data.Date;
                const date = new Date(dateInput);
                const dateStr = date.toISOString().split('T')[0];
                
                const checkInStr = data.checkIn || data['Check In'];
                const checkOutStr = data.checkOut || data['Check Out'];
                
                const checkIn = checkInStr ? new Date(`${dateStr}T${checkInStr}`) : null;
                const checkOut = checkOutStr ? new Date(`${dateStr}T${checkOutStr}`) : null;
                const notes = data.notes || data.Notes || null;

                const attendanceData = {
                    employeeId: employee.id,
                    date,
                    checkIn,
                    checkOut,
                    notes,
                    status: 'present'
                };

                const existing = await prisma.attendance.findFirst({
                    where: { employeeId: employee.id, date }
                });

                if (existing) {
                    await prisma.attendance.update({
                        where: { id: existing.id },
                        data: attendanceData
                    });
                } else {
                    await prisma.attendance.create({
                        data: attendanceData
                    });
                }
                
                progress.successRecords++;
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
            }
            progress.processedRecords++;
        }
    }
}
