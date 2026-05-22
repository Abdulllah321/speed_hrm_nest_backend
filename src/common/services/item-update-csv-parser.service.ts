import { Injectable, Logger } from '@nestjs/common';
import * as XLSX from 'xlsx';
import * as Papa from 'papaparse';

export interface ItemUpdateParsedRecord {
    row: number;
    data: {
        barCode?: string;
        salePrice?: number | null;
        fob?: number | null;
        taxRate1?: number | null;
        taxRate2?: number | null;
    };
}

@Injectable()
export class ItemUpdateCsvParserService {
    private readonly logger = new Logger(ItemUpdateCsvParserService.name);

    private normalizeValue(value: any): string | null {
        if (value === null || value === undefined) return null;
        const str = String(value).trim();
        const naPatterns = ['n/a', 'n / a', 'null', 'none', '-', '', '–', '—'];
        if (naPatterns.includes(str.toLowerCase())) return null;
        return str;
    }

    private parseNumber(value: any): number | null {
        if (value === null || value === undefined) return null;
        const str = String(value).trim().replace(/[^0-9.\-]/g, '');
        const num = parseFloat(str);
        return isNaN(num) ? null : num;
    }

    private isEmptyRow(row: any): boolean {
        if (!row) return true;
        const barCode = this.getValue(row, ['Barcode', 'Bar Code', 'barCode', 'Code']);
        const salePrice = this.getValue(row, ['Sale Price', 'SalePrice', 'UnitPrice', 'Unit Price', 'Price']);
        const fob = this.getValue(row, ['FOB', 'fob']);
        return !barCode && !salePrice && !fob;
    }

    private getValue(row: any, keys: string[]): any {
        if (!row) return null;
        for (const key of keys) {
            if (row[key] !== undefined) return row[key];
            const lowerKey = key.toLowerCase().replace(/[\s_\-\.]/g, '');
            const actualKey = Object.keys(row).find(k =>
                k.toLowerCase().replace(/[\s_\-\.]/g, '') === lowerKey
            );
            if (actualKey && row[actualKey] !== undefined) return row[actualKey];
        }
        return null;
    }

    private mapColumns(row: any): ItemUpdateParsedRecord['data'] {
        const rawSalePrice = this.getValue(row, ['Sale Price', 'SalePrice', 'UnitPrice', 'Unit Price', 'Price', 'Sale_Price']);
        const rawFob = this.getValue(row, ['FOB', 'fob', 'FobPrice', 'Fob Price']);
        const rawTaxRate1 = this.getValue(row, ['Sales Tax Rate', 'SalesTaxRate', 'Tax Rate 1', 'TaxRate1', 'taxrate1', 'taxRate1', 'Sales_Tax_Rate']);
        const rawTaxRate2 = this.getValue(row, ['Additional Sales Tax', 'AdditionalSalesTax', 'Tax Rate 2', 'TaxRate2', 'taxrate2', 'taxRate2', 'Additional_Sales_Tax']);

        return {
            barCode: this.normalizeValue(this.getValue(row, ['Barcode', 'Bar Code', 'barCode', 'Bar_Code', 'Code'])) ?? undefined,
            salePrice: rawSalePrice !== null && rawSalePrice !== undefined && String(rawSalePrice).trim() !== '' ? this.parseNumber(rawSalePrice) : undefined,
            fob: rawFob !== null && rawFob !== undefined && String(rawFob).trim() !== '' ? this.parseNumber(rawFob) : undefined,
            taxRate1: rawTaxRate1 !== null && rawTaxRate1 !== undefined && String(rawTaxRate1).trim() !== '' ? this.parseNumber(rawTaxRate1) : undefined,
            taxRate2: rawTaxRate2 !== null && rawTaxRate2 !== undefined && String(rawTaxRate2).trim() !== '' ? this.parseNumber(rawTaxRate2) : undefined,
        };
    }

