import { Injectable, Logger } from '@nestjs/common';
import * as XLSX from 'xlsx';
import * as Papa from 'papaparse';
import { parse as csvParse } from 'csv-parse';
import * as fs from 'fs';

export interface ParsedRecord {
    row: number;
    data: any; // Allow flexibility for mapping
}

export type ParseCallback = (record: ParsedRecord) => Promise<void>;

@Injectable()
export class CsvParserService {
    private readonly logger = new Logger(CsvParserService.name);

    /**
     * Normalize N/A values to null
     * Handles: N/A, n/a, N / A, n / a, null, empty strings, whitespace
     */
    private normalizeValue(value: any): any {
        if (value === null || value === undefined) return null;

        const strValue = String(value).trim();

        // Check for various N/A patterns
        const naPatterns = ['n/a', 'n / a', 'null', 'none', '-', 'na', "NA"];
        if (naPatterns.includes(strValue.toLowerCase()) || strValue === '') {
            return null;
        }

        return strValue;
    }

    /**
     * Check if a row is empty (all object values are null/empty)
     */
    private isEmptyRow(row: any): boolean {
        if (!row || typeof row !== 'object') return true;

        const values = Object.values(row);
        if (values.length === 0) return true;

        return values.every(value => {
            const normalized = this.normalizeValue(value);
            return normalized === null || normalized === '';
        });
    }

    /**
     * Parse Date from various formats
     */
    private parseDate(value: any): Date | null {
        if (!value) return null;

        // Handle Excel numeric dates (serial numbers)
        // Excel stores dates as number of days since Dec 30, 1899
        let numericValue: number | null = null;
        if (typeof value === 'number') {
            numericValue = value;
        } else if (typeof value === 'string' && /^""d+$/.test(value.trim())) {
            numericValue = parseInt(value.trim(), 10);
        }

        if (numericValue !== null) {
            try {
                // Convert Excel serial date to JS Date
                const date = new Date(Math.round((numericValue - 25569) * 86400 * 1000));
                return isNaN(date.getTime()) ? null : date;
            } catch {
                return null;
            }
        }

        const normalized = this.normalizeValue(value);
        if (normalized === null) return null;

        try {
            const date = new Date(normalized);
            return isNaN(date.getTime()) ? null : date;
        } catch {
            return null;
        }
    }

    /**
     * Parse number from string
     */
    private parseNumber(value: any): number | null {
        const normalized = this.normalizeValue(value);
        if (normalized === null) return null;

        const num = parseFloat(normalized);
        return isNaN(num) ? null : num;
    }

    /**
     * Parse boolean from various formats
     */
    private parseBoolean(value: any): boolean | null {
        const normalized = this.normalizeValue(value);
        if (normalized === null) return null;

        const lowerValue = normalized.toLowerCase();
        if (['true', 'yes', '1', 'active'].includes(lowerValue)) return true;
        if (['false', 'no', '0', 'inactive'].includes(lowerValue)) return false;

        return null;
    }



    /**
     * Helper to find a value in a row object using case-insensitive key matching
     */
    private getValue(row: any, key: string): any {
        if (!row) return null;
        // Try exact match first for performance
        if (row[key] !== undefined) return row[key];

        // Case-insensitive match
        const lowerKey = key.toLowerCase().replace(/""s/g, '');
        const actualKey = Object.keys(row).find(k =>
            k.toLowerCase().replace(/""s/g, '') === lowerKey
        );

        return actualKey ? row[actualKey] : null;
    }

