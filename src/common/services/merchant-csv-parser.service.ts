import { Injectable, Logger } from '@nestjs/common';
import * as XLSX from 'xlsx';
import * as Papa from 'papaparse';

export interface MerchantParsedRecord {
    row: number;
    data: {
        costCentre?: string;
        tagId?: string;
        description?: string;
        bank?: string;
        merchantCode?: string;
        commissionRateDecimal?: string;
        commissionRatePercent?: string;
        bankGlCode?: string;
    };
}

@Injectable()
export class MerchantCsvParserService {
    private readonly logger = new Logger(MerchantCsvParserService.name);

    private normalizeValue(value: any): string | null {
        if (value === null || value === undefined) return null;
        const str = String(value).trim();
        const naPatterns = ['n/a', 'n / a', 'null', 'none', '-', '', '–', '—'];
        if (naPatterns.includes(str.toLowerCase())) return null;
        return str;
    }

    private isEmptyRow(row: any): boolean {
        if (!row) return true;
        const getValue = (keys: string[]) => {
            for (const key of keys) {
                const found = Object.keys(row).find(k =>
                    k.toLowerCase().replace(/[\s_\-\.]/g, '') === key.toLowerCase().replace(/[\s_\-\.]/g, '')
                );
                if (found && row[found] !== undefined && row[found] !== null && String(row[found]).trim() !== '') {
                    return row[found];
                }
            }
            return null;
        };
        // A row is empty if all essential fields like Tag ID, Bank and Merchant Code are missing
        const tagId = getValue(['tagid', 'tag id', 'locationcode', 'location code']);
        const bank = getValue(['bank', 'bankname', 'bank name']);
        const merchantCode = getValue(['merchantcode', 'merchant code', 'code']);
        return !tagId && !bank && !merchantCode;
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

    private mapColumns(row: any): MerchantParsedRecord['data'] {
        return {
            costCentre: this.normalizeValue(this.getValue(row, ['CostCentre', 'Cost Centre', 'CostCenter', 'Cost Center Tag'])) ?? undefined,
            tagId: this.normalizeValue(this.getValue(row, ['Tag ID', 'TagID', 'Tag Id', 'Location Code', 'LocationCode'])) ?? undefined,
            description: this.normalizeValue(this.getValue(row, ['Description', 'description', 'Desc'])) ?? undefined,
            bank: this.normalizeValue(this.getValue(row, ['Bank', 'BANK', 'Bank Name', 'BankName'])) ?? undefined,
            merchantCode: this.normalizeValue(this.getValue(row, ['Merchant code', 'MerchantCode', 'Merchant Code', 'Code'])) ?? undefined,
            commissionRateDecimal: this.normalizeValue(this.getValue(row, [
                'Commission Rate Decimal', 'CommissionRateDecimal', 'Commission Rate (Decimal)', 'Rate Decimal',
                'CommissionRate', 'Commission Rate', 'RATE', 'Rate'
            ])) ?? undefined,
            commissionRatePercent: this.normalizeValue(this.getValue(row, ['Commission Rate %', 'Commission Rate Percent', 'CommissionRate%', 'Rate Percent', 'Rate %'])) ?? undefined,
            bankGlCode: this.normalizeValue(this.getValue(row, ['Bank GL Code', 'BankGLCode', 'Bank GL', 'BankGL', 'GL Code', 'GLCode'])) ?? undefined,
        };
    }

    async parseCSVStreaming(fileBuffer: Buffer, onRecord: (record: MerchantParsedRecord) => Promise<void>): Promise<void> {
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
                    this.logger.log(`Streamed ${rowCount} Merchant records from CSV`);
                    resolve();
                },
                error: (error) => {
                    this.logger.error(`CSV streaming error: ${error.message}`);
                    reject(new Error(`Failed to stream CSV: ${error.message}`));
                },
            });
        });
    }

    async parseExcelStreaming(fileBuffer: Buffer, onRecord: (record: MerchantParsedRecord) => Promise<void>): Promise<void> {
        try {
            const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            if (!worksheet) return;

            const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
            
            // Find the actual header row index (skip leading blank rows / titles)
            let headerRowIdx = range.s.r;
            let foundHeader = false;
            // First pass: look for a row with at least 3 non-empty cells
            for (let R = range.s.r; R <= range.e.r; ++R) {
                let nonIdxCount = 0;
                for (let C = range.s.c; C <= range.e.c; ++C) {
                    const cell = worksheet[XLSX.utils.encode_cell({ r: R, c: C })];
                    if (cell && cell.v !== null && cell.v !== undefined && String(cell.v).trim() !== '') {
                        nonIdxCount++;
                    }
                }
                if (nonIdxCount >= 3) {
                    headerRowIdx = R;
                    foundHeader = true;
                    break;
                }
            }
            // Second pass fallback: if no row with >= 3 cells, take the first row with >= 1 cell
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
            this.logger.log(`Processed ${rowCount} Merchant records from Excel`);
        } catch (error) {
            this.logger.error(`Excel processing error: ${error.message}`);
            throw new Error(`Failed to process Excel: ${error.message}`);
        }
    }

    async parseFileStreaming(
        fileBuffer: Buffer,
        filename: string,
        onRecord: (record: MerchantParsedRecord) => Promise<void>,
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
