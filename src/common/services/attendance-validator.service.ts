import { Injectable, Logger } from '@nestjs/common';
import { ParsedRecord } from './csv-parser.service';

export interface ValidationError {
    row: number;
    field: string;
    value: any;
    reason: string;
    employeeId?: string;
    employeeName?: string;
}

export interface ValidationResult {
    isValid: boolean;
    errors: ValidationError[];
}

@Injectable()
export class AttendanceValidatorService {
    private readonly logger = new Logger(AttendanceValidatorService.name);

    /**
     * Validate a single attendance record
     */
    validateRecord(record: ParsedRecord): ValidationResult {
        const errors: ValidationError[] = [];
        const { row, data } = record;

        const employeeId = data.employeeId || data.employeeID || data['Employee ID'] || data['EmployeeID'];
        const employeeName = data.employeeName || data['Employee Name'] || data.name;

        const err = (field: string, value: any, reason: string): ValidationError =>
            ({ row, field, value, reason, employeeId, employeeName });

        if (!employeeId || String(employeeId).trim() === '') {
            errors.push(err('EmployeeID', employeeId, 'Employee ID is required.'));
        }

        const date = data.date || data.Date;
        if (!date || String(date).trim() === '') {
            errors.push(err('Date', date, 'Attendance Date is required.'));
        } else if (!this.isValidDate(date)) {
            errors.push(err('Date', date, 'Invalid Date format. Use YYYY-MM-DD or DD-MM-YYYY.'));
        }

        const checkIn = data.checkIn || data['Check In'];
        if (checkIn && !this.isValidTimeOrDateTime(checkIn)) {
            errors.push(err('CheckIn', checkIn, 'Invalid Check In format. Use HH:MM or YYYY-MM-DD HH:MM:SS.'));
        }

        const checkOut = data.checkOut || data['Check Out'];
        if (checkOut && !this.isValidTimeOrDateTime(checkOut)) {
            errors.push(err('CheckOut', checkOut, 'Invalid Check Out format. Use HH:MM or YYYY-MM-DD HH:MM:SS.'));
        }

        return {
            isValid: errors.length === 0,
            errors,
        };
    }

    validateRecords(records: ParsedRecord[]): ValidationError[] {
        const errors: ValidationError[] = [];
        for (const record of records) {
            const result = this.validateRecord(record);
            if (!result.isValid) {
                errors.push(...result.errors);
            }
        }
        return errors;
    }

    private isValidDate(dateStr: any): boolean {
        if (!dateStr) return false;
        // Check excel serial dates
        if (!isNaN(Number(dateStr))) return true;

        const d = new Date(dateStr);
        if (!isNaN(d.getTime())) return true;
        if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(dateStr)) return true;
        if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr)) return true;
        return false;
    }

    private isValidTimeOrDateTime(val: any): boolean {
        if (!val) return true; // optional
        // Excel serial time/date
        if (!isNaN(Number(val))) return true;

        // HH:MM or HH:MM:SS
        if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(val)) return true;
        
        // Date time parsing
        const d = new Date(val);
        if (!isNaN(d.getTime())) return true;

        return false;
    }

    checkInternalDuplicates(records: ParsedRecord[]): ValidationError[] {
        const errors: ValidationError[] = [];
        const map = new Map<string, number[]>();

        records.forEach((record) => {
            const data = record.data;
            const empId = data.employeeId || data.employeeID || data['Employee ID'] || data['EmployeeID'];
            const date = data.date || data.Date;

            if (empId && date) {
                // simple normalization for dupe checking
                const dateNorm = new Date(date).toDateString();
                const key = `${String(empId).trim().toLowerCase()}_${dateNorm}`;
                map.set(key, [...(map.get(key) || []), record.row]);
            }
        });

        map.forEach((rows, key) => {
            if (rows.length > 1) {
                rows.forEach(row => {
                    errors.push({
                        row,
                        field: 'EmployeeID+Date',
                        value: key,
                        reason: `Duplicate Attendance record for same Employee and Date found in file (rows: ${rows.join(', ')})`
                    });
                });
            }
        });

        return errors;
    }
}
