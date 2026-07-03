import { Injectable } from '@nestjs/common';
import { SrnParsedRecord } from './srn-csv-parser.service';

@Injectable()
export class SrnValidatorService {
    validateRecord(record: SrnParsedRecord): Array<{ row: number; field: string; value: any; reason: string }> {
        const errors: Array<{ row: number; field: string; value: any; reason: string }> = [];
        const { data, row } = record;

        const hasBarCode = data.barCode && data.barCode.trim() !== '';
        const hasSku     = data.sku && data.sku.trim() !== '';

        if (!hasBarCode && !hasSku) {
            errors.push({ row, field: 'barCode/SKU', value: '', reason: 'Either BarCode or SKU is required.' });
        }

        if (data.quantity === null || data.quantity === undefined || isNaN(data.quantity)) {
            errors.push({ row, field: 'quantity', value: data.quantity, reason: 'Quantity must be a valid number.' });
        } else if (data.quantity <= 0) {
            errors.push({ row, field: 'quantity', value: data.quantity, reason: 'Quantity must be greater than 0.' });
        }

        return errors;
    }
}
