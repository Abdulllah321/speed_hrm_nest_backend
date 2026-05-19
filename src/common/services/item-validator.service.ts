import { Injectable, Logger } from '@nestjs/common';
import { ParsedRecord } from './csv-parser.service';

export interface ValidationError {
    row: number;
    field: string;
    value: any;
    reason: string;
    itemId?: string;
    barCode?: string;
}

export interface ValidationResult {
    isValid: boolean;
    errors: ValidationError[];
}

@Injectable()
export class ItemValidatorService {
    private readonly logger = new Logger(ItemValidatorService.name);

    /**
     * Validate a single item record.
     * Supports both the new uploader column names and legacy column names
     * (mapping is handled upstream in CsvParserService.mapColumns).
     */
    validateRecord(record: ParsedRecord): ValidationResult {
        const errors: ValidationError[] = [];
        const { row, data } = record;

        // Reference fields — attached to every error for traceability in the report
        const itemId = data.itemId ? String(data.itemId).trim() : undefined;
        const barCode = data.barCode ? String(data.barCode).trim() : undefined;

        const err = (field: string, value: any, reason: string): ValidationError =>
            ({ row, field, value, reason, itemId, barCode });

        // ── Required fields ────────────────────────────────────────────────────

        if (!data.sku || String(data.sku).trim() === '') {
            errors.push(err('SKU', data.sku, 'SKU is a required field and cannot be empty.'));
        }

        // "Unique No." / "Item ID" both map to itemId — optional, auto-generated if absent
        // No validation error here; the processor will assign a sequential ID when missing.

        if (data.unitPrice === null || data.unitPrice === undefined) {
            errors.push(err('Unit Price', data.unitPrice, 'Unit Price is required for catalog items.'));
        }

        // ── Numeric range checks ───────────────────────────────────────────────

        if (data.unitPrice !== null && data.unitPrice !== undefined) {
            const price = Number(data.unitPrice);
            if (isNaN(price)) {
                errors.push(err('Unit Price', data.unitPrice, 'Unit Price must be a valid number.'));
            } else if (price < 0) {
                errors.push(err('Unit Price', data.unitPrice, 'Unit Price must be zero or a positive value.'));
            }
        }

        if (data.unitCost !== null && data.unitCost !== undefined) {
            const cost = Number(data.unitCost);
            if (isNaN(cost)) {
                errors.push(err('Unit Cost', data.unitCost, 'Unit Cost must be a valid number.'));
            } else if (cost < 0) {
                errors.push(err('Unit Cost', data.unitCost, 'Unit Cost must be zero or a positive value.'));
            }
        }

        if (data.fob !== null && data.fob !== undefined) {
            const fob = Number(data.fob);
            if (isNaN(fob)) {
                errors.push(err('FOB', data.fob, 'FOB must be a valid number.'));
            } else if (fob < 0) {
                errors.push(err('FOB', data.fob, 'FOB must be zero or a positive value.'));
            }
        }

        // Sale Tax Rate (taxRate1)
        if (data.taxRate1 !== null && data.taxRate1 !== undefined) {
            const tr1 = Number(data.taxRate1);
            if (isNaN(tr1)) {
                errors.push(err('Sale Tax Rate', data.taxRate1, 'Sale Tax Rate must be a valid number.'));
            } else if (tr1 < 0 || tr1 > 100) {
                errors.push(err('Sale Tax Rate', data.taxRate1, 'Sale Tax Rate must be a percentage between 0 and 100.'));
            }
        }

        // Additional Sales Tax (taxRate2)
        if (data.taxRate2 !== null && data.taxRate2 !== undefined) {
            const tr2 = Number(data.taxRate2);
            if (isNaN(tr2)) {
                errors.push(err('Additional Sales Tax', data.taxRate2, 'Additional Sales Tax must be a valid number.'));
            } else if (tr2 < 0 || tr2 > 100) {
                errors.push(err('Additional Sales Tax', data.taxRate2, 'Additional Sales Tax must be a percentage between 0 and 100.'));
            }
        }

        // Discount %
        if (data.discountRate !== null && data.discountRate !== undefined) {
            const dr = Number(data.discountRate);
            if (isNaN(dr)) {
                errors.push(err('Discount %', data.discountRate, 'Discount % must be a valid number.'));
            } else if (dr < 0 || dr > 100) {
                errors.push(err('Discount %', data.discountRate, 'Discount % must be between 0 and 100.'));
            }
        }

        // ── Discount date logic ────────────────────────────────────────────────

        if (data.discountStartDate && !(data.discountStartDate instanceof Date) && isNaN(Date.parse(data.discountStartDate))) {
            errors.push(err('Discount Start Date', data.discountStartDate, 'Discount Start Date is not a valid date.'));
        }

        if (data.discountEndDate && !(data.discountEndDate instanceof Date) && isNaN(Date.parse(data.discountEndDate))) {
            errors.push(err('Discount End Date', data.discountEndDate, 'Discount End Date is not a valid date.'));
        }

        if (data.discountStartDate && data.discountEndDate) {
            const start = new Date(data.discountStartDate);
            const end = new Date(data.discountEndDate);
            if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && end < start) {
                errors.push(err('Discount End Date', data.discountEndDate, 'Discount End Date must be on or after Discount Start Date.'));
            }
        }

        // ── Launch Date ────────────────────────────────────────────────────────

        if (data.launchDate && !(data.launchDate instanceof Date) && isNaN(Date.parse(data.launchDate))) {
            errors.push(err('Launch Date', data.launchDate, 'Launch Date is not a valid date.'));
        }

        // ── String length guards ───────────────────────────────────────────────

        if (data.barCode && String(data.barCode).length > 50) {
            errors.push(err('BarCode', data.barCode, 'BarCode is too long (max 50 characters).'));
        }

        if (data.description && String(data.description).length > 1000) {
            errors.push(err('Description', data.description, 'Description is too long (max 1000 characters).'));
        }

        // ── Recommended fields ─────────────────────────────────────────────────

        if (!data.concept || String(data.concept).trim() === '') {
            errors.push(err('Brand', data.concept, 'Brand is highly recommended for item classification.'));
        }

        if (!data.division || String(data.division).trim() === '') {
            errors.push(err('Division', data.division, 'Division is recommended for item classification.'));
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
