import { Injectable, Logger } from '@nestjs/common';
import * as XLSX from 'xlsx';

// ---------------------------------------------------------------------------
// Parsed record — one account per record
// ---------------------------------------------------------------------------
export interface CoaParsedRecord {
    row: number;
    data: {
        code: string;
        name: string;
        type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
        isGroup: boolean;
        parentCode?: string;
        isTagEntry: boolean;
        debit?: number;
        credit?: number;
    };
}

// ---------------------------------------------------------------------------
// Raw row extracted from the wide Excel — one per spreadsheet row.
// Multiple sections can be populated on the same row.
// ---------------------------------------------------------------------------
export interface CoaRawRow {
    excelRow: number; // 1-based row number for error reporting

    // Section 1 — Main (1-digit)
    mainCode?:   string;
    mainName?:   string;
    mainDebit?:  number;
    mainCredit?: number;

    // Section 2 — Control (2-digit)
    ctrlCode?:   string;
    ctrlName?:   string;
    ctrlDebit?:  number;
    ctrlCredit?: number;

    // Section 3 — Sub-control (4-digit)
    subCode?:    string;
    subName?:    string;
    subDebit?:   number;
    subCredit?:  number;

    // Section 4 — Leaf (8-digit) or Tag (sub-ledger)
    leafCode?:   string; // 8-digit structural leaf
    tagId?:      string; // sub-ledger code (DIR001, C00001, 120150, …)
    glDesc?:     string; // GL Description (name for leaf or tag)
    leafDebit?:  number;
    leafCredit?: number;
}

// ---------------------------------------------------------------------------
// Column layout (0-based)
//
//  A=0  B=1  C=2  D=3  E=4  F=5  G=6  H=7  I=8  J=9
//  K=10 L=11 M=12 N=13 O=14 P=15 Q=16 R=17 S=18 T=19 U=20
//
//  B  : Main CODE
//  C  : MAIN name
//  D  : Main DEBIT
//  E  : Main CREDIT
//  G  : Control CODE
//  H  : CONTROL ACCOUNT name
//  I  : Control DEBIT
//  J  : Control CREDIT
//  L  : Sub-control CODE
//  M  : SUB CONTROL ACCOUNT name
//  N  : Sub-control DEBIT
//  O  : Sub-control CREDIT
//  Q  : Leaf CODE (8-digit)
//  R  : TAG ID
//  S  : GL DESCRIPTION
//  T  : Leaf/Tag DEBIT
//  U  : Leaf/Tag CREDIT
// ---------------------------------------------------------------------------
const BASE_COLS = {
    MAIN_CODE:    1,
    MAIN_NAME:    2,
    MAIN_DEBIT:   3,
    MAIN_CREDIT:  4,
    CTRL_CODE:    6,
    CTRL_NAME:    7,
    CTRL_DEBIT:   8,
    CTRL_CREDIT:  9,
    SUB_CODE:    11,
    SUB_NAME:    12,
    SUB_DEBIT:   13,
    SUB_CREDIT:  14,
    LEAF_CODE:   16,
    TAG_ID:      17,
    GL_DESC:     18,
    LEAF_DEBIT:  19,
    LEAF_CREDIT: 20,
} as const;

@Injectable()
export class CoaCsvParserService {
    private readonly logger = new Logger(CoaCsvParserService.name);

    // ── Helpers ──────────────────────────────────────────────────────────────

    private str(value: any): string | undefined {
        if (value === null || value === undefined) return undefined;
        const s = String(value).trim();
        if (['-', '–', '—', '', 'n/a', 'null', 'none'].includes(s.toLowerCase())) return undefined;
        return s || undefined;
    }

    private num(value: any): number | undefined {
        if (value === null || value === undefined) return undefined;
        if (typeof value === 'number') return isNaN(value) ? undefined : value;
        const s = String(value).trim().replace(/[,\s]/g, '');
        if (['-', '–', '—', ''].includes(s)) return undefined;
        const n = parseFloat(s);
        return isNaN(n) ? undefined : n;
    }

    isStructuralCode(code: string): boolean {
        return /^\d+$/.test(code) && [1, 2, 4, 8].includes(code.length);
    }

    accountType(code: string): CoaParsedRecord['data']['type'] {
        switch (code.charAt(0)) {
            case '1': return 'EQUITY';
            case '2': return 'LIABILITY';
            case '3': return 'ASSET';
            case '4': case '5': case '6': case '7': return 'INCOME';
            case '8': case '9': return 'EXPENSE';
            default:  return 'ASSET';
        }
    }

