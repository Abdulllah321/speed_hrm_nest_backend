import { Injectable, Logger } from '@nestjs/common';
import { MerchantParsedRecord } from './merchant-csv-parser.service';

export interface MerchantValidationError {
    row: number;
    field: string;
    value: any;
    reason: string;
}

export interface MerchantValidationResult {
    isValid: boolean;
    errors: MerchantValidationError[];
}

@Injectable()
export class MerchantValidatorService {
    private readonly logger = new Logger(MerchantValidatorService.name);

    /**
     * Parse merchant code to an integer.
     */
    parseMerchantCode(value: string | undefined | null): number | null {
        if (!value) return null;
        const cleaned = value.replace(/[^0-9]/g, '');
        const num = parseInt(cleaned, 10);
        return isNaN(num) ? null : num;
    }

    /**
     * Parse commission rate from decimal or percentage.
     */
    parseCommissionRate(decimalStr?: string, percentStr?: string): number | null {
        if (decimalStr) {
            const num = parseFloat(decimalStr.replace(/[^0-9.]/g, ''));
            if (!isNaN(num) && num >= 0 && num <= 1) {
                return num;
            }
        }
        if (percentStr) {
            const cleaned = percentStr.replace(/[^0-9.]/g, '');
            const percent = parseFloat(cleaned);
            if (!isNaN(percent) && percent >= 0) {
                return percent / 100;
            }
        }
        return null;
    }

    validateRecord(
        record: MerchantParsedRecord,
        locationCodes: Set<string>,
        coaCodes: Set<string>,
        seenKeys: Set<string>,
    ): MerchantValidationResult {
        const errors: MerchantValidationError[] = [];
        const { row, data } = record;

        // Tag ID is required
        if (!data.tagId || data.tagId.trim() === '') {
            errors.push({ row, field: 'tagId', value: data.tagId, reason: 'Tag ID is required.' });
        } else {
            const normalizedTagId = data.tagId.trim().toUpperCase();
            if (!locationCodes.has(normalizedTagId)) {
                errors.push({
                    row,
                    field: 'tagId',
                    value: data.tagId,
                    reason: `Tag ID "${data.tagId}" does not match any active Location code in the system.`,
                });
            }
        }

        // Description is required
        if (!data.description || data.description.trim() === '') {
            errors.push({ row, field: 'description', value: data.description, reason: 'Description is required.' });
        }

        // Bank is required
        if (!data.bank || data.bank.trim() === '') {
            errors.push({ row, field: 'bank', value: data.bank, reason: 'Bank name is required.' });
        }

        // Merchant Code is required and must be integer
        let parsedMerchantCode: number | null = null;
        if (!data.merchantCode || data.merchantCode.trim() === '') {
            errors.push({ row, field: 'merchantCode', value: data.merchantCode, reason: 'Merchant code is required.' });
        } else {
            parsedMerchantCode = this.parseMerchantCode(data.merchantCode);
            if (parsedMerchantCode === null) {
                errors.push({
                    row,
                    field: 'merchantCode',
                    value: data.merchantCode,
                    reason: 'Merchant code must be a valid integer.',
                });
            }
        }

        // Commission Rate (either decimal or percent) is required and must be valid
        const parsedRate = this.parseCommissionRate(data.commissionRateDecimal, data.commissionRatePercent);
        if (parsedRate === null) {
            errors.push({
                row,
                field: 'commissionRate',
                value: data.commissionRateDecimal || data.commissionRatePercent,
                reason: 'A valid Commission Rate Decimal (e.g. 0.011) or Commission Rate % (e.g. 1.1%) is required.',
            });
        }

        // Bank GL Code is required and must exist in Chart of Accounts
        if (!data.bankGlCode || data.bankGlCode.trim() === '') {
            errors.push({ row, field: 'bankGlCode', value: data.bankGlCode, reason: 'Bank GL Code is required.' });
        } else {
            const normalizedGl = data.bankGlCode.trim();
            if (!coaCodes.has(normalizedGl)) {
                errors.push({
                    row,
                    field: 'bankGlCode',
                    value: data.bankGlCode,
                    reason: `Bank GL Code "${data.bankGlCode}" does not match any active, non-group Chart of Accounts code.`,
                });
            }
        }

        // Duplicate checks within file
        if (data.tagId && parsedMerchantCode !== null) {
            const duplicateKey = `${data.tagId.trim().toUpperCase()}_${parsedMerchantCode}`;
            if (seenKeys.has(duplicateKey)) {
                errors.push({
                    row,
                    field: 'tagId+merchantCode',
                    value: `${data.tagId} + ${data.merchantCode}`,
                    reason: `Duplicate row in upload file for Tag ID "${data.tagId}" and Merchant Code "${data.merchantCode}".`,
                });
            } else {
                seenKeys.add(duplicateKey);
            }
        }

        return { isValid: errors.length === 0, errors };
    }
}
