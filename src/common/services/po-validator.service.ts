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

        if (!data.barCode?.trim()) {
            errors.push({ row, field: 'barCode', value: data.barCode, reason: 'BarCode is required.' });
        }

        if (data.quantity === undefined || data.quantity === null) {
            errors.push({ row, field: 'quantity', value: data.quantity, reason: 'Quantity is required.' });
        } else if (data.quantity <= 0) {
            errors.push({ row, field: 'quantity', value: data.quantity, reason: 'Quantity must be greater than 0.' });
        }

        return errors;
    }

    validateRecords(records: PoParsedRecord[]): PoValidationError[] {
        return records.flatMap(r => this.validateRecord(r));
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
        if (ot === 'IMPORT' && vt !== 'IMPORT' && vt !== 'INTERNATIONAL') {
            return `IMPORT order requires an IMPORT or INTERNATIONAL vendor (vendor type is ${vt}).`;
        }
        return null;
    }
}
