import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { PrismaService } from '../../database/prisma.service';
import { CsvParserService, ParsedRecord } from '../../common/services/csv-parser.service';
import { MasterDataService } from '../../common/services/master-data.service';
import { EmployeeValidatorService } from '../../common/services/employee-validator.service';
import { EmployeeUploadEventsService } from '../../employee/employee-upload-events.service';
import { NotificationsService } from '../../notifications/notifications.service';
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

@Processor('employee-upload')
export class EmployeeUploadProcessor {
    private readonly logger = new Logger(EmployeeUploadProcessor.name);

    constructor(
        private readonly csvParser: CsvParserService,
        private readonly validator: EmployeeValidatorService,
        private readonly eventsService: EmployeeUploadEventsService,
        private readonly notificationsService: NotificationsService,
    ) { }

    @Process()
    async handleUpload(job: Job<any>): Promise<void> {
        let { uploadId, filename, userId, tenantId, tenantDbUrl, mode } = job.data;
        mode = mode || 'import';

        this.logger.log(`[Job ${job.id}] ${mode.toUpperCase()} phase started for ${filename} (Upload ID: ${uploadId})`);

        const prisma = new PrismaService({ tenantId, tenantDbUrl } as any);
        const tenantMasterData = new MasterDataService(prisma);

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
                await tenantMasterData.warmCache();
                
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
                const seenImportCnics = new Map<string, string>();
                const seenImportEmails = new Map<string, string>();
                let importBatch: ParsedRecord[] = [];
                
                await this.csvParser.parseFileFromPath(filePath, filename, async (record) => {
                    totalRecordsCount++;
                    if (invalidRows.has(record.row)) return;

                    importBatch.push(record);

                    if (importBatch.length >= 500) {
                        await this.processBatch(importBatch, progress, uploadId, prisma, tenantMasterData, seenImportCnics, seenImportEmails);
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
                    await this.processBatch(importBatch, progress, uploadId, prisma, tenantMasterData, seenImportCnics, seenImportEmails);
                }
            } else {
                // Validation Mode
                this.eventsService.emit({ uploadId, type: 'status', data: { message: 'Loading master data...' } });
                await tenantMasterData.warmCache();

                this.eventsService.emit({ uploadId, type: 'status', data: { message: 'Streaming validation scan...' } });

                let validationBatch: ParsedRecord[] = [];
                const previewErrors: any[] = [];
                const invalidRowSet = new Set<number>();
                const MAX_PREVIEW_ERRORS = 100;

                const errorReportPath = path.join(process.cwd(), 'uploads', 'bulk', `errors-${uploadId}.jsonl`);
                const errorReportTmp = errorReportPath + '.tmp';
                const errorFileStream = fs.createWriteStream(errorReportTmp, { flags: 'w' });

                const writeError = (e: any): Promise<void> => {
                    if (previewErrors.length < MAX_PREVIEW_ERRORS) previewErrors.push(e);
                    invalidRowSet.add(e.row);
                    const line = JSON.stringify(e) + '\n';
                    const ok = errorFileStream.write(line);
                    if (!ok) return new Promise(resolve => errorFileStream.once('drain', resolve));
                    return Promise.resolve();
                };

                const seenEmployeeIds = new Set<string>();
                const seenAttendanceIds = new Set<string>();
                const seenCnics = new Set<string>();

                await this.csvParser.parseFileFromPath(filePath, filename, async (record) => {
                    totalRecordsCount++;

                    // In-file uniqueness validation
                    const employeeId = String(record.data.employeeId || record.data.employeeID || record.data['Employee ID'] || record.data.employeeid || '').trim();
                    const attendanceId = (record.data.attendanceId || record.data['Attendance ID']) 
                        ? String(record.data.attendanceId || record.data['Attendance ID']).trim() 
                        : employeeId;
                    const cnic = String(record.data.cnicNumber || record.data.CNIC || record.data['CNIC Number'] || record.data['CNIC-Number'] || '').trim();

                    if (employeeId) {
                        if (seenEmployeeIds.has(employeeId)) {
                            await writeError({
                                row: record.row,
                                field: 'EmployeeID',
                                value: employeeId,
                                reason: `Duplicate Employee ID '${employeeId}' found within this upload file.`,
                                employeeId,
                                employeeName: record.data.employeeName || record.data['Employee Name']
                            });
                        } else {
                            seenEmployeeIds.add(employeeId);
                        }
                    }

                    if (attendanceId) {
                        if (seenAttendanceIds.has(attendanceId)) {
                            await writeError({
                                row: record.row,
                                field: 'AttendanceID',
                                value: attendanceId,
                                reason: `Duplicate Attendance ID '${attendanceId}' found within this upload file.`,
                                employeeId,
                                employeeName: record.data.employeeName || record.data['Employee Name']
                            });
                        } else {
                            seenAttendanceIds.add(attendanceId);
                        }
                    }

                    if (cnic) {
                        if (seenCnics.has(cnic)) {
                            await writeError({
                                row: record.row,
                                field: 'CNICNumber',
                                value: cnic,
                                reason: `Duplicate CNIC Number '${cnic}' found within this upload file.`,
                                employeeId,
                                employeeName: record.data.employeeName || record.data['Employee Name']
                            });
                        } else {
                            seenCnics.add(cnic);
                        }
                    }

                    validationBatch.push(record);

                    if (validationBatch.length >= 1000) {
                        const batchErrors = this.validator.validateRecords(validationBatch);
                        for (const e of batchErrors) await writeError(e);

                        // DB Uniqueness Check
                        const dbErrors = await this.checkDbUniqueness(validationBatch, prisma);
                        for (const e of dbErrors) await writeError(e);

                        validationBatch = [];

                        await new Promise(resolve => setImmediate(resolve));
                        
                        const now = Date.now();
                        if (now - lastEmitTime > 1000) {
                            lastEmitTime = now;
                            this.eventsService.emit({
                                uploadId,
                                type: 'progress',
                                data: {
                                    progress: 10,
                                    processedRecords: totalRecordsCount,
                                    failedRecords: invalidRowSet.size,
                                    status: 'validating',
                                    message: `Validating: ${totalRecordsCount.toLocaleString()} rows scanned...`
                                }
                            });
                        }
                    }
                });

                if (validationBatch.length > 0) {
                    const batchErrors = this.validator.validateRecords(validationBatch);
                    for (const e of batchErrors) await writeError(e);
                    
                    // DB Uniqueness Check
                    const dbErrors = await this.checkDbUniqueness(validationBatch, prisma);
                    for (const e of dbErrors) await writeError(e);
                }
                
                await new Promise<void>((resolve, reject) =>
                    errorFileStream.end((err: any) => err ? reject(err) : resolve())
                );
                fs.renameSync(errorReportTmp, errorReportPath);

                const totalInvalidRows = invalidRowSet.size;
                const totalValidRows = totalRecordsCount - totalInvalidRows;

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

                await this.notificationsService.create({
                    userId,
                    title: 'Employee Validation Completed',
                    message: `Bulk validation finished: ${totalValidRows} valid rows, ${totalInvalidRows} invalid.`,
                    category: 'system',
                    priority: 'normal',
                    channels: ['inApp']
                });

                await job.progress(100);
                this.eventsService.emit({
                    uploadId,
                    type: 'completed',
                    data: { 
                        status: 'validated', 
                        progress: 100,
                        successRecords: totalValidRows,
                        failedRecords: totalInvalidRows,
                        totalRecords: totalRecordsCount
                    }
                });
                return;
            }

            await prisma.bulkUpload.update({
                where: { id: uploadId },
                data: {
                    status: 'completed',
                    message: `Import completed: ${progress.successRecords} added/updated, ${progress.failedRecords} failed.`,
                    successRecords: progress.successRecords,
                    failedRecords: progress.failedRecords,
                    processedRecords: progress.processedRecords,
                    errors: progress.errors.slice(0, 100) as any,
                    completedAt: new Date(),
                },
            });

            await this.notificationsService.create({
                userId,
                title: 'Employee Import Completed',
                message: `Bulk import finished: ${progress.successRecords} added/updated, ${progress.failedRecords} failed.`,
                category: 'system',
                priority: 'high',
                channels: ['inApp']
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
                    message: `Import completed: ${progress.successRecords} added/updated, ${progress.failedRecords} failed.`,
                }
            });

        } catch (error) {
            this.logger.error(`[Job ${job.id}] FAILED: ${error.message}`);
            try {
                await prisma.bulkUpload.update({
                    where: { id: uploadId },
                    data: { status: 'failed', completedAt: new Date(), message: `Error: ${error.message}` },
                });
                this.eventsService.emit({ uploadId, type: 'failed', data: { message: error.message } });
            } catch (e) { }
        }
    }

    private async processBatch(
        batch: ParsedRecord[],
        progress: UploadProgress,
        uploadId: string,
        prisma: PrismaService,
        tenantMasterData: MasterDataService,
        seenImportCnics: Map<string, string>,
        seenImportEmails: Map<string, string>
    ): Promise<void> {
        for (const record of batch) {
            try {
                const employeeId = String(record.data.employeeId || record.data.employeeID || record.data['Employee ID'] || record.data.employeeid || '').trim();
                const rawCnic = String(record.data.cnicNumber || record.data.CNIC || record.data['CNIC Number'] || record.data['CNIC-Number'] || '').trim();
                const rawEmail = record.data.officialEmail || record.data['Official Email'] ? String(record.data.officialEmail || record.data['Official Email']).trim().toLowerCase() : null;

                if (!employeeId) {
                    throw new Error('Employee ID is missing in record.');
                }

                // 1. In-memory check for CNIC duplication within the current import job
                if (rawCnic && seenImportCnics.has(rawCnic) && seenImportCnics.get(rawCnic) !== employeeId) {
                    throw new Error(`Duplicate CNIC Number '${rawCnic}' found within this upload file.`);
                }
                if (rawCnic) {
                    seenImportCnics.set(rawCnic, employeeId);
                }

                // 2. In-memory check for Official Email duplication within the current import job (downgrade to null if duplicate)
                let useEmail = rawEmail;
                if (rawEmail) {
                    if (seenImportEmails.has(rawEmail) && seenImportEmails.get(rawEmail) !== employeeId) {
                        this.logger.warn(`Duplicate Official Email '${rawEmail}' found within this upload file. Setting email to null for Employee '${employeeId}'.`);
                        useEmail = null;
                    } else {
                        seenImportEmails.set(rawEmail, employeeId);
                    }
                }

                const employeeData = await this.prepareEmployeeData(record, tenantMasterData);

                // Override officialEmail in payload if we downgraded it
                if (useEmail === null && employeeData.officialEmail !== null) {
                    employeeData.officialEmail = null;
                }

                // Pre-flight: validate required resolved IDs before hitting Prisma
                const missing: string[] = [];
                if (!employeeData.department?.connect?.id) missing.push('Department (not found in master data)');
                if (!employeeData.designation?.connect?.id) missing.push('Designation (not found in master data)');
                if (!employeeData.employeeGrade?.connect?.id) missing.push('Employee Grade (not found in master data)');
                if (!employeeData.workingHoursPolicy?.connect?.id) missing.push('Working Hours Policy (not found in master data)');
                if (!employeeData.leavesPolicy?.connect?.id) missing.push('Leaves Policy (not found in master data)');
                if (!employeeData.country?.connect?.id) missing.push('Country (not found — check spelling)');
                if (!employeeData.state?.connect?.id) missing.push('State (not found — ensure Country is valid so State can be auto-created)');
                if (!employeeData.city?.connect?.id) missing.push('City (not found — ensure State is valid so City can be auto-created)');
                if (missing.length > 0) {
                    throw new Error(`Missing required fields: ${missing.join('; ')}`);
                }

                // 3. Query Database for existing records with conflicting unique fields
                const existingById = await prisma.employee.findUnique({ where: { employeeId } });
                const existingByCnic = rawCnic ? await prisma.employee.findUnique({ where: { cnicNumber: rawCnic } }) : null;
                const existingByEmail = useEmail ? await prisma.employee.findUnique({ where: { officialEmail: useEmail } }) : null;

                let existing = existingById;
                if (!existing && existingByCnic) {
                    existing = existingByCnic;
                    this.logger.log(`CNIC match: Employee ${existing.employeeName} (ID: ${existing.employeeId}) matches CNIC ${rawCnic}. Updating existing record to new Employee ID ${employeeId}.`);
                }

                // Uniqueness validations against other records in DB
                if (existing) {
                    if (rawCnic && existingByCnic && existingByCnic.id !== existing.id) {
                        throw new Error(`Conflict: CNIC Number '${rawCnic}' is already registered to another employee (${existingByCnic.employeeId}).`);
                    }
                    if (useEmail && existingByEmail && existingByEmail.id !== existing.id) {
                        this.logger.warn(`Conflict: Email '${useEmail}' is already in use by another employee (${existingByEmail.employeeId}). Setting email to null for Employee '${employeeId}'.`);
                        employeeData.officialEmail = null;
                    }
                    if (existingById && existingById.id !== existing.id) {
                        throw new Error(`Conflict: Employee ID '${employeeId}' is already registered to another employee (${existingById.employeeName}).`);
                    }
                } else {
                    if (useEmail && existingByEmail) {
                        this.logger.warn(`Conflict: Email '${useEmail}' is already in use by another employee (${existingByEmail.employeeId}). Setting email to null for new Employee '${employeeId}'.`);
                        employeeData.officialEmail = null;
                    }
                }

                if (existing) {
                    // Update employee data
                    await prisma.employeeQualification.deleteMany({ where: { employeeId: existing.id } });
                    
                    const { qualifications, ...basicData } = employeeData;
                    await prisma.employee.update({ 
                        where: { id: existing.id }, 
                        data: {
                            ...basicData,
                            employeeId,
                            qualifications: qualifications && qualifications.length > 0 ? {
                                create: qualifications
                            } : undefined
                        } 
                    });
                } else {
                    const { qualifications, ...basicData } = employeeData;
                    await prisma.employee.create({ 
                        data: { 
                            ...basicData, 
                            employeeId,
                            qualifications: qualifications && qualifications.length > 0 ? {
                                create: qualifications
                            } : undefined
                        } 
                    });
                }
                progress.successRecords++;
            } catch (error) {
                let errorMessage = error.message;

                // Handle Prisma Unique Constraint Errors (P2002) as a fallback
                if (error.code === 'P2002') {
                    const target = (error.meta?.target as string[]) || [];
                    const rowEmpId = String(record.data.employeeId || record.data.employeeID || record.data['Employee ID'] || '');
                    if (target.includes('officialEmail')) {
                        errorMessage = `Conflict: Email '${record.data.officialEmail || record.data['Official Email']}' is already in use by another employee.`;
                    } else if (target.includes('cnicNumber')) {
                        errorMessage = `Conflict: CNIC Number '${record.data.cnicNumber || record.data['CNIC Number']}' is already registered.`;
                    } else if (target.includes('employeeId')) {
                        errorMessage = `Conflict: Employee ID '${rowEmpId}' already exists.`;
                    } else {
                        errorMessage = `Conflict: A unique constraint failed on ${target.join(', ')}`;
                    }
                }

                this.logger.warn(`Failed row ${record.row}: ${errorMessage}`);
                progress.failedRecords++;
                progress.errors.push({
                    row: record.row,
                    reason: errorMessage,
                    data: record.data
                });
            }
            progress.processedRecords++;
        }
    }

    private async prepareEmployeeData(record: ParsedRecord, tenantMasterData: MasterDataService): Promise<any> {
        const { data } = record;

        const parseBool = (val: any): boolean => {
            if (val === undefined || val === null) return false;
            const s = String(val).trim().toLowerCase();
            return ['true', 'yes', '1', 'active'].includes(s);
        };

        const parseDate = (val: any): Date | null => {
            if (!val) return null;
            if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
            
            if (typeof val === 'number') {
                const date = new Date(Math.round((val - 25569) * 86400 * 1000));
                return isNaN(date.getTime()) ? null : date;
            }
            
            const str = String(val).trim();
            if (!str) return null;
            
            const parsed = new Date(str);
            if (!isNaN(parsed.getTime())) return parsed;
            
            const parts = str.split(/[-/]/);
            if (parts.length === 3) {
                const p0 = parseInt(parts[0], 10);
                const p1 = parseInt(parts[1], 10);
                const p2 = parseInt(parts[2], 10);
                if (p2 > 1000 && p0 <= 31 && p1 <= 12) {
                    const d = new Date(p2, p1 - 1, p0);
                    if (!isNaN(d.getTime())) return d;
                }
            }
            return null;
        };

        const getOptionalString = (val: any): string | null => {
            if (val === undefined || val === null) return null;
            const str = String(val).trim();
            return str === '' ? null : str;
        };

        const [
            deptId, designationId, gradeId, maritalId, empStatusId, locId, whPolicyId, leavesPolicyId, allocationId, countryId,
            qualificationId, instituteId
        ] = await Promise.all([
            tenantMasterData.getOrCreateDepartment(data.department || data.Department),
            tenantMasterData.getOrCreateDesignation(data.designation || data.Designation),
            tenantMasterData.getOrCreateEmployeeGrade(data.employeeGrade || data['Employee Grade'] || data.Grade || data.grade),
            tenantMasterData.getOrCreateMaritalStatus(data.maritalStatus || data['Marital Status']),
            tenantMasterData.getOrCreateEmploymentStatus(data.employmentStatus || data['Employment Status']),
            tenantMasterData.getOrCreateLocation(data.branch || data.Branch || data.location || data.Location),
            tenantMasterData.getOrCreateWorkingHoursPolicy(data.workingHoursPolicy || data['Working Hours Policy']),
            tenantMasterData.getOrCreateLeavesPolicy(data.leavesPolicy || data['Leaves Policy']),
            tenantMasterData.getOrCreateAllocation(data.allocation || data.Allocation),
            tenantMasterData.findCountryByName(data.country || data.Country),
            tenantMasterData.getOrCreateQualification(data.qualification || data.Qualification),
            tenantMasterData.getOrCreateInstitute(data.institute || data.Institute),
        ]);

        const [subDeptId, stateId] = await Promise.all([
            tenantMasterData.getOrCreateSubDepartment(data.subDepartment || data['Sub Department'] || data['Sub-Department'], deptId),
            countryId ? tenantMasterData.getOrCreateState(
                data.state || data.province || data.State || data.Province || data['State'] || data['Province/State'] || data['State/Province'],
                countryId
            ) : null,
        ]);

        const rawCity = data.city || data.City || data['City'];
        const cityId = (stateId && rawCity && countryId) ? await tenantMasterData.getOrCreateCity(rawCity, stateId, countryId) : null;

        return {
            employeeName: String(data.employeeName || data['Employee Name'] || ''),
            fatherHusbandName: data.fatherHusbandName || data['Father/Husband'] || data['Father / Husband Name'] || data['Father/Husband Name'] || '',
            attendanceId: (data.attendanceId || data['Attendance ID']) ? String(data.attendanceId || data['Attendance ID']).trim() : String(data.employeeId || data.employeeID || data['Employee ID'] || data.employeeid || '').trim(),
            cnicNumber: String(data.cnicNumber || data.CNIC || data['CNIC Number'] || '').trim(),
            cnicExpiryDate: parseDate(data.cnicExpiryDate || data['CNIC Expiry']),
            lifetimeCnic: parseBool(data.lifetimeCnic || data['Lifetime CNIC']),
            joiningDate: parseDate(data.joiningDate || data['Joining Date']) || new Date(),
            probationExpiryDate: parseDate(data.probationExpiryDate || data['Probation Expiry']),
            dateOfBirth: parseDate(data.dateOfBirth || data['Date of Birth']),
            gender: data.gender || data.Gender || 'male',
            contactNumber: String(data.contactNumber || data['Contact Number'] || '').trim(),
            personalEmail: getOptionalString(data.personalEmail ?? data['Personal Email']),
            officialEmail: getOptionalString(data.officialEmail ?? data['Official Email']),
            currentAddress: getOptionalString(data.currentAddress ?? data['Current Address']),
            permanentAddress: getOptionalString(data.permanentAddress ?? data['Permanent Address']),
            employeeSalary: (() => {
                const raw = data.employeeSalary ?? data.Salary ?? data['Employee Salary'] ?? data['employee_salary'] ?? data['EmployeeSalary'];
                const num = Number(raw);
                return (!raw && raw !== 0) ? 0 : isNaN(num) ? 0 : num;
            })(),
            bankName: getOptionalString(data.bankName ?? data['Bank Name']),
            accountNumber: getOptionalString(data.accountNumber ?? data['Account Number']),
            accountTitle: getOptionalString(data.accountTitle ?? data['Account Title']),
            status: data.status || data.Status || 'active',
            department: deptId ? { connect: { id: deptId } } : undefined,
            subDepartment: subDeptId ? { connect: { id: subDeptId } } : undefined,
            designation: designationId ? { connect: { id: designationId } } : undefined,
            employeeGrade: gradeId ? { connect: { id: gradeId } } : undefined,
            maritalStatus: maritalId ? { connect: { id: maritalId } } : undefined,
            employmentStatus: empStatusId ? { connect: { id: empStatusId } } : undefined,
            location: locId ? { connect: { id: locId } } : undefined,
            workingHoursPolicy: whPolicyId ? { connect: { id: whPolicyId } } : undefined,
            leavesPolicy: leavesPolicyId ? { connect: { id: leavesPolicyId } } : undefined,
            allocation: allocationId ? { connect: { id: allocationId } } : undefined,
            country: countryId ? { connect: { id: countryId } } : undefined,
            state: stateId ? { connect: { id: stateId } } : undefined,
            city: cityId ? { connect: { id: cityId } } : undefined,
            nationality: data.nationality || data.Nationality || 'Pakistani',
            daysOff: (data.daysOff || data['Days Off']) ? String(data.daysOff || data['Days Off']).trim() : null,
            reportingManager: getOptionalString(data.reportingManager ?? data['Reporting Manager']),
            allowRemoteAttendance: parseBool(data.allowRemoteAttendance || data['Remote Attendance']),
            overtimeApplicable: parseBool(data.overtimeApplicable || data['Overtime']),
            area: getOptionalString(data.area ?? data.Area),
            emergencyContactNumber: getOptionalString(data.emergencyContactNumber ?? data['Emergency Contact'] ?? data['Emergency Contact Number']),
            emergencyContactPerson: getOptionalString(data.emergencyContactPerson ?? data['Emergency Person'] ?? data['Emergency Contact Person']),
            eobi: parseBool(data.eobi || data['EOBI']),
            eobiNumber: getOptionalString(data.eobiNumber ?? data['EOBI Number']),
            providentFund: parseBool(data.providentFund || data['Provident Fund']),
            qualifications: qualificationId ? [
                {
                    qualification: { connect: { id: qualificationId } },
                    institute: instituteId ? { connect: { id: instituteId } } : undefined,
                    year: data.passingYear || data['Passing Year'] ? parseInt(data.passingYear || data['Passing Year'], 10) : null,
                    grade: (data.grade || data['Grade/CGPA']) ? String(data.grade || data['Grade/CGPA']) : null,
                    city: cityId ? { connect: { id: cityId } } : undefined,
                    state: stateId ? { connect: { id: stateId } } : undefined
                }
            ] : []
        };
    }

    private async checkDbUniqueness(records: ParsedRecord[], prisma: PrismaService): Promise<any[]> {
        const errors: any[] = [];
        const cnics = records.map(r => String(r.data.cnicNumber || r.data.CNIC || r.data['CNIC Number'] || '').trim()).filter(Boolean);

        if (cnics.length === 0) return [];

        const existingCnics = await prisma.employee.findMany({
            where: { cnicNumber: { in: cnics } },
            select: { cnicNumber: true, employeeId: true }
        });

        const cnicConflicts = new Map<string, string>(existingCnics.map(e => [e.cnicNumber!, e.employeeId!] as [string, string]));

        for (const record of records) {
            const data = record.data;
            const empId = String(data.employeeId || data.employeeID || data['Employee ID'] || data.employeeid || '');
            const cnic = String(data.cnicNumber || data.CNIC || data['CNIC Number'] || '').trim();

            if (cnic && cnicConflicts.has(cnic) && cnicConflicts.get(cnic) !== empId) {
                errors.push({
                    row: record.row,
                    field: 'CNICNumber',
                    value: cnic,
                    reason: ` CNIC is already registered to another employee `,
                    employeeId: empId,
                    employeeName: data.employeeName || data['Employee Name']
                });
            }
        }

        return errors;
    }
}