    async parseCSVStreaming(fileBuffer: Buffer, onRecord: (record: ItemUpdateParsedRecord) => Promise<void>): Promise<void> {
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
                            await onRecord({
                                row: ++rowCount + 1,
                                data: this.mapColumns(row),
                            });
                        }
                    }
                    parser.resume();
                },
                complete: () => {
                    this.logger.log(`Streamed ${rowCount} Item Update records from CSV`);
                    resolve();
                },
                error: (error) => {
                    this.logger.error(`CSV streaming error: ${error.message}`);
                    reject(new Error(`Failed to stream CSV: ${error.message}`));
                },
            });
        });
    }

    async parseExcelStreaming(fileBuffer: Buffer, onRecord: (record: ItemUpdateParsedRecord) => Promise<void>): Promise<void> {
        try {
            const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            if (!worksheet) return;

            const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
            
            let headerRowIdx = range.s.r;
            let foundHeader = false;
            for (let R = range.s.r; R <= range.e.r; ++R) {
                let nonIdxCount = 0;
                for (let C = range.s.c; C <= range.e.c; ++C) {
                    const cell = worksheet[XLSX.utils.encode_cell({ r: R, c: C })];
                    if (cell && cell.v !== null && cell.v !== undefined && String(cell.v).trim() !== '') {
                        nonIdxCount++;
                    }
                }
                if (nonIdxCount >= 2) {
                    headerRowIdx = R;
                    foundHeader = true;
                    break;
                }
            }
            if (!foundHeader) {
                for (let R = range.s.r; R <= range.e.r; ++R) {
                    let hasCells = false;
                    for (let C = range.s.c; C <= range.e.c; ++C) {
                        const cell = worksheet[XLSX.utils.encode_cell({ r: R, c: C })];
                        if (cell && cell.v !== null && cell.v !== undefined && String(cell.v).trim() !== '') {
                            hasCells = true;
                            break;
                        }
                    }
                    if (hasCells) {
                        headerRowIdx = R;
                        break;
                    }
                }
            }

            const headers: string[] = [];
            for (let C = range.s.c; C <= range.e.c; ++C) {
                const cell = worksheet[XLSX.utils.encode_cell({ r: headerRowIdx, c: C })];
                headers.push(cell && cell.v !== null && cell.v !== undefined ? String(cell.v).trim() : `UNKNOWN_${C}`);
            }

            let rowCount = 0;
            for (let R = headerRowIdx + 1; R <= range.e.r; ++R) {
                const rowObj: any = {};
                let hasData = false;
                for (let C = range.s.c; C <= range.e.c; ++C) {
                    const cell = worksheet[XLSX.utils.encode_cell({ r: R, c: C })];
                    if (cell && cell.v !== null && cell.v !== undefined) {
                        rowObj[headers[C]] = cell.v;
                        hasData = true;
                    }
                }
                if (hasData && !this.isEmptyRow(rowObj)) {
                    await onRecord({
                        row: R + 1,
                        data: this.mapColumns(rowObj),
                    });
                    rowCount++;
                }
            }
            this.logger.log(`Processed ${rowCount} Item Update records from Excel`);
        } catch (error) {
            this.logger.error(`Excel processing error: ${error.message}`);
            throw new Error(`Failed to process Excel: ${error.message}`);
        }
    }

    async parseFileStreaming(
        fileBuffer: Buffer,
        filename: string,
        onRecord: (record: ItemUpdateParsedRecord) => Promise<void>,
    ): Promise<void> {
        const ext = filename.toLowerCase().split('.').pop();
        if (ext === 'csv') {
            return this.parseCSVStreaming(fileBuffer, onRecord);
        } else if (['xlsx', 'xls'].includes(ext as string)) {
            return this.parseExcelStreaming(fileBuffer, onRecord);
        } else {
            throw new Error(`Unsupported file format: ${ext}`);
        }
    }
}