    structuralParent(code: string): string | undefined {
        if (code.length === 2) return code.substring(0, 1);
        if (code.length === 4) return code.substring(0, 2);
        if (code.length === 8) return code.substring(0, 4);
        return undefined;
    }

    // ── Read raw rows from Excel ──────────────────────────────────────────────

    readRawRows(fileBuffer: Buffer): CoaRawRow[] {
        const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        if (!worksheet) return [];

        const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');

        const cellVal = (R: number, C: number): any => {
            const ref = XLSX.utils.encode_cell({ r: R, c: C });
            return worksheet[ref]?.v ?? null;
        };

        // Auto-detect column offset by finding where "MAIN" header appears
        // Some files have an extra leading column (offset = 1)
        let offset = 0;
        for (let tryOffset = 0; tryOffset <= 2; tryOffset++) {
            const v = this.str(cellVal(range.s.r, BASE_COLS.MAIN_NAME + tryOffset));
            if (v && v.toUpperCase().includes('MAIN')) { offset = tryOffset; break; }
        }

        const cv = (R: number, col: number) => cellVal(R, col + offset);

        // Find first data row (skip header rows)
        let dataStart = range.s.r + 1;
        for (let R = range.s.r + 1; R <= Math.min(range.s.r + 5, range.e.r); R++) {
            const v = this.str(cv(R, BASE_COLS.MAIN_CODE));
            if (v && /^\d/.test(v)) { dataStart = R; break; }
        }

        const rows: CoaRawRow[] = [];

        for (let R = dataStart; R <= range.e.r; R++) {
            const row: CoaRawRow = { excelRow: R + 1 };

            row.mainCode   = this.str(cv(R, BASE_COLS.MAIN_CODE));
            row.mainName   = this.str(cv(R, BASE_COLS.MAIN_NAME));
            row.mainDebit  = this.num(cv(R, BASE_COLS.MAIN_DEBIT));
            row.mainCredit = this.num(cv(R, BASE_COLS.MAIN_CREDIT));

            row.ctrlCode   = this.str(cv(R, BASE_COLS.CTRL_CODE));
            row.ctrlName   = this.str(cv(R, BASE_COLS.CTRL_NAME));
            row.ctrlDebit  = this.num(cv(R, BASE_COLS.CTRL_DEBIT));
            row.ctrlCredit = this.num(cv(R, BASE_COLS.CTRL_CREDIT));

            row.subCode    = this.str(cv(R, BASE_COLS.SUB_CODE));
            row.subName    = this.str(cv(R, BASE_COLS.SUB_NAME));
            row.subDebit   = this.num(cv(R, BASE_COLS.SUB_DEBIT));
            row.subCredit  = this.num(cv(R, BASE_COLS.SUB_CREDIT));

            row.leafCode   = this.str(cv(R, BASE_COLS.LEAF_CODE));
            row.tagId      = this.str(cv(R, BASE_COLS.TAG_ID));
            row.glDesc     = this.str(cv(R, BASE_COLS.GL_DESC));
            row.leafDebit  = this.num(cv(R, BASE_COLS.LEAF_DEBIT));
            row.leafCredit = this.num(cv(R, BASE_COLS.LEAF_CREDIT));

            // Skip completely empty rows
            const hasAny = row.mainCode || row.ctrlCode || row.subCode ||
                           row.leafCode || row.tagId || row.glDesc;
            if (hasAny) rows.push(row);
        }

        this.logger.log(`Read ${rows.length} raw rows from Excel`);
        return rows;
    }

    // ── Convert raw rows → flat CoaParsedRecord list in 5-pass order ─────────
    //
    //  Pass 1: Main accounts      (1-digit codes)
    //  Pass 2: Control accounts   (2-digit codes)
    //  Pass 3: Sub-control accts  (4-digit codes)
    //  Pass 4: Leaf accounts      (8-digit codes)
    //  Pass 5: Sub-ledger tags    (TAG ID entries)
    //
    // This guarantees every parent exists before its children are processed.

