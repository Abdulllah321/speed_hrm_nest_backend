import { Injectable, Logger } from '@nestjs/common';
import { SalesHistoryParsedRecord } from './sales-history-csv-parser.service';

export interface SalesHistoryValidationError {
    row: number;
    field: string;
    value: any;
    reason: string;
}

@Injectable()
export class SalesHistoryValidatorService {
    private readonly logger = new Logger(SalesHistoryValidatorService.name);

    validateRecord(record: SalesHistoryParsedRecord): SalesHistoryValidationError[] {
        const errors: SalesHistoryValidationError[] = [];
        const { row, data } = record;

        // DocumentNumber is required — it groups line items into one order
        if (!data.documentNumber || data.documentNumber.trim() === '') {
            errors.push({
                row,
                field: 'documentNumber',
                value: data.documentNumber,
                reason: 'DocumentNumber is required (e.g. Sale1, Sale2).',
            });
        }

        // BarCode is required — used to look up the Item record
        if (!data.barCode || data.barCode.trim() === '') {
            errors.push({
                row,
                field: 'barCode',
                value: data.barCode,
                reason: 'BarCode is required to identify the item.',
            });
        }

        // Quantity must be a positive integer
        if (data.quantity !== undefined && data.quantity !== null) {
            if (!Number.isFinite(data.quantity) || data.quantity <= 0) {
                errors.push({
                    row,
                    field: 'quantity',
                    value: data.quantity,
                    reason: 'Quantity must be a positive number.',
                });
            }
        }

        // UnitPrice must be non-negative
        if (data.unitPrice !== undefined && data.unitPrice !== null) {
            if (!Number.isFinite(data.unitPrice) || data.unitPrice < 0) {
                errors.push({
                    row,
                    field: 'unitPrice',
                    value: data.unitPrice,
                    reason: 'UnitPrice must be a non-negative number.',
                });
            }
        }

        // Discount percent 0-100
        if (data.discountPercent !== undefined && data.discountPercent !== null) {
            if (data.discountPercent < 0 || data.discountPercent > 100) {
                errors.push({
                    row,
                    field: 'discountPercent',
                    value: data.discountPercent,
                    reason: 'Discount percent must be between 0 and 100.',
                });
            }
        }

        // DocumentDate — basic format check if provided
        if (data.documentDate) {
            const d = new Date(data.documentDate);
            if (isNaN(d.getTime())) {
                errors.push({
                    row,
                    field: 'documentDate',
                    value: data.documentDate,
                    reason: 'DocumentDate is not a valid date.',
                });
            }
        }

        return errors;
    }

    validateRecords(records: SalesHistoryParsedRecord[]): SalesHistoryValidationError[] {
        const allErrors: SalesHistoryValidationError[] = [];
        for (const record of records) {
            allErrors.push(...this.validateRecord(record));
        }
        return allErrors;
    }
}
