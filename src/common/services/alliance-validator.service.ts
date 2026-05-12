import { Injectable, Logger } from '@nestjs/common';
import { AllianceParsedRecord } from './alliance-csv-parser.service';

export interface AllianceValidationError {
    row: number;
    field: string;
    value: any;
    reason: string;
}

export interface AllianceValidationResult {
    isValid: boolean;
    errors: AllianceValidationError[];
}

@Injectable()
export class AllianceValidatorService {
    private readonly logger = new Logger(AllianceValidatorService.name);

    /**
     * Parse a capping string like "Rs. 30,000/-" or "30000" into a number.
     * Returns null if not parseable.
     */
    parseCapping(value: string | undefined | null): number | null {
        if (!value) return null;
        // Strip currency symbols, commas, slashes, spaces
        const cleaned = value.replace(/[^0-9.]/g, '');
        const num = parseFloat(cleaned);
        return isNaN(num) ? null : num;
    }

    /**
     * Parse expiry date string (e.g. "10/31/2026" or "31-10-2026") into a Date.
     * Returns null if not parseable.
     */
    parseExpiry(value: string | undefined | null): Date | null {
        if (!value) return null;
        // Handle Excel serial date numbers
        if (/^\d{5}$/.test(String(value))) {
            const excelEpoch = new Date(1899, 11, 30);
            const date = new Date(excelEpoch.getTime() + Number(value) * 86400000);
            return isNaN(date.getTime()) ? null : date;
        }
        const d = new Date(value);
        return isNaN(d.getTime()) ? null : d;
    }

    /**
     * Parse BIN number — strip dashes and spaces, validate 4–8 digits.
     */
    parseBin(value: string | undefined | null): string | null {
        if (!value) return null;
        const cleaned = value.replace(/[\s\-]/g, '');
        return /^\d{4,8}$/.test(cleaned) ? cleaned : null;
    }

    validateRecord(record: AllianceParsedRecord): AllianceValidationResult {
        const errors: AllianceValidationError[] = [];
        const { row, data } = record;

        // Bank is required
        if (!data.bank || data.bank.trim() === '') {
            errors.push({ row, field: 'bank', value: data.bank, reason: 'Bank name is required.' });
        }

        // Alliance name is required
        if (!data.allianceName || data.allianceName.trim() === '') {
            errors.push({ row, field: 'allianceName', value: data.allianceName, reason: 'Alliance name is required.' });
        }

        // BIN number is required and must be 4–8 digits (dashes allowed in input)
        if (!data.binNumber || data.binNumber.trim() === '') {
            errors.push({ row, field: 'binNumber', value: data.binNumber, reason: 'Card BIN number is required.' });
        } else {
            const parsed = this.parseBin(data.binNumber);
            if (!parsed) {
                errors.push({
                    row,
                    field: 'binNumber',
                    value: data.binNumber,
                    reason: 'BIN number must be 4–8 digits (dashes allowed, e.g. "5556-99" or "55569900").',
                });
            }
        }

        // Expiry is optional but must be a valid date if provided
        if (data.expiry) {
            const parsed = this.parseExpiry(data.expiry);
            if (!parsed) {
                errors.push({
                    row,
                    field: 'expiry',
                    value: data.expiry,
                    reason: 'Expiry date is not a valid date (expected MM/DD/YYYY or similar).',
                });
            }
        }

        // Discount capping is optional but must be numeric if provided
        if (data.discountCapping) {
            const parsed = this.parseCapping(data.discountCapping);
            if (parsed === null) {
                errors.push({
                    row,
                    field: 'discountCapping',
                    value: data.discountCapping,
                    reason: 'Discount capping must be a numeric value (e.g. "30000" or "Rs. 30,000/-").',
                });
            }
        }

        // Card type validation (optional, but if provided should be Debit/Credit)
        if (data.cardType) {
            const lower = data.cardType.toLowerCase();
            if (!lower.includes('debit') && !lower.includes('credit') && !lower.includes('prepaid')) {
                errors.push({
                    row,
                    field: 'cardType',
                    value: data.cardType,
                    reason: 'Card type should be "Debit Card", "Credit Card", or "Prepaid Card".',
                });
            }
        }

        return { isValid: errors.length === 0, errors };
    }

    validateRecords(records: AllianceParsedRecord[]): AllianceValidationError[] {
        const allErrors: AllianceValidationError[] = [];
        for (const record of records) {
            const result = this.validateRecord(record);
            allErrors.push(...result.errors);
        }
        return allErrors;
    }
}
