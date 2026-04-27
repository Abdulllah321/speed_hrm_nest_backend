import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { PrismaService } from '../database/prisma.service';
import * as fs from 'fs';
import * as path from 'path';
import * as ExcelJS from 'exceljs';
import { AttendanceUploadEventsService } from './attendance-upload-events.service';

@Injectable()
export class AttendanceBulkUploadService {
    private readonly logger = new Logger(AttendanceBulkUploadService.name);

    constructor(
        @InjectQueue('attendance-upload') private uploadQueue: Queue,
        private prisma: PrismaService,
        private eventsService: AttendanceUploadEventsService,
    ) { }

    async initiateValidation(
        fileBuffer: Buffer,
        filename: string,
        userId: string,
    ): Promise<{ uploadId: string; jobId: string }> {
        const { v4: uuidv4 } = await import('uuid');
        const jobId = `validate-${uuidv4()}`;

        const upload = await this.prisma.bulkUpload.create({
            data: {
                jobId,
                filename,
                totalRecords: 0,
                uploadedBy: userId,
                status: 'validating',
            },
        });

        const uploadDir = path.join(process.cwd(), 'uploads', 'bulk');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        const ext = filename.split('.').pop();
        const filePath = path.join(uploadDir, `upload-${upload.id}.${ext}`);
        fs.writeFileSync(filePath, fileBuffer);

        await this.uploadQueue.add({
            uploadId: upload.id,
            filename,
            userId,
            tenantId: this.prisma.getTenantId() || '',
            tenantDbUrl: this.prisma.getTenantDbUrl() || '',
            mode: 'validate',
        } as any, {
            jobId,
            removeOnComplete: false,
            removeOnFail: false,
        });

        this.logger.log(`Attendance validation initiated: ${upload.id} (Job ID: ${jobId})`);

        return {
            uploadId: upload.id,
            jobId,
        };
    }

    async confirmUpload(uploadId: string, userId: string): Promise<{ uploadId: string; jobId: string }> {
        const upload = await this.prisma.bulkUpload.findUnique({
            where: { id: uploadId },
        });

        if (!upload) {
            throw new NotFoundException(`Upload ${uploadId} not found`);
        }

        if (upload.status === 'completed') {
            this.logger.warn(`Confirm called on already-completed upload ${uploadId} — returning existing jobId`);
            return { uploadId, jobId: upload.jobId };
        }

        if (upload.status !== 'validated') {
            throw new Error(`Upload must be in 'validated' status to be confirmed (current: ${upload.status})`);
        }

        this.eventsService.emit({
            uploadId,
            type: 'status',
            data: { status: 'pending', message: 'Import confirmation received...' }
        });

        await this.prisma.bulkUpload.update({
            where: { id: uploadId },
            data: { status: 'pending', message: 'Confirming upload...' },
        });

        const { v4: uuidv4 } = await import('uuid');
        const importJobId = `import-${uuidv4()}`;

        await this.uploadQueue.add({
            uploadId: upload.id,
            filename: upload.filename,
            userId,
            tenantId: this.prisma.getTenantId() || '',
            tenantDbUrl: this.prisma.getTenantDbUrl() || '',
            mode: 'import',
        } as any, {
            jobId: importJobId,
            removeOnComplete: false,
            removeOnFail: false,
        });

        await this.prisma.bulkUpload.update({
            where: { id: upload.id },
            data: { jobId: importJobId },
        });

        this.logger.log(`Attendance import confirmed: ${upload.id} (Job ID: ${importJobId})`);

        return {
            uploadId,
            jobId: importJobId,
        };
    }

    async getUploadStatus(uploadId: string) {
        const upload = await this.prisma.bulkUpload.findUnique({
            where: { id: uploadId },
        });

        if (!upload) {
            throw new NotFoundException(`Upload ${uploadId} not found`);
        }

        let jobProgress = 0;
        let jobState = 'unknown';

        try {
            const job = await this.uploadQueue.getJob(upload.jobId);
            if (job) {
                jobProgress = await job.progress();
                jobState = await job.getState();
            }
        } catch (error) {
            this.logger.warn(`Failed to get job status (${error.message})`);
        }

        return {
            ...upload,
            progress: jobProgress,
            jobState,
        };
    }

    async streamErrorReport(uploadId: string, res: any): Promise<void> {
        const upload = await this.prisma.bulkUpload.findUnique({ where: { id: uploadId } });
        if (!upload) {
            res.code(404).send({ status: false, message: 'Upload not found' });
            return;
        }

        const errorFilePath = path.join(process.cwd(), 'uploads', 'bulk', `errors-${uploadId}.jsonl`);
        const raw = res.raw;

        raw.writeHead(200, {
            'Content-Type': 'text/csv',
            'Content-Disposition': `attachment; filename="attendance-error-report-${uploadId}.csv"`,
            'Transfer-Encoding': 'chunked',
            'Cache-Control': 'no-cache',
        });

        raw.write('Row,EmployeeID,Date,Field,Reason\n');

        const writeLine = (e: any) => {
            const row = e.row ?? 'N/A';
            const empId = String(e.employeeId ?? '').replace(/"/g, '""');
            const date = String(e.date ?? '').replace(/"/g, '""');
            const field = e.field ?? 'N/A';
            const reason = String(e.reason ?? '').replace(/"/g, '""');
            raw.write(`${row},"${empId}","${date}",${field},"${reason}"\n`);
        };

        if (!fs.existsSync(errorFilePath)) {
            const errors = (Array.isArray(upload.errors) ? upload.errors : []) as any[];
            for (const e of errors) writeLine(e);
            raw.end();
            return;
        }

        const { createInterface } = await import('readline');
        const rl = createInterface({ input: fs.createReadStream(errorFilePath), crlfDelay: Infinity });
        rl.on('line', (line) => { if (line.trim()) { try { writeLine(JSON.parse(line)); } catch { } } });
        rl.on('close', () => raw.end());
        rl.on('error', () => raw.end());
    }

    async generateTemplate(): Promise<Buffer> {
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Attendance Import');

        const columns = [
            { header: 'Employee ID', key: 'employeeId', width: 20 },
            { header: 'Date', key: 'date', width: 20 },
            { header: 'Check In', key: 'checkIn', width: 20 },
            { header: 'Check Out', key: 'checkOut', width: 20 },
            { header: 'Notes', key: 'notes', width: 40 }
        ];

        sheet.columns = columns.map(c => ({ header: c.header, key: c.key, width: c.width }));

        // Styling
        sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F81BD' } };
        sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
        sheet.getRow(1).height = 25;

        // Sample Row
        sheet.addRow({
            employeeId: 'EMP-001',
            date: '2026-04-22',
            checkIn: '09:00',
            checkOut: '18:00',
            notes: 'Regular day'
        });

        // Instructions
        sheet.addRows([
            [],
            ['Instructions:'],
            ['- Date format: YYYY-MM-DD (e.g. 2026-04-22)'],
            ['- Check In / Check Out format: HH:MM or HH:MM:SS (24-hour)'],
            ['- Only Employee ID and Date are strictly required'],
        ]);

        return workbook.xlsx.writeBuffer() as unknown as Promise<Buffer>;
    }
}
