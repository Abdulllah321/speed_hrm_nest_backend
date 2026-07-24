import { Injectable } from '@nestjs/common';
import { CustomerParsedRecord } from './customer-csv-parser.service';

export interface CustomerValidationError {
    row: number;
    field: string;
    value: any;
    reason: string;
}

@Injectable()
export class CustomerValidatorService {
    validateRecord(record: CustomerParsedRecord): CustomerValidationError[] {
        const errors: CustomerValidationError[] = [];
        const { row, data } = record;

        if (data.traderId && String(data.traderId).length > 50) {
            errors.push({ row, field: 'traderId', value: data.traderId, reason: 'Trader ID exceeds 50 characters.' });
        }

        if (!data.name || String(data.name).trim() === '') {
            errors.push({ row, field: 'name', value: data.name, reason: 'Customer Name is required.' });
        } else if (String(data.name).length > 255) {
            errors.push({ row, field: 'name', value: data.name, reason: 'Customer Name exceeds 255 characters.' });
        }

        if (data.email) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(String(data.email))) {
                errors.push({ row, field: 'email', value: data.email, reason: 'Invalid email format.' });
            }
        }

        if (data.contactNo && String(data.contactNo).length > 30) {
            errors.push({ row, field: 'contactNo', value: data.contactNo, reason: 'Contact No exceeds 30 characters.' });
        }

        return errors;
    }

    validateRecords(records: CustomerParsedRecord[]): CustomerValidationError[] {
        return records.flatMap(r => this.validateRecord(r));
    }
}
