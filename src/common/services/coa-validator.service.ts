import { Injectable, Logger } from '@nestjs/common';
import { CoaParsedRecord } from './coa-csv-parser.service';

export interface CoaValidationError {
    row: number;
    field: string;
    value: any;
    reason: string;
}

export interface CoaValidationResult {
    isValid: boolean;
    errors: CoaValidationError[];
}

const VALID_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'];

@Injectable()
export class CoaValidatorService {
    private readonly logger = new Logger(CoaValidatorService.name);

    /**
     * Validate a single COA record
     */
    validateRecord(record: CoaParsedRecord): CoaValidationResult {
        const errors: CoaValidationError[] = [];
        const { row, data } = record;

        // Required: code
        if (!data.code || String(data.code).trim() === '') {
            errors.push({
                row,
                field: 'code',
                value: data.code,
                reason: 'Account code is required and cannot be empty.',
            });
        }

        // Required: name
        if (!data.name || String(data.name).trim() === '') {
            errors.push({
                row,
                field: 'name',
                value: data.name,
                reason: 'Account name (GL Description) is required and cannot be empty.',
            });
        }

        // NOTE: No code-length or format validation.
        // Sub-ledger / party codes can be any length or format (6-digit numeric,
        // alphanumeric, etc.) and must all be accepted without restriction.

        // Type validation
        if (!VALID_TYPES.includes(data.type)) {
            errors.push({
                row,
                field: 'type',
                value: data.type,
                reason: `Invalid account type. Must be one of: ${VALID_TYPES.join(', ')}.`,
            });
        }

        // Balance validation (debit/credit must be non-negative if provided)
        if (data.debit !== undefined && data.debit !== null) {
            if (isNaN(data.debit) || data.debit < 0) {
                errors.push({
                    row,
                    field: 'debit',
                    value: data.debit,
                    reason: 'Debit amount must be a non-negative number.',
                });
            }
        }

        if (data.credit !== undefined && data.credit !== null) {
            if (isNaN(data.credit) || data.credit < 0) {
                errors.push({
                    row,
                    field: 'credit',
                    value: data.credit,
                    reason: 'Credit amount must be a non-negative number.',
                });
            }
        }

        return {
            isValid: errors.length === 0,
            errors,
        };
    }

    /**
     * Validate multiple records
     */
    validateRecords(records: CoaParsedRecord[]): CoaValidationError[] {
        const allErrors: CoaValidationError[] = [];

        for (const record of records) {
            const result = this.validateRecord(record);
            allErrors.push(...result.errors);
        }

        return allErrors;
    }

    /**
     * Check for duplicate structural COA codes within the upload file.
     *
     * Only 1/2/4/8-digit numeric codes are structural hierarchy codes and
     * must be unique. Everything else (6-digit party codes like 120150,
     * alphanumeric tags like DIR001/C00001) can legitimately repeat across
     * multiple parent accounts and is intentionally excluded.
     */
    checkDuplicateCodes(records: CoaParsedRecord[]): CoaValidationError[] {
        const errors: CoaValidationError[] = [];
        const codeMap = new Map<string, number[]>();

        records.forEach((record) => {
            const code = record.data.code;
            if (!code) return;
            const normalized = code.trim().toLowerCase();
            const isStructural = /^\d+$/.test(normalized) && [1, 2, 4, 8].includes(normalized.length);
            if (!isStructural) return;

            const existing = codeMap.get(normalized) || [];
            codeMap.set(normalized, [...existing, record.row]);
        });

        codeMap.forEach((rows, code) => {
            if (rows.length > 1) {
                rows.forEach((row) => {
                    errors.push({
                        row,
                        field: 'code',
                        value: code,
                        reason: `Duplicate structural account code "${code}" found in file (rows: ${rows.join(', ')})`,
                    });
                });
            }
        });

        return errors;
    }
}
