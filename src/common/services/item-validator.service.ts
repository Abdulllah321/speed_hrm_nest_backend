import { Injectable, Logger } from '@nestjs/common';
import { ParsedRecord } from './csv-parser.service';

export interface ValidationError {
    row: number;
    field: string;
    value: any;
    reason: string;
}

export interface ValidationResult {
    isValid: boolean;
    errors: ValidationError[];
}

@Injectable()
export class ItemValidatorService {
    private readonly logger = new Logger(ItemValidatorService.name);

    /**
     * Validate a single item record
     */
    async validateRecord(record: ParsedRecord): Promise<ValidationResult> {
        const errors: ValidationError[] = [];
        const { row, data } = record;

        // Required fields
        if (!data.sku || data.sku.trim() === '') {
            errors.push({
                row,
                field: 'SKU',
                value: data.sku,
                reason: 'SKU is required',
            });
        }

        if (!data.itemId || data.itemId.trim() === '') {
            errors.push({
                row,
                field: 'ItemID',
                value: data.itemId,
                reason: 'ItemID is required',
            });
        }

        if (data.unitPrice === null || data.unitPrice === undefined) {
            errors.push({
                row,
                field: 'UnitPrice',
                value: data.unitPrice,
                reason: 'UnitPrice is required',
            });
        }

        // Numeric validations
        if (data.unitPrice !== null && data.unitPrice !== undefined && data.unitPrice < 0) {
            errors.push({
                row,
                field: 'UnitPrice',
                value: data.unitPrice,
                reason: 'UnitPrice must be non-negative',
            });
        }

        if (data.unitCost !== null && data.unitCost !== undefined && data.unitCost < 0) {
            errors.push({
                row,
                field: 'UnitCost',
                value: data.unitCost,
                reason: 'UnitCost must be non-negative',
            });
        }

        if (data.taxRate1 !== null && data.taxRate1 !== undefined && (data.taxRate1 < 0 || data.taxRate1 > 100)) {
            errors.push({
                row,
                field: 'TaxRate1',
                value: data.taxRate1,
                reason: 'TaxRate1 must be between 0 and 100',
            });
        }

        if (data.taxRate2 !== null && data.taxRate2 !== undefined && (data.taxRate2 < 0 || data.taxRate2 > 100)) {
            errors.push({
                row,
                field: 'TaxRate2',
                value: data.taxRate2,
                reason: 'TaxRate2 must be between 0 and 100',
            });
        }

        if (data.discountRate !== null && data.discountRate !== undefined && (data.discountRate < 0 || data.discountRate > 100)) {
            errors.push({
                row,
                field: 'DiscountRate',
                value: data.discountRate,
                reason: 'DiscountRate must be between 0 and 100',
            });
        }

        if (data.discountAmount !== null && data.discountAmount !== undefined && data.discountAmount < 0) {
            errors.push({
                row,
                field: 'DiscountAmount',
                value: data.discountAmount,
                reason: 'DiscountAmount must be non-negative',
            });
        }

        // Date validations
        if (data.discountStartDate && data.discountEndDate) {
            if (data.discountEndDate <= data.discountStartDate) {
                errors.push({
                    row,
                    field: 'DiscountEndDate',
                    value: data.discountEndDate,
                    reason: 'DiscountEndDate must be after DiscountStartDate',
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
    async validateRecords(records: ParsedRecord[]): Promise<ValidationError[]> {
        const allErrors: ValidationError[] = [];

        for (const record of records) {
            const result = await this.validateRecord(record);
            allErrors.push(...result.errors);
        }

        return allErrors;
    }

    /**
     * Check for duplicate SKUs within the upload file
     */
    checkDuplicateSKUs(records: ParsedRecord[]): ValidationError[] {
        const errors: ValidationError[] = [];
        const skuMap = new Map<string, number[]>(); // SKU -> [row numbers]

        records.forEach((record) => {
            if (record.data.sku) {
                const normalized = record.data.sku.trim().toLowerCase();
                const existing = skuMap.get(normalized) || [];
                skuMap.set(normalized, [...existing, record.row]);
            }
        });

        // Find duplicates
        skuMap.forEach((rows, sku) => {
            if (rows.length > 1) {
                rows.forEach((row) => {
                    errors.push({
                        row,
                        field: 'SKU',
                        value: sku,
                        reason: `Duplicate SKU found in file (appears in rows: ${rows.join(', ')})`,
                    });
                });
            }
        });

        return errors;
    }

    /**
     * Check for duplicate ItemIDs within the upload file
     */
    checkDuplicateItemIDs(records: ParsedRecord[]): ValidationError[] {
        const errors: ValidationError[] = [];
        const itemIdMap = new Map<string, number[]>();

        records.forEach((record) => {
            if (record.data.itemId) {
                const normalized = record.data.itemId.trim().toLowerCase();
                const existing = itemIdMap.get(normalized) || [];
                itemIdMap.set(normalized, [...existing, record.row]);
            }
        });

        itemIdMap.forEach((rows, itemId) => {
            if (rows.length > 1) {
                rows.forEach((row) => {
                    errors.push({
                        row,
                        field: 'ItemID',
                        value: itemId,
                        reason: `Duplicate ItemID found in file (appears in rows: ${rows.join(', ')})`,
                    });
                });
            }
        });

        return errors;
    }
}