    /**
     * Map Excel column names to schema field names and preserve original fields.
     * Supports both legacy column names and the new uploader header format.
     */
    private mapColumns(row: any): ParsedRecord['data'] {
        return {
            ...row, // Keep all original row properties available for generic processors

            // Brand / Concept — new header: "Brand", legacy: "Concept"
            concept: this.normalizeValue(
                this.getValue(row, 'Brand') || this.getValue(row, 'Concept'),
            ),

            description: this.normalizeValue(this.getValue(row, 'Description')),

            fob: this.parseNumber(this.getValue(row, 'FOB')) as number,
            unitCost: this.parseNumber(this.getValue(row, 'Unit Cost') ?? this.getValue(row, 'UnitCost')) as number,
            unitPrice: this.parseNumber(this.getValue(row, 'Unit Price') ?? this.getValue(row, 'UnitPrice')) as number,

            // Tax rates — new headers: "Sale Tax Rate" / "Additional Sales Tax", legacy: "TaxRate1" / "TaxRate2"
            taxRate1: this.parseNumber(
                this.getValue(row, 'Sale Tax Rate') ?? this.getValue(row, 'TaxRate1'),
            ) as number,
            taxRate2: this.parseNumber(
                this.getValue(row, 'Additional Sales Tax') ?? this.getValue(row, 'TaxRate2'),
            ) as number,

            // Discount fields — new headers use spaces; legacy used PascalCase
            discountStartDate: this.parseDate(
                this.getValue(row, 'Discount Start Date') ?? this.getValue(row, 'DiscountStartDate'),
            ),
            discountEndDate: this.parseDate(
                this.getValue(row, 'Discount End Date') ?? this.getValue(row, 'DiscountEndDate'),
            ),
            discountRate: this.parseNumber(
                this.getValue(row, 'Discount %') ?? this.getValue(row, 'DiscountRate'),
            ) as number,
            discountAmount: this.parseNumber(this.getValue(row, 'DiscountAmount')) as number,

            isActive: this.parseBoolean(this.getValue(row, 'IsActive')) as boolean,

            sku: this.normalizeValue(this.getValue(row, 'SKU')),
            size: this.normalizeValue(this.getValue(row, 'Size')),
            color: this.normalizeValue(this.getValue(row, 'Color')),
            division: this.normalizeValue(this.getValue(row, 'Division')),
            department: this.normalizeValue(this.getValue(row, 'Department')),

            // Product Category — new header: "Product Category/Series", legacy: "ProductCategory"
            productCategory: this.normalizeValue(
                this.getValue(row, 'Product Category/Series') || this.getValue(row, 'ProductCategory'),
            ),

            // Silhouette — new header: "Silhouette/Prodcut Type" (note typo in spec), legacy: "Silhouette"
            silhouette: this.normalizeValue(
                this.getValue(row, 'Silhouette/Prodcut Type') ||
                this.getValue(row, 'Silhouette/Product Type') ||
                this.getValue(row, 'Silhouette'),
            ),

            class: this.normalizeValue(this.getValue(row, 'Class')),

            // Sub Class — new header uses a space: "Sub Class", legacy: "Subclass"
            subclass: this.normalizeValue(
                this.getValue(row, 'Sub Class') || this.getValue(row, 'Subclass'),
            ),

            channelClass: this.normalizeValue(
                this.getValue(row, 'Channel Class') || this.getValue(row, 'ChannelClass'),
            ),

            season: this.normalizeValue(this.getValue(row, 'Season')),

            // Old Season — new header: "Old Season", legacy: "OldSeason"
            oldSeason: this.normalizeValue(
                this.getValue(row, 'Old Season') || this.getValue(row, 'OldSeason'),
            ),

            gender: this.normalizeValue(this.getValue(row, 'Gender')),

            // Case Material — new header: "Case Material", legacy: "Case"
            case: this.normalizeValue(
                this.getValue(row, 'Case Material') || this.getValue(row, 'Case'),
            ),

            band: this.normalizeValue(this.getValue(row, 'Band')),

            // Movement Type — new header: "Movement Type" (with space), legacy: "MovementType"
            movementType: this.normalizeValue(
                this.getValue(row, 'Movement Type') || this.getValue(row, 'MovementType'),
            ),

            // Movement Name — new field
            movementName: this.normalizeValue(this.getValue(row, 'Movement Name')),

            // Heel Height — new header: "Heel Height" (with space), legacy: "HeelHeight"
            heelHeight: this.normalizeValue(
                this.getValue(row, 'Heel Height') || this.getValue(row, 'HeelHeight'),
            ),

            width: this.normalizeValue(this.getValue(row, 'Width')),

            // HS Code — new header: "HS Code" (with space), legacy: "HSCode"
            hsCode: this.normalizeValue(
                this.getValue(row, 'HS Code') || this.getValue(row, 'HSCode'),
            ),

            // Item ID — new header: "Item ID" (with space) or "Unique No.", legacy: "ItemID"
            itemId: this.normalizeValue(
                this.getValue(row, 'Item ID') ||
                this.getValue(row, 'Unique No.') ||
                this.getValue(row, 'ItemID'),
            ),

            barCode: this.normalizeValue(this.getValue(row, 'BarCode')),
            segment: this.normalizeValue(this.getValue(row, 'Segment')),

            // New fields
            uom: this.normalizeValue(this.getValue(row, 'UOM')),
            currency: this.normalizeValue(this.getValue(row, 'Currency')),
            launchDate: this.parseDate(this.getValue(row, 'Launch Date') ?? this.getValue(row, 'LaunchDate')),
        };
    }

