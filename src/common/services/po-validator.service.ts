import { Injectable } from '@nestjs/common';
import { PoParsedRecord } from './po-csv-parser.service';

export interface PoValidationError {
    row: number;
    field: string;
    value: any;
    reason: string;
}

@Injectable()
export class PoValidatorService {

    /** Validate individual row fields */
    validateRecord(record: PoParsedRecord): PoValidationError[] {
        const errors: PoValidationError[] = [];
        const { row, data } = record;

        if (!data.vendorCode?.trim()) {
            errors.push({ row, field: 'vendorCode', value: data.vendorCode, reason: 'Vendor Code is required.' });
        }

        if (!data.itemId?.trim()) {
            errors.push({ row, field: 'itemId', value: data.itemId, reason: 'Item ID is required (must be the unique itemId, not SKU).' });
        }

        if (data.quantity === undefined || data.quantity === null) {
            errors.push({ row, field: 'quantity', value: data.quantity, reason: 'Quantity is required.' });
        } else if (data.quantity <= 0) {
            errors.push({ row, field: 'quantity', value: data.quantity, reason: 'Quantity must be greater than 0.' });
        }

        if (data.unitPrice === undefined || data.unitPrice === null) {
            errors.push({ row, field: 'unitPrice', value: data.unitPrice, reason: 'Unit Price is required.' });
        } else if (data.unitPrice < 0) {
            errors.push({ row, field: 'unitPrice', value: data.unitPrice, reason: 'Unit Price cannot be negative.' });
        }

        if (!data.orderType?.trim()) {
            errors.push({ row, field: 'orderType', value: data.orderType, reason: 'Order Type is required (LOCAL or IMPORT).' });
        } else if (!['LOCAL', 'IMPORT'].includes(data.orderType.toUpperCase())) {
            errors.push({ row, field: 'orderType', value: data.orderType, reason: 'Order Type must be LOCAL or IMPORT.' });
        }

        if (!data.goodsType?.trim()) {
            errors.push({ row, field: 'goodsType', value: data.goodsType, reason: 'Goods Type is required (CONSUMABLE or FRESH).' });
        } else if (!['CONSUMABLE', 'FRESH'].includes(data.goodsType.toUpperCase())) {
            errors.push({ row, field: 'goodsType', value: data.goodsType, reason: 'Goods Type must be CONSUMABLE or FRESH.' });
        }

        if (data.expectedDeliveryDate) {
            const d = new Date(data.expectedDeliveryDate);
            if (isNaN(d.getTime())) {
                errors.push({ row, field: 'expectedDeliveryDate', value: data.expectedDeliveryDate, reason: 'Invalid date format. Use YYYY-MM-DD.' });
            }
        }

        return errors;
    }

    validateRecords(records: PoParsedRecord[]): PoValidationError[] {
        const errors = records.flatMap(r => this.validateRecord(r));

        // Cross-row validations — only run if individual rows are clean enough
        const validRows = records.filter(r => this.validateRecord(r).length === 0);
        if (validRows.length === 0) return errors;

        // Rule: only one vendor per file
        const vendorCodes = [...new Set(validRows.map(r => r.data.vendorCode!.trim().toUpperCase()))];
        if (vendorCodes.length > 1) {
            validRows.forEach(r => {
                errors.push({ row: r.row, field: 'vendorCode', value: r.data.vendorCode, reason: `File must contain only one vendor. Found: ${vendorCodes.join(', ')}` });
            });
        }

        // Rule: all rows must have the same orderType
        const orderTypes = [...new Set(validRows.map(r => r.data.orderType!.toUpperCase()))];
        if (orderTypes.length > 1) {
            validRows.forEach(r => {
                errors.push({ row: r.row, field: 'orderType', value: r.data.orderType, reason: `All rows must have the same Order Type. Found: ${orderTypes.join(', ')}` });
            });
        }

        // Rule: all rows must have the same goodsType
        const goodsTypes = [...new Set(validRows.map(r => r.data.goodsType!.toUpperCase()))];
        if (goodsTypes.length > 1) {
            validRows.forEach(r => {
                errors.push({ row: r.row, field: 'goodsType', value: r.data.goodsType, reason: `All rows must have the same Goods Type. Found: ${goodsTypes.join(', ')}` });
            });
        }

        return errors;
    }

    /**
     * Cross-validate vendor type vs order type.
     * Called during import after vendor is resolved from DB.
     */
    validateVendorOrderTypeMatch(vendorType: string, orderType: string): string | null {
        const vt = vendorType.toUpperCase();
        const ot = orderType.toUpperCase();
        if (ot === 'LOCAL' && vt !== 'LOCAL') {
            return `LOCAL order requires a LOCAL vendor (vendor type is ${vt}).`;
        }
        if (ot === 'IMPORT' && vt !== 'IMPORT') {
            return `IMPORT order requires an IMPORT vendor (vendor type is ${vt}).`;
        }
        return null;
    }
}
