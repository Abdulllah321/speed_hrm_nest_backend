import { Injectable, Logger } from '@nestjs/common';
import * as XLSX from 'xlsx';
import * as Papa from 'papaparse';

export interface AllianceParsedRecord {
    row: number;
    data: {
        seqNo?: string;
        accountCode?: string;
        bank?: string;
        allianceName?: string;
        expiry?: string;
        binNumber?: string;
        cardName?: string;
        cardType?: string;
        discountCapping?: string;
    };
}

@Injectable()
export class AllianceCsvParserService {
    private readonly logger = new Logger(AllianceCsvParserService.name);

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
        // A row is empty if both bank and allianceName are missing
        const bank = getValue(['bank']);
        const name = getValue(['discountallianceoption', 'discountallianceoptionname', 'alliancename', 'alliancediscountoptionname']);
        return !bank && !name;
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

    private mapColumns(row: any): AllianceParsedRecord['data'] {
        return {
            seqNo: this.normalizeValue(this.getValue(row, ['S.No', 'SNo', 'S No', 'Seq', 'SeqNo', 'Sequence'])) ?? undefined,
            accountCode: this.normalizeValue(this.getValue(row, [
                'Account Sequential Code', 'AccountSequentialCode', 'AccountCode', 'Account Code', 'Code'
            ])) ?? undefined,
            bank: this.normalizeValue(this.getValue(row, ['BANK', 'Bank', 'bank', 'BankName', 'Bank Name'])) ?? undefined,
            allianceName: this.normalizeValue(this.getValue(row, [
                'Discount Alliance Option Name', 'DiscountAllianceOptionName', 'Alliance Name', 'AllianceName',
                'Discount Alliance Option', 'Alliance Option Name', 'Name'
            ])) ?? undefined,
            expiry: this.normalizeValue(this.getValue(row, [
                'Expiry', 'expiry', 'ExpiryDate', 'Expiry Date', 'End Date', 'EndDate', 'Valid Till'
            ])) ?? undefined,
            binNumber: this.normalizeValue(this.getValue(row, [
                'Card BIN Numbers', 'CardBINNumbers', 'BIN Numbers', 'BINNumbers', 'BIN', 'Bin Number',
                'BinNumber', 'Card BIN', 'CardBIN'
            ])) ?? undefined,
            cardName: this.normalizeValue(this.getValue(row, [
                'Bank Card Name', 'BankCardName', 'Card Name', 'CardName'
            ])) ?? undefined,
            cardType: this.normalizeValue(this.getValue(row, [
                'Debit/Credit Cards', 'DebitCreditCards', 'Card Type', 'CardType', 'Type'
            ])) ?? undefined,
            discountCapping: this.normalizeValue(this.getValue(row, [
                'Discount Capping', 'DiscountCapping', 'Max Discount', 'MaxDiscount', 'Capping', 'Cap'
            ])) ?? undefined,
        };
    }

    async parseCSVStreaming(fileBuffer: Buffer, onRecord: (record: AllianceParsedRecord) => Promise<void>): Promise<void> {
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
                    this.logger.log(`Streamed ${rowCount} Alliance records from CSV`);
                    resolve();
                },
                error: (error) => {
                    this.logger.error(`CSV streaming error: ${error.message}`);
                    reject(new Error(`Failed to stream CSV: ${error.message}`));
                },
            });
        });
    }

    async parseExcelStreaming(fileBuffer: Buffer, onRecord: (record: AllianceParsedRecord) => Promise<void>): Promise<void> {
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
            this.logger.log(`Processed ${rowCount} Alliance records from Excel`);
        } catch (error) {
            this.logger.error(`Excel processing error: ${error.message}`);
            throw new Error(`Failed to process Excel: ${error.message}`);
        }
    }

    async parseFileStreaming(
        fileBuffer: Buffer,
        filename: string,
        onRecord: (record: AllianceParsedRecord) => Promise<void>,
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