    /**
     * Parse CSV from a file path using fs.createReadStream + csv-parse.
     * True streaming — never loads the full file into memory.
     * First rows flow within milliseconds of starting.
     */
    async parseCSVFromPath(filePath: string, onRecord: (record: ParsedRecord) => Promise<void>): Promise<void> {
        return new Promise((resolve, reject) => {
            let rowCount = 0;
            const parser = csvParse({ columns: true, skip_empty_lines: true, trim: true });
            const stream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 }); // 64KB chunks

            (async () => {
                try {
                    stream.pipe(parser);
                    for await (const record of parser) {
                        if (!this.isEmptyRow(record)) {
                            await onRecord({ row: ++rowCount + 1, data: this.mapColumns(record) });
                        }
                    }
                    this.logger.log(`Streamed ${rowCount} records from CSV file`);
                    resolve();
                } catch (err) {
                    stream.destroy();
                    this.logger.error(`CSV stream error: ${err.message}`);
                    reject(new Error(`Failed to stream CSV: ${err.message}`));
                }
            })();
        });
    }

    /**
     * Parse Excel from a file path using XLSX.readFile.
     * Avoids holding the raw buffer AND the parsed workbook in memory simultaneously.
     */
    async parseExcelFromPath(filePath: string, onRecord: (record: ParsedRecord) => Promise<void>): Promise<void> {
        try {
            const workbook = XLSX.readFile(filePath, { cellDates: true, dense: false });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            if (!worksheet) return;

            const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
            const headers: string[] = [];
            for (let C = range.s.c; C <= range.e.c; ++C) {
                const cell = worksheet[XLSX.utils.encode_cell({ r: range.s.r, c: C })];
                headers.push(cell ? String(cell.v) : `UNKNOWN_${C}`);
            }

            let rowCount = 0;
            for (let R = range.s.r + 1; R <= range.e.r; ++R) {
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
                    await onRecord({ row: R + 1, data: this.mapColumns(rowObj) });
                    rowCount++;
                    // Yield every 500 rows so the event loop stays responsive
                    if (rowCount % 500 === 0) {
                        await new Promise(resolve => setImmediate(resolve));
                    }
                }
            }

            // Free worksheet from memory
            workbook.Sheets[sheetName] = null as any;
            this.logger.log(`Processed ${rowCount} records from Excel file`);
        } catch (error) {
            this.logger.error(`Excel processing error: ${error.message}`);
            throw new Error(`Failed to process Excel: ${error.message}`);
        }
    }

    /**
     * Auto-detect and parse directly from a file path on disk.
     * Preferred over parseFileStreaming for large files — no buffer in memory.
     */
    async parseFileFromPath(filePath: string, filename: string, onRecord: (record: ParsedRecord) => Promise<void>): Promise<void> {
        const ext = filename.toLowerCase().split('.').pop();
        if (ext === 'csv') {
            return this.parseCSVFromPath(filePath, onRecord);
        } else if (['xlsx', 'xls'].includes(ext as string)) {
            return this.parseExcelFromPath(filePath, onRecord);
        } else {
            throw new Error(`Unsupported file format: ${ext}`);
        }
    }

    /**
     * Parse CSV file with streaming support for large files (buffer-based, kept for compatibility)
     */
    async parseCSVStreaming(fileBuffer: Buffer, onRecord: (record: ParsedRecord) => Promise<void>): Promise<void> {
        return new Promise((resolve, reject) => {
            const csvString = fileBuffer.toString('utf-8');
            let rowCount = 0;

            Papa.parse(csvString, {
                header: true,
                skipEmptyLines: 'greedy',
                chunkSize: 1024 * 1024 * 2, // 2MB chunks
                chunk: async (results, parser) => {
                    // Pause parser to handle async processing
                    parser.pause();
                    for (const row of results.data) {
                        if (!this.isEmptyRow(row)) {
                            await onRecord({
                                row: ++rowCount + 1, // +1 for header
                                data: this.mapColumns(row),
                            });
                        }
                    }
                    parser.resume();
                },
                complete: () => {
                    this.logger.log(`Streamed ${rowCount} records from CSV`);
                    resolve();
                },
                error: (error) => {
                    this.logger.error(`CSV streaming error: ${error.message}`);
                    reject(new Error(`Failed to stream CSV: ${error.message}`));
                },
            });
        });
    }

    /**
     * Legacy parseCSV (returns full array, kept for compatibility if needed)
     */
    async parseCSV(fileBuffer: Buffer): Promise<ParsedRecord[]> {
        const records: ParsedRecord[] = [];
        await this.parseCSVStreaming(fileBuffer, async (rec) => {
            records.push(rec);
        });
        return records;
    }

    /**
     * Parse Excel file with memory optimization
     */
    async parseExcelStreaming(fileBuffer: Buffer, onRecord: (record: ParsedRecord) => Promise<void>): Promise<void> {
        try {
            const workbook = XLSX.read(fileBuffer, { type: 'buffer', cellDates: true });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];

            if (!worksheet) return;

            // Use sheet_to_json row by row to save memory compared to full array conversion
            const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
            const headers: string[] = [];
            for (let C = range.s.c; C <= range.e.c; ++C) {
                const cell = worksheet[XLSX.utils.encode_cell({ r: range.s.r, c: C })];
                headers.push(cell ? cell.v : `UNKNOWN_${C}`);
            }

            let rowCount = 0;
            for (let R = range.s.r + 1; R <= range.e.r; ++R) {
                const rowObj: any = {};
                let hasData = false;
                for (let C = range.s.c; C <= range.e.c; ++C) {
                    const cell = worksheet[XLSX.utils.encode_cell({ r: R, c: C })];
                    if (cell && cell.v !== null) {
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

            this.logger.log(`Processed ${rowCount} records from Excel`);
        } catch (error) {
            this.logger.error(`Excel processing error: ${error.message}`);
            throw new Error(`Failed to process Excel: ${error.message}`);
        }
    }

    async parseExcel(fileBuffer: Buffer): Promise<ParsedRecord[]> {
        const records: ParsedRecord[] = [];
        await this.parseExcelStreaming(fileBuffer, async (rec) => {
            records.push(rec);
        });
        return records;
    }

    /**
     * Auto-detect and parse file based on extension (Streaming version)
     */
    async parseFileStreaming(fileBuffer: Buffer, filename: string, onRecord: (record: ParsedRecord) => Promise<void>): Promise<void> {
        const ext = filename.toLowerCase().split('.').pop();
        if (ext === 'csv') {
            return this.parseCSVStreaming(fileBuffer, onRecord);
        } else if (['xlsx', 'xls'].includes(ext as string)) {
            return this.parseExcelStreaming(fileBuffer, onRecord);
        } else {
            throw new Error(`Unsupported file format: ${ext}`);
        }
    }

    async parseFile(fileBuffer: Buffer, filename: string): Promise<ParsedRecord[]> {
        const records: ParsedRecord[] = [];
        await this.parseFileStreaming(fileBuffer, filename, async (rec) => {
            records.push(rec);
        });
        return records;
    }
}
