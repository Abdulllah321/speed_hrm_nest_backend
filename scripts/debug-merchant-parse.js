"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const XLSX = __importStar(require("xlsx"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
async function main() {
    const filePath = path.join(process.cwd(), 'uploads', 'bulk', 'merchant', 'merchant-upload-43e2f991-3ad9-4e26-8844-a7adcfee511a.xlsx');
    if (!fs.existsSync(filePath)) {
        console.error('File not found:', filePath);
        return;
    }
    console.log('Reading file:', filePath);
    const fileBuffer = fs.readFileSync(filePath);
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) {
        console.error('No worksheet found');
        return;
    }
    console.log('Sheet Name:', sheetName);
    console.log('Worksheet Ref:', worksheet['!ref']);
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
    console.log('Range:', range);
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
        if (nonIdxCount >= 3) {
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
    console.log('Determined Header Row Index:', headerRowIdx);
    const headers = [];
    for (let C = range.s.c; C <= range.e.c; ++C) {
        const cell = worksheet[XLSX.utils.encode_cell({ r: headerRowIdx, c: C })];
        headers.push(cell && cell.v !== null && cell.v !== undefined ? String(cell.v).trim() : `UNKNOWN_${C}`);
    }
    console.log('Headers found:', headers);
    console.log('\nChecking if columns 9-14 have any data in the entire sheet...');
    const colStats = Array(15).fill(0);
    for (let R = headerRowIdx + 1; R <= range.e.r; ++R) {
        for (let C = range.s.c; C <= range.e.c; ++C) {
            const cell = worksheet[XLSX.utils.encode_cell({ r: R, c: C })];
            if (cell && cell.v !== null && cell.v !== undefined && String(cell.v).trim() !== '') {
                colStats[C]++;
            }
        }
    }
    for (let C = range.s.c; C <= range.e.c; ++C) {
        console.log(`Column ${C} (${headers[C]}): ${colStats[C]} non-empty cells`);
    }
}
main();
//# sourceMappingURL=debug-merchant-parse.js.map