    rawRowsToRecords(rawRows: CoaRawRow[]): CoaParsedRecord[] {
        const records: CoaParsedRecord[] = [];

        // ── Pass 1: Main accounts ─────────────────────────────────────────────
        const seenMain = new Set<string>();
        for (const r of rawRows) {
            if (!r.mainCode || !r.mainName) continue;
            if (!/^\d{1}$/.test(r.mainCode)) continue;
            if (seenMain.has(r.mainCode)) continue;
            seenMain.add(r.mainCode);
            records.push({
                row: r.excelRow,
                data: {
                    code: r.mainCode,
                    name: r.mainName,
                    type: this.accountType(r.mainCode),
                    isGroup: true,
                    parentCode: undefined,
                    isTagEntry: false,
                    // Group totals — ignored at import, no opening balance posted
                },
            });
        }

        // ── Pass 2: Control accounts ──────────────────────────────────────────
        const seenCtrl = new Set<string>();
        for (const r of rawRows) {
            if (!r.ctrlCode || !r.ctrlName) continue;
            if (!/^\d{2}$/.test(r.ctrlCode)) continue;
            if (seenCtrl.has(r.ctrlCode)) continue;
            seenCtrl.add(r.ctrlCode);
            records.push({
                row: r.excelRow,
                data: {
                    code: r.ctrlCode,
                    name: r.ctrlName,
                    type: this.accountType(r.ctrlCode),
                    isGroup: true,
                    parentCode: this.structuralParent(r.ctrlCode),
                    isTagEntry: false,
                },
            });
        }

        // ── Pass 3: Sub-control accounts ──────────────────────────────────────
        const seenSub = new Set<string>();
        for (const r of rawRows) {
            if (!r.subCode || !r.subName) continue;
            if (!/^\d{4}$/.test(r.subCode)) continue;
            if (seenSub.has(r.subCode)) continue;
            seenSub.add(r.subCode);
            records.push({
                row: r.excelRow,
                data: {
                    code: r.subCode,
                    name: r.subName,
                    type: this.accountType(r.subCode),
                    isGroup: true,
                    parentCode: this.structuralParent(r.subCode),
                    isTagEntry: false,
                },
            });
        }

        // ── Pass 4: Leaf accounts (8-digit) ───────────────────────────────────
        const seenLeaf = new Set<string>();
        for (const r of rawRows) {
            if (!r.leafCode || !r.glDesc) continue;
            if (!/^\d{8}$/.test(r.leafCode)) continue;
            if (seenLeaf.has(r.leafCode)) continue;
            seenLeaf.add(r.leafCode);
            records.push({
                row: r.excelRow,
                data: {
                    code: r.leafCode,
                    name: r.glDesc,
                    type: this.accountType(r.leafCode),
                    isGroup: false,
                    parentCode: this.structuralParent(r.leafCode),
                    isTagEntry: false,
                    debit:  r.leafDebit,
                    credit: r.leafCredit,
                },
            });
        }

        // ── Pass 5: Sub-ledger / tag entries ──────────────────────────────────
        // These can repeat (same tag under multiple leaf parents) — no dedup.
        // We need to know which leaf each tag belongs to.
        // Walk rows in order, tracking the last seen leaf code.
        let lastLeafCode: string | undefined;
        let lastLeafType: CoaParsedRecord['data']['type'] = 'ASSET';

        for (const r of rawRows) {
            // Update last leaf tracker whenever we see a leaf code on this row
            if (r.leafCode && /^\d{8}$/.test(r.leafCode)) {
                lastLeafCode = r.leafCode;
                lastLeafType = this.accountType(r.leafCode);
            }

            if (!r.tagId || !r.glDesc) continue;

            records.push({
                row: r.excelRow,
                data: {
                    code:       r.tagId,
                    name:       r.glDesc,
                    type:       lastLeafType,
                    isGroup:    false,
                    parentCode: lastLeafCode,
                    isTagEntry: true,
                    debit:      r.leafDebit,
                    credit:     r.leafCredit,
                },
            });
        }

        this.logger.log(
            `Converted to ${records.length} records: ` +
            `${seenMain.size} main, ${seenCtrl.size} control, ` +
            `${seenSub.size} sub-control, ${seenLeaf.size} leaf, ` +
            `${records.length - seenMain.size - seenCtrl.size - seenSub.size - seenLeaf.size} tags`
        );

        return records;
    }

    // ── Public streaming API (used by processor) ──────────────────────────────

    async parseFileStreaming(
        fileBuffer: Buffer,
        filename: string,
        onRecord: (record: CoaParsedRecord) => Promise<void>,
    ): Promise<void> {
        const rawRows = this.readRawRows(fileBuffer);
        const records = this.rawRowsToRecords(rawRows);
        for (const rec of records) {
            await onRecord(rec);
        }
    }

    async parseFile(fileBuffer: Buffer, filename: string): Promise<CoaParsedRecord[]> {
        const records: CoaParsedRecord[] = [];
        await this.parseFileStreaming(fileBuffer, filename, async (rec) => { records.push(rec); });
        return records;
    }
}
