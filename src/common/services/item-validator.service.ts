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
    validateRecord(record: ParsedRecord): ValidationResult {
        const errors: ValidationError[] = [];
        const { row, data } = record;

        // Required fields
        if (!data.sku || String(data.sku).trim() === '') {
            errors.push({
                row,
                field: 'SKU',
                value: data.sku,
                reason: 'SKU is a required field and cannot be empty.',
            });
        }

        if (!data.itemId || String(data.itemId).trim() === '') {
            errors.push({
                row,
                field: 'ItemID',
                value: data.itemId,
                reason: 'ItemID is a required unique identifier.',
            });
        }

        if (data.unitPrice === null || data.unitPrice === undefined) {
            errors.push({
                row,
                field: 'UnitPrice',
                value: data.unitPrice,
                reason: 'UnitPrice is required for catalog items.',
            });
        }

        // Numeric validations
        if (data.unitPrice !== null && data.unitPrice !== undefined) {
            const price = Number(data.unitPrice);
            if (isNaN(price)) {
                errors.push({
                    row,
                    field: 'UnitPrice',
                    value: data.unitPrice,
                    reason: 'UnitPrice must be a valid number.',
                });
            } else if (price < 0) {
                errors.push({
                    row,
                    field: 'UnitPrice',
                    value: data.unitPrice,
                    reason: 'UnitPrice must be zero or a positive value.',
                });
            }
        }

        if (data.unitCost !== null && data.unitCost !== undefined) {
            const cost = Number(data.unitCost);
            if (isNaN(cost)) {
                errors.push({
                    row,
                    field: 'UnitCost',
                    value: data.unitCost,
                    reason: 'UnitCost must be a valid number.',
                });
            } else if (cost < 0) {
                errors.push({
                    row,
                    field: 'UnitCost',
                    value: data.unitCost,
                    reason: 'UnitCost must be zero or a positive value.',
                });
            }
        }

        if (data.taxRate1 !== null && data.taxRate1 !== undefined) {
            const tr1 = Number(data.taxRate1);
            if (isNaN(tr1)) {
                errors.push({
                    row,
                    field: 'TaxRate1',
                    value: data.taxRate1,
                    reason: 'TaxRate1 must be a valid number.',
                });
            } else if (tr1 < 0 || tr1 > 100) {
                errors.push({
                    row,
                    field: 'TaxRate1',
                    value: data.taxRate1,
                    reason: 'TaxRate1 must be a percentage between 0 and 100.',
                });
            }
        }

        // Barcode validation (optional but if provided should be sane)
        if (data.barCode && String(data.barCode).length > 50) {
            errors.push({
                row,
                field: 'BarCode',
                value: data.barCode,
                reason: 'BarCode is too long (max 50 characters).',
            });
        }

        // Description validation
        if (data.description && String(data.description).length > 1000) {
            errors.push({
                row,
                field: 'Description',
                value: data.description,
                reason: 'Description is too long (max 1000 characters).',
            });
        }

        // Master Data sanity (Concept/Brand is usually required for a good catalog)
        if (!data.concept || String(data.concept).trim() === '') {
            errors.push({
                row,
                field: 'Concept',
                value: data.concept,
                reason: 'Concept (Brand) is highly recommended for item classification.',
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
    validateRecords(records: ParsedRecord[]): ValidationError[] {
        const allErrors: ValidationError[] = [];

        for (const record of records) {
            const result = this.validateRecord(record);
            allErrors.push(...result.errors);
        }

        return allErrors;
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
