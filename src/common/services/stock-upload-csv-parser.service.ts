import { Injectable, Logger } from '@nestjs/common';
import * as XLSX from 'xlsx';
import * as Papa from 'papaparse';

/**
 * One parsed record = one (barcode × location × qty) triplet.
 * The template is a wide-format matrix:
 *
 *   BarCode   | C40001 | N10001 | SS1001 | ...
 *   ----------|--------|--------|--------|----
 *   4055013…  |   -    |   -    |   1    | ...
 *
 * We pivot it into individual records so the processor can handle
 * each (barcode, locationCode, qty) independently.
 */
export interface StockUploadParsedRecord {
    /** 1-based row number in the original file */
    row: number;
    data: {
        barCode: string;
        locationCode: string;
        qty: number;
    };
}

@Injectable()
export class StockUploadCsvParserService {
    private readonly logger = new Logger(StockUploadCsvParserService.name);

    // ─── Helpers ──────────────────────────────────────────────────────

    private normalizeValue(value: any): string | null {
        if (value === null || value === undefined) return null;
        const str = String(value).trim();
        const naPatterns = ['n/a', 'n / a', 'null', 'none', '-', '', '–', '—'];
        if (naPatterns.includes(str.toLowerCase())) return null;
        return str;
    }

    /**
     * Given a raw row object (header → value) and the list of location-code
     * column headers, emit one StockUploadParsedRecord per non-zero location.
     */
    private pivotRow(
        rawRow: Record<string, any>,
        locationHeaders: string[],
        fileRowNumber: number,
        onRecord: (r: StockUploadParsedRecord) => void,
    ): void {
        // Find the barcode column (case-insensitive, strip spaces/underscores)
        const barcodeKey = Object.keys(rawRow).find((k) =>
            k.toLowerCase().replace(/[\s_\-\.]/g, '') === 'barcode',
        );
        const barCode = barcodeKey ? this.normalizeValue(rawRow[barcodeKey]) : null;
        if (!barCode) return; // skip rows with no barcode

        for (const locCode of locationHeaders) {
            const rawQty = this.normalizeValue(rawRow[locCode]);
            if (rawQty === null) continue; // '-' or empty → skip

            const qty = parseFloat(rawQty);
            if (isNaN(qty) || qty === 0) continue; // zero or non-numeric → skip

            onRecord({
                row: fileRowNumber,
                data: { barCode, locationCode: locCode, qty },
            });
        }
    }

    // ─── CSV ──────────────────────────────────────────────────────────

    async parseCSVStreaming(
        fileBuffer: Buffer,
        onRecord: (record: StockUploadParsedRecord) => Promise<void>,
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            const csvString = fileBuffer.toString('utf-8');
            let fileRowNumber = 1; // header is row 1
            let locationHeaders: string[] = [];
            let headersResolved = false;

            Papa.parse(csvString, {
                header: true,
                skipEmptyLines: 'greedy',
                chunkSize: 1024 * 1024 * 2,
                chunk: async (results, parser) => {
                    parser.pause();

                    // Resolve location headers from the first chunk's meta
                    if (!headersResolved && results.meta?.fields) {
                        locationHeaders = results.meta.fields.filter(
                            (f) => f.toLowerCase().replace(/[\s_\-\.]/g, '') !== 'barcode',
                        );
                        headersResolved = true;
                    }

                    for (const row of results.data as Record<string, any>[]) {
                        fileRowNumber++;
                        const pending: StockUploadParsedRecord[] = [];
                        this.pivotRow(row, locationHeaders, fileRowNumber, (r) => pending.push(r));
                        for (const r of pending) {
                            await onRecord(r);
                        }
                    }

                    parser.resume();
                },
                complete: () => {
                    this.logger.log(`Streamed stock upload CSV — ${fileRowNumber - 1} data rows`);
                    resolve();
                },
                error: (error) => {
                    this.logger.error(`CSV streaming error: ${error.message}`);
                    reject(new Error(`Failed to stream CSV: ${error.message}`));
                },
            });
        });
    }

    // ─── Excel ────────────────────────────────────────────────────────

    async parseExcelStreaming(
        fileBuffer: Buffer,
        onRecord: (record: StockUploadParsedRecord) => Promise<void>,
    ): Promise<void> {
        try {
            const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            if (!worksheet) return;

            const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');

            // Read header row
            const headers: string[] = [];
            for (let C = range.s.c; C <= range.e.c; ++C) {
                const cell = worksheet[XLSX.utils.encode_cell({ r: range.s.r, c: C })];
                headers.push(cell ? String(cell.v).trim() : `COL_${C}`);
            }

            const locationHeaders = headers.filter(
                (h) => h.toLowerCase().replace(/[\s_\-\.]/g, '') !== 'barcode',
            );

            let recordCount = 0;
            for (let R = range.s.r + 1; R <= range.e.r; ++R) {
                const rowObj: Record<string, any> = {};
                let hasData = false;
                for (let C = range.s.c; C <= range.e.c; ++C) {
                    const cell = worksheet[XLSX.utils.encode_cell({ r: R, c: C })];
                    if (cell && cell.v !== null && cell.v !== undefined) {
                        rowObj[headers[C]] = cell.v;
                        hasData = true;
                    }
                }
                if (!hasData) continue;

                const pending: StockUploadParsedRecord[] = [];
                this.pivotRow(rowObj, locationHeaders, R + 1, (r) => pending.push(r));
                for (const r of pending) {
                    await onRecord(r);
                    recordCount++;
                }
            }

            this.logger.log(`Processed ${recordCount} stock upload records from Excel`);
        } catch (error) {
            this.logger.error(`Excel processing error: ${error.message}`);
            throw new Error(`Failed to process Excel: ${error.message}`);
        }
    }

    // ─── Dispatcher ───────────────────────────────────────────────────

    async parseFileStreaming(
        fileBuffer: Buffer,
        filename: string,
        onRecord: (record: StockUploadParsedRecord) => Promise<void>,
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
