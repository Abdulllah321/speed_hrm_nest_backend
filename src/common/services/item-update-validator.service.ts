import { Injectable, Logger } from '@nestjs/common';
import { ItemUpdateParsedRecord } from './item-update-csv-parser.service';

export interface ItemUpdateValidationError {
    row: number;
    field: string;
    value: any;
    reason: string;
}

export interface ItemUpdateValidationResult {
    isValid: boolean;
    errors: ItemUpdateValidationError[];
}

@Injectable()
export class ItemUpdateValidatorService {
    private readonly logger = new Logger(ItemUpdateValidatorService.name);

    validateRecord(record: ItemUpdateParsedRecord, seenBarcodes: Set<string>): ItemUpdateValidationResult {
        const errors: ItemUpdateValidationError[] = [];
        const { row, data } = record;

        // 1. Barcode Validation
        if (!data.barCode || data.barCode.trim() === '') {
            errors.push({
                row,
                field: 'barCode',
                value: data.barCode,
                reason: 'Barcode is required.',
            });
        } else {
            const trimmedBarcode = data.barCode.trim();
            if (seenBarcodes.has(trimmedBarcode)) {
                errors.push({
                    row,
                    field: 'barCode',
                    value: data.barCode,
                    reason: `Duplicate Barcode "${data.barCode}" in upload file.`,
                });
            } else {
                seenBarcodes.add(trimmedBarcode);
            }
        }

        // 2. Sale Price Validation (optional but must be non-negative if provided)
        if (data.salePrice !== undefined) {
            if (data.salePrice === null) {
                errors.push({
                    row,
                    field: 'salePrice',
                    value: null,
                    reason: 'Sale Price must be a valid number.',
                });
            } else if (data.salePrice < 0) {
                errors.push({
                    row,
                    field: 'salePrice',
                    value: data.salePrice,
                    reason: 'Sale Price must be a non-negative number.',
                });
            }
        }

        // 3. FOB Price Validation (optional but must be non-negative if provided)
        if (data.fob !== undefined) {
            if (data.fob === null) {
                errors.push({
                    row,
                    field: 'fob',
                    value: null,
                    reason: 'FOB must be a valid number.',
                });
            } else if (data.fob < 0) {
                errors.push({
                    row,
                    field: 'fob',
                    value: data.fob,
                    reason: 'FOB must be a non-negative number.',
                });
            }
        }

        // 4. Sales Tax Rate 1 Validation (optional but must be non-negative if provided)
        if (data.taxRate1 !== undefined) {
            if (data.taxRate1 === null) {
                errors.push({
                    row,
                    field: 'taxRate1',
                    value: null,
                    reason: 'Sales Tax Rate must be a valid number.',
                });
            } else if (data.taxRate1 < 0 || data.taxRate1 > 100) {
                errors.push({
                    row,
                    field: 'taxRate1',
                    value: data.taxRate1,
                    reason: 'Sales Tax Rate must be a valid percentage between 0 and 100.',
                });
            }
        }

        // 5. Sales Tax Rate 2 Validation (optional but must be non-negative if provided)
        if (data.taxRate2 !== undefined) {
            if (data.taxRate2 === null) {
                errors.push({
                    row,
                    field: 'taxRate2',
                    value: null,
                    reason: 'Additional Sales Tax must be a valid number.',
                });
            } else if (data.taxRate2 < 0 || data.taxRate2 > 100) {
                errors.push({
                    row,
                    field: 'taxRate2',
                    value: data.taxRate2,
                    reason: 'Additional Sales Tax must be a valid percentage between 0 and 100.',
                });
            }
        }

        return { isValid: errors.length === 0, errors };
    }

    validateRecords(records: ItemUpdateParsedRecord[]): ItemUpdateValidationError[] {
        const allErrors: ItemUpdateValidationError[] = [];
        const seenBarcodes = new Set<string>();
        for (const record of records) {
            const result = this.validateRecord(record, seenBarcodes);
            allErrors.push(...result.errors);
        }
        return allErrors;
    }
}
