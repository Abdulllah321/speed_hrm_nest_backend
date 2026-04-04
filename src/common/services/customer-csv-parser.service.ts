import { Injectable, Logger } from '@nestjs/common';
import * as XLSX from 'xlsx';
import * as Papa from 'papaparse';

export interface CustomerParsedRecord {
    row: number;
    data: {
        code?: string;
        name?: string;
        address?: string;
        contactNo?: string;
        email?: string;
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
        const code = this.getValue(row, ['Code', 'code', 'CODE', 'Customer Code']);
        const name = this.getValue(row, ['Name of Customer', 'Name', 'name', 'NAME', 'Customer Name']);
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

    private mapColumns(row: any): CustomerParsedRecord['data'] {
        return {
            code: this.normalizeValue(this.getValue(row, ['Code', 'code', 'CODE', 'Customer Code', 'CustomerCode'])) ?? undefined,
            name: this.normalizeValue(this.getValue(row, ['Name of Customer', 'Name', 'name', 'NAME', 'Customer Name', 'CustomerName'])) ?? undefined,
            address: this.normalizeValue(this.getValue(row, ['Address', 'address', 'ADDRESS'])) ?? undefined,
            contactNo: this.normalizeValue(this.getValue(row, ['Contact No.', 'Contact No', 'ContactNo', 'contactNo', 'Phone', 'phone'])) ?? undefined,
            email: this.normalizeValue(this.getValue(row, ['Email', 'email', 'EMAIL'])) ?? undefined,
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
