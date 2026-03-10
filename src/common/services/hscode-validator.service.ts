import { Injectable, Logger } from '@nestjs/common';
import { HsCodeParsedRecord } from './hscode-csv-parser.service';

export interface HsCodeValidationError {
    row: number;
    field: string;
    value: any;
    reason: string;
}

export interface HsCodeValidationResult {
    isValid: boolean;
    errors: HsCodeValidationError[];
}

@Injectable()
export class HsCodeValidatorService {
    private readonly logger = new Logger(HsCodeValidatorService.name);

    /**
     * Validate a single HS Code record
     */
    validateRecord(record: HsCodeParsedRecord): HsCodeValidationResult {
        const errors: HsCodeValidationError[] = [];
        const { row, data } = record;

        // Required fields
        if (!data.hsCode || String(data.hsCode).trim() === '') {
            errors.push({
                row,
                field: 'hsCode',
                value: data.hsCode,
                reason: 'HS Code is a required field and cannot be empty.',
            });
        }

        // Validate HS Code format (basic validation)
        if (data.hsCode) {
            const hsCodeStr = String(data.hsCode).trim();
            // HS Code should be numeric with possible dots/slashes
            if (!/^[\d\.\s\/]+$/.test(hsCodeStr)) {
                errors.push({
                    row,
                    field: 'hsCode',
                    value: data.hsCode,
                    reason: 'HS Code should contain only numbers, dots, spaces, and forward slashes.',
                });
            }
        }

        // Product Category is optional - no validation required

        // Percentage validations (0-100 as whole numbers)
        const percentageFields = [
            { field: 'customsDutyCd', name: 'Customs Duty (CD)', value: data.customsDutyCd },
            { field: 'regulatoryDutyRd', name: 'Regulatory Duty (RD)', value: data.regulatoryDutyRd },
            { field: 'additionalCustomsDutyAcd', name: 'Additional Customs Duty (ACD)', value: data.additionalCustomsDutyAcd },
            { field: 'salesTax', name: 'Sales Tax (ST)', value: data.salesTax },
            { field: 'incomeTax', name: 'Income Tax (IT)', value: data.incomeTax },
        ];

        percentageFields.forEach(({ field, name, value }) => {
            if (value !== null && value !== undefined) {
                const num = Number(value);
                if (isNaN(num)) {
                    errors.push({
                        row,
                        field,
                        value,
                        reason: `${name} must be a valid number.`,
                    });
                } else if (num < 0 || num > 100) {
                    errors.push({
                        row,
                        field,
                        value,
                        reason: `${name} must be between 0 and 100 percent.`,
                    });
                }
            }
        });

        // Product Category length validation (optional field)
        if (data.productCategory && String(data.productCategory).length > 255) {
            errors.push({
                row,
                field: 'productCategory',
                value: data.productCategory,
                reason: 'Product Category is too long (max 255 characters).',
            });
        }

        // HS Code length validation
        if (data.hsCode && String(data.hsCode).length > 50) {
            errors.push({
                row,
                field: 'hsCode',
                value: data.hsCode,
                reason: 'HS Code is too long (max 50 characters).',
            });
        }

        return {
            isValid: errors.length === 0,
            errors,
        };
    }

    /**
     * Validate multiple records
     */
    validateRecords(records: HsCodeParsedRecord[]): HsCodeValidationError[] {
        const allErrors: HsCodeValidationError[] = [];

        for (const record of records) {
            const result = this.validateRecord(record);
            allErrors.push(...result.errors);
        }

        return allErrors;
    }

    /**
     * Check for duplicate HS Codes within the upload file
     */
    checkDuplicateHsCodes(records: HsCodeParsedRecord[]): HsCodeValidationError[] {
        const errors: HsCodeValidationError[] = [];
        const hsCodeMap = new Map<string, number[]>();

        records.forEach((record) => {
            if (record.data.hsCode) {
                const normalized = record.data.hsCode.trim().toLowerCase();
                const existing = hsCodeMap.get(normalized) || [];
                hsCodeMap.set(normalized, [...existing, record.row]);
            }
        });

        hsCodeMap.forEach((rows, hsCode) => {
            if (rows.length > 1) {
                rows.forEach((row) => {
                    errors.push({
                        row,
                        field: 'hsCode',
                        value: hsCode,
                        reason: `Duplicate HS Code found in file (appears in rows: ${rows.join(', ')})`,
                    });
                });
            }
        });

        return errors;
    }
}