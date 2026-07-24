import { Injectable, Logger } from '@nestjs/common';
import * as XLSX from 'xlsx';
import * as Papa from 'papaparse';

export interface CustomerParsedRecord {
    row: number;
    data: {
        traderId?: string;
        subCode?: string;
        name?: string;
        company?: string;
        brands?: string;
        baseMargin?: number;
        cashMargin?: number;
        remarks?: string;
        address?: string;
        deliveryAddress?: string;
        contactNo?: string;
        email?: string;
        cnicNo?: string;
        ntn?: string;
        strn?: string;
    };
}

@Injectable()
export class CustomerCsvParserService {
    private readonly logger = new Logger(CustomerCsvParserService.name);

    private normalizeValue(value: any): string | null {
        if (value === null || value === undefined) return null;
        const str = String(value).trim();
        if (['n/a', 'n / a', 'null', 'none', '-', '', '–', '—'].includes(str.toLowerCase())) return null;
        return str;
    }

    private isEmptyRow(row: any): boolean {
        if (!row) return true;
        const code = this.getValue(row, ['Code', 'code', 'Sub Code', 'SubCode', 'Trader ID', 'TraderID']);
        const name = this.getValue(row, ['Company', 'Name of Customer', 'Name', 'name', 'Customer Name']);
        return !this.normalizeValue(code) && !this.normalizeValue(name);
    }

    private getValue(row: any, keys: string[]): any {
        for (const key of keys) {
            if (row[key] !== undefined) return row[key];
            const lk = key.toLowerCase().replace(/\s/g, '');
            const found = Object.keys(row).find(k => k.toLowerCase().replace(/\s/g, '') === lk);
            if (found) return row[found];
        }
        return null;
    }

    private parseNumber(val: any): number {
        if (val === null || val === undefined) return 0;
        const num = parseFloat(String(val).replace(/[^0-9.-]/g, ''));
        return isNaN(num) ? 0 : num;
    }

    private mapColumns(row: any): CustomerParsedRecord['data'] {
        const subCode = this.normalizeValue(this.getValue(row, ['Sub Code', 'SubCode', 'subCode']));
        const traderId = this.normalizeValue(this.getValue(row, ['Trader ID', 'TraderID', 'traderId']));
        const company = this.normalizeValue(this.getValue(row, ['Company', 'company']));
        const name = this.normalizeValue(this.getValue(row, ['Name of Customer', 'Name', 'name', 'Customer Name'])) || company || 'Unnamed Customer';

        return {
            traderId: traderId ?? undefined,
            subCode: subCode ?? undefined,
            name,
            company: company ?? undefined,
            brands: this.normalizeValue(this.getValue(row, ['Brands', 'brands'])) ?? undefined,
            baseMargin: this.parseNumber(this.getValue(row, ['Base Margin', 'BaseMargin', 'baseMargin'])),
            cashMargin: this.parseNumber(this.getValue(row, ['Cash Margin', 'CashMargin', 'cashMargin'])),
            remarks: this.normalizeValue(this.getValue(row, ['Rematks', 'Remarks', 'remarks'])) ?? undefined,
            address: this.normalizeValue(this.getValue(row, ['Address', 'address'])) ?? undefined,
            deliveryAddress: this.normalizeValue(this.getValue(row, ['Delivery Address', 'DeliveryAddress', 'deliveryAddress'])) ?? undefined,
            contactNo: this.normalizeValue(this.getValue(row, ['Contact No.', 'Contact No', 'ContactNo', 'contactNo', 'Phone', 'phone'])) ?? undefined,
            email: this.normalizeValue(this.getValue(row, ['Email', 'email'])) ?? undefined,
            cnicNo: this.normalizeValue(this.getValue(row, ['CNIC', 'cnicNo', 'cnic'])) ?? undefined,
            ntn: this.normalizeValue(this.getValue(row, ['NationalTaxNumber', 'NTN', 'ntn'])) ?? undefined,
            strn: this.normalizeValue(this.getValue(row, ['GeneralSalesTaxNumber', 'STRN', 'GSTN', 'strn'])) ?? undefined,
        };
    }

    async parseCSVStreaming(fileBuffer: Buffer, onRecord: (record: CustomerParsedRecord) => Promise<void>): Promise<void> {
        return new Promise((resolve, reject) => {
            const csvString = fileBuffer.toString('utf-8');
            let rowCount = 0;
            Papa.parse(csvString, {
                header: true,
                skipEmptyLines: 'greedy',
                chunkSize: 1024 * 1024 * 2,
                chunk: async (results, parser) => {
                    parser.pause();
                    for (const row of results.data) {
                        if (!this.isEmptyRow(row)) {
                            await onRecord({ row: ++rowCount + 1, data: this.mapColumns(row) });
                        }
                    }
                    parser.resume();
                },
                complete: () => resolve(),
                error: (err) => reject(new Error(`CSV parse error: ${err.message}`)),
            });
        });
    }

    async parseExcelStreaming(fileBuffer: Buffer, onRecord: (record: CustomerParsedRecord) => Promise<void>): Promise<void> {
        const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        if (!worksheet) return;

        const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
        const headers: string[] = [];
        for (let C = range.s.c; C <= range.e.c; ++C) {
            const cell = worksheet[XLSX.utils.encode_cell({ r: range.s.r, c: C })];
            headers.push(cell ? String(cell.v) : `COL_${C}`);
        }

        let rowCount = 0;
        for (let R = range.s.r + 1; R <= range.e.r; ++R) {
            const rowObj: any = {};
            let hasData = false;
            for (let C = range.s.c; C <= range.e.c; ++C) {
                const cell = worksheet[XLSX.utils.encode_cell({ r: R, c: C })];
                if (cell && cell.v !== null) { rowObj[headers[C]] = cell.v; hasData = true; }
            }
            if (hasData && !this.isEmptyRow(rowObj)) {
                await onRecord({ row: R + 1, data: this.mapColumns(rowObj) });
                rowCount++;
            }
        }
        this.logger.log(`Processed ${rowCount} customer records from Excel`);
    }

    async parseFileStreaming(fileBuffer: Buffer, filename: string, onRecord: (record: CustomerParsedRecord) => Promise<void>): Promise<void> {
        const ext = filename.toLowerCase().split('.').pop();
        if (ext === 'csv') return this.parseCSVStreaming(fileBuffer, onRecord);
        if (['xlsx', 'xls'].includes(ext as string)) return this.parseExcelStreaming(fileBuffer, onRecord);
        throw new Error(`Unsupported file format: ${ext}`);
    }
}
