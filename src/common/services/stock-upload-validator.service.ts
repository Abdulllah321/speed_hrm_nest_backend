import { Injectable, Logger } from '@nestjs/common';
import { StockUploadParsedRecord } from './stock-upload-csv-parser.service';

export interface StockUploadValidationError {
    row: number;
    field: string;
    value: any;
    reason: string;
}

export interface StockUploadValidationResult {
    isValid: boolean;
    errors: StockUploadValidationError[];
}

@Injectable()
export class StockUploadValidatorService {
    private readonly logger = new Logger(StockUploadValidatorService.name);

    validateRecord(record: StockUploadParsedRecord): StockUploadValidationResult {
        const errors: StockUploadValidationError[] = [];
        const { row, data } = record;

        // ── BarCode ──────────────────────────────────────────────────
        if (!data.barCode || String(data.barCode).trim() === '') {
            errors.push({
                row,
                field: 'barCode',
                value: data.barCode,
                reason: 'BarCode is required and cannot be empty.',
            });
        } else if (String(data.barCode).length > 100) {
            errors.push({
                row,
                field: 'barCode',
                value: data.barCode,
                reason: 'BarCode is too long (max 100 characters).',
            });
        }

        // ── Location Code ────────────────────────────────────────────
        if (!data.locationCode || String(data.locationCode).trim() === '') {
            errors.push({
                row,
                field: 'locationCode',
                value: data.locationCode,
                reason: 'Location code is required.',
            });
        }

        // ── Quantity ─────────────────────────────────────────────────
        if (data.qty === null || data.qty === undefined) {
            errors.push({
                row,
                field: 'qty',
                value: data.qty,
                reason: 'Quantity is required.',
            });
        } else {
            const num = Number(data.qty);
            if (isNaN(num)) {
                errors.push({
                    row,
                    field: 'qty',
                    value: data.qty,
                    reason: 'Quantity must be a valid number.',
                });
            } else if (num === 0) {
                errors.push({
                    row,
                    field: 'qty',
                    value: data.qty,
                    reason: 'Quantity cannot be zero.',
                });
            } else if (num < -99999 || num > 99999) {
                errors.push({
                    row,
                    field: 'qty',
                    value: data.qty,
                    reason: 'Quantity must be between -99,999 and 99,999.',
                });
            }
        }

        return { isValid: errors.length === 0, errors };
    }

    validateRecords(records: StockUploadParsedRecord[]): StockUploadValidationError[] {
        const allErrors: StockUploadValidationError[] = [];
        for (const record of records) {
            const result = this.validateRecord(record);
            allErrors.push(...result.errors);
        }
        return allErrors;
    }
}
