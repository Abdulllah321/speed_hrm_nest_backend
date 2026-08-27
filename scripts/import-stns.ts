import 'dotenv/config';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

function decrypt(encryptedText: string, masterKeyString: string): string {
  if (!masterKeyString || masterKeyString.length < 32) {
    throw new Error('MASTER_ENCRYPTION_KEY must be at least 32 characters');
  }
  const masterKey = Buffer.from(masterKeyString.slice(0, 32), 'utf-8');
  const algorithm = 'aes-256-gcm';

  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted text format');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];

  const decipher = crypto.createDecipheriv(algorithm, masterKey, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

export interface ParsedStnRow {
  rowNum: number;
  stockOutLocationName: string;
  codeTrOut: string;
  documentNumber: string;
  documentDateStr: string;
  documentDate: Date;
  documentType: string;
  stockInLocationName: string;
  codeTrIn: string;
  barCode: string;
  quantity: number;
  receivingDocNo: string;
  receivingDocDateStr: string;
  receivingDocDate: Date | null;
  remarks: string;
  documentStatus: string;
  isReceived: boolean;
}

export interface EntityRef {
  type: 'WAREHOUSE' | 'LOCATION';
  id: string;
  code: string;
  name: string;
}

const KNOWN_WAREHOUSE_CODES = new Set(['C40001', 'C-TSDMC', 'C30001', 'C20001', 'C10001']);

const isWarehouseCode = (code: string) => {
  const c = code.trim().toUpperCase();
  if (KNOWN_WAREHOUSE_CODES.has(c)) return true;
  return c.startsWith('C') || c.startsWith('WH') || c.includes('WAREHOUSE') || c.includes('LOGISTIC');
};

/**
 * Calculates Fiscal Year string (July 1 to June 30)
 * e.g., July 2026 -> "26-27"
 */
export function getFiscalYear(date: Date): string {
  const year = date.getFullYear();
  const month = date.getMonth(); // 0-indexed (6 = July)
  if (month >= 6) {
    const startYY = String(year).slice(-2);
    const endYY = String(year + 1).slice(-2);
    return `${startYY}-${endYY}`;
  } else {
    const startYY = String(year - 1).slice(-2);
    const endYY = String(year).slice(-2);
    return `${startYY}-${endYY}`;
  }
}

export function parseCustomDate(dateStr: string): Date | null {
  if (!dateStr || !dateStr.trim()) return null;

  const trimmed = dateStr.trim();
  const spaceParts = trimmed.split(/\s+/);
  const datePart = spaceParts[0];
  const timePart = spaceParts[1] || '0:0';

  const dParts = datePart.split('/');
  if (dParts.length !== 3) return null;

  const month = parseInt(dParts[0], 10);
  const day = parseInt(dParts[1], 10);
  let year = parseInt(dParts[2], 10);

  if (year < 100) {
    year += 2000;
  }

  const tParts = timePart.split(':');
  const hours = parseInt(tParts[0] || '0', 10);
  const minutes = parseInt(tParts[1] || '0', 10);
  const seconds = parseInt(tParts[2] || '0', 10);

  return new Date(year, month - 1, day, hours, minutes, seconds);
}

export function readAndParseGeneralizedStns(filePath: string, maxRows?: number): ParsedStnRow[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found at path: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== '' && !l.trim().startsWith('---'));

  if (lines.length < 2) {
    console.warn(`⚠️ File ${filePath} contains no data rows.`);
    return [];
  }

  const headerLine = lines[0];
  const isTabSep = headerLine.includes('\t');
  const isPipeSep = headerLine.includes('|');

  const headers = isTabSep
    ? headerLine.split('\t').map((h) => h.trim().toLowerCase())
    : isPipeSep
    ? headerLine.split('|').map((h) => h.trim().toLowerCase()).filter(Boolean)
    : headerLine.split(',').map((h) => h.trim().toLowerCase());

  const findColIndex = (keywords: string[], defaultIdx: number): number => {
    const idx = headers.findIndex((h) => keywords.some((k) => h.includes(k)));
    return idx !== -1 ? idx : defaultIdx;
  };

  const colOutName = findColIndex(['stock tr out location', 'out location', 'from location'], 0);
  const colOutCode = findColIndex(['stock tr out location code', 'code tr out', 'from code'], 1);
  const colDocNo = findColIndex(['documentnumber', 'docno', 'doc no'], 2);
  const colDocDate = findColIndex(['documentdate', 'docdate', 'date'], 3);
  const colDocType = findColIndex(['documenttype', 'type'], 4);
  const colInName = findColIndex(['stock deliver to location', 'in location', 'to location'], 5);
  const colInCode = findColIndex(['stock deliver to location code', 'code tr in', 'to code'], 6);
  const colBarcode = findColIndex(['barcode', 'sku', 'item'], 7);
  const colQty = findColIndex(['quantity', 'qty'], 8);
  const colRecNo = findColIndex(['receivingdocumentno', 'receiving doc no', 'recdocno'], 9);
  const colRecDate = findColIndex(['receivingdocumentdate', 'receiving date', 'recdate'], 10);
  const colRemarks = findColIndex(['remarks', 'notes'], 11);
  const colStatus = findColIndex(['documentstatus', 'status'], 12);

  const rawParsed: ParsedStnRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine || rawLine.startsWith('---')) continue;

    let parts = isTabSep
      ? rawLine.split('\t').map((p) => p.trim())
      : isPipeSep
      ? rawLine.split('|').map((p) => p.trim()).filter(Boolean)
      : rawLine.split(',').map((p) => p.trim());

    if (parts.length < 5) continue;

    const stockOutLocationName = parts[colOutName] || '';
    const codeTrOut = parts[colOutCode] || '';
    const documentNumber = parts[colDocNo] || '';
    const documentDateStr = parts[colDocDate] || '';
    const documentType = parts[colDocType] || 'Transfer Out';
    const stockInLocationName = parts[colInName] || '';
    const codeTrIn = parts[colInCode] || '';
    const barCode = (parts[colBarcode] || '').replace(/"/g, '').trim();
    const rawQty = parts[colQty] || '1';
    const quantity = parseFloat(rawQty) || 1;
    const receivingDocNo = parts[colRecNo] || '';
    const receivingDocDateStr = parts[colRecDate] || '';
    const remarks = parts[colRemarks] || '';
    const documentStatus = parts[colStatus] || 'Approved / Closed';

    if (!codeTrOut || !codeTrIn || !barCode) continue;

    const documentDate = parseCustomDate(documentDateStr);
    if (!documentDate || isNaN(documentDate.getTime())) continue;

    const receivingDocDate = parseCustomDate(receivingDocDateStr);
    const isReceived = Boolean(receivingDocDate && !isNaN(receivingDocDate.getTime()));

    rawParsed.push({
      rowNum: 0,
      stockOutLocationName,
      codeTrOut,
      documentNumber,
      documentDateStr,
      documentDate,
      documentType,
      stockInLocationName,
      codeTrIn,
      barCode,
      quantity,
      receivingDocNo,
      receivingDocDateStr,
      receivingDocDate: isReceived ? receivingDocDate : null,
      remarks,
      documentStatus,
      isReceived,
    });
  }

  // Sort ALL parsed rows chronologically by documentDate ascending (oldest first)
  rawParsed.sort((a, b) => a.documentDate.getTime() - b.documentDate.getTime());

  rawParsed.forEach((row, index) => {
    row.rowNum = index + 1;
  });

  return maxRows ? rawParsed.slice(0, maxRows) : rawParsed;
}

async function processTransfersForTenant(
  prisma: PrismaClient,
  rows: ParsedStnRow[],
  isDryRun: boolean = false
) {
  console.log(`\n==================================================`);
  console.log(`📦 ${isDryRun ? '[DRY RUN MODE]' : '[LIVE COMMIT MODE]'} Processing ${rows.length} STN transfer rows...`);
  console.log(`==================================================\n`);

  // Step 1: Cleanup previous imported STNs in live mode
  if (!isDryRun) {
    console.log(`🧹 Cleaning up previously imported STN records...`);
    const existingStns = await prisma.transferRequest.findMany({
      where: {
        OR: [
          { requestNo: { startsWith: 'STN-' } },
          { notes: { contains: 'TR-OUT-' } },
          { notes: { contains: 'TR-IN-' } },
          { notes: { contains: 'DocNo:' } },
        ],
      },
      select: { id: true },
    });

    if (existingStns.length > 0) {
      const stnIds = existingStns.map((s) => s.id);
      console.log(`  Found ${stnIds.length} existing STN headers to clean up.`);

      await prisma.transferRequestItem.deleteMany({
        where: { transferRequestId: { in: stnIds } },
      });

      await prisma.stockMovement.deleteMany({
        where: {
          OR: [
            { referenceId: { in: stnIds } },
            { notes: { contains: 'STN Transfer' } },
          ],
        },
      });

      await prisma.stockLedger.deleteMany({
        where: { referenceId: { in: stnIds } },
      });

      await prisma.transferRequest.deleteMany({
        where: { id: { in: stnIds } },
      });

      console.log(`  ✅ Successfully wiped ${stnIds.length} old STN records.`);
    }
  }

  let defaultWarehouse: any = null;
  if (!isDryRun) {
    defaultWarehouse = await prisma.warehouse.findFirst({
      where: { isDeleted: false },
    });

    if (!defaultWarehouse) {
      console.log(`🏭 Creating default Warehouse (C40001)...`);
      defaultWarehouse = await prisma.warehouse.create({
        data: {
          code: 'C40001',
          name: 'LOGISTIC AREA CENTRAL WAREHOUSE',
          type: 'GENERAL',
          isActive: true,
        },
      });
    }
  } else {
    defaultWarehouse = { id: 'dry-run-wh-id', code: 'C40001', name: 'LOGISTIC AREA CENTRAL WAREHOUSE' };
  }

  const entityCache = new Map<string, EntityRef>();
  const itemCache = new Map<string, any>();

  async function resolveEntity(code: string, name: string): Promise<EntityRef> {
    if (entityCache.has(code)) {
      return entityCache.get(code)!;
    }

    if (isWarehouseCode(code)) {
      if (!isDryRun) {
        let wh = await prisma.warehouse.findFirst({
          where: { code, isDeleted: false },
        });
        if (!wh) {
          console.log(`🏭 Creating Warehouse [${code}]: ${name}`);
          wh = await prisma.warehouse.create({
            data: {
              code,
              name: name || 'LOGISTIC AREA WAREHOUSE',
              type: 'GENERAL',
              isActive: true,
            },
          });
        }
        const ref: EntityRef = { type: 'WAREHOUSE', id: wh.id, code: wh.code, name: wh.name };
        entityCache.set(code, ref);
        return ref;
      } else {
        const ref: EntityRef = { type: 'WAREHOUSE', id: `wh-${code}`, code, name: name || 'Warehouse' };
        entityCache.set(code, ref);
        return ref;
      }
    } else {
      if (!isDryRun) {
        let loc = await prisma.location.findFirst({
          where: { code, isDeleted: false },
        });
        if (!loc) {
          console.log(`📍 Creating Location [${code}]: ${name}`);
          loc = await prisma.location.create({
            data: {
              code,
              name,
              warehouseId: defaultWarehouse.id,
              status: 'active',
            },
          });
        }
        const ref: EntityRef = { type: 'LOCATION', id: loc.id, code: loc.code, name: loc.name };
        entityCache.set(code, ref);
        return ref;
      } else {
        const ref: EntityRef = { type: 'LOCATION', id: `loc-${code}`, code, name };
        entityCache.set(code, ref);
        return ref;
      }
    }
  }

  console.log(`⚙️ Pre-caching Warehouses, Locations, and Item Barcodes...`);

  for (const row of rows) {
    await resolveEntity(row.codeTrOut, row.stockOutLocationName);
    await resolveEntity(row.codeTrIn, row.stockInLocationName);

    if (!itemCache.has(row.barCode)) {
      if (!isDryRun) {
        let item = await prisma.item.findFirst({
          where: { barCode: row.barCode },
        });
        if (!item) {
          item = await prisma.item.create({
            data: {
              itemId: `ITEM-${row.barCode}`,
              sku: row.barCode,
              barCode: row.barCode,
              description: `STN Item (${row.barCode})`,
              unitPrice: 0,
              unitCost: 0,
              status: 'active',
              isActive: true,
            },
          });
        }
        itemCache.set(row.barCode, item);
      } else {
        itemCache.set(row.barCode, { id: `item-${row.barCode}`, barCode: row.barCode });
      }
    }
  }

  // Group STN rows into single Transfer Requests
  const transferGroups = new Map<string, ParsedStnRow[]>();
  for (const row of rows) {
    const groupKey = `${row.codeTrOut}_${row.codeTrIn}_${row.documentNumber}_${row.documentDateStr}`;
    if (!transferGroups.has(groupKey)) {
      transferGroups.set(groupKey, []);
    }
    transferGroups.get(groupKey)!.push(row);
  }

  console.log(`📋 Grouped ${rows.length} total rows into ${transferGroups.size} STN Transfer Request documents.`);

  // Sequential counters per Fiscal Year (Global STN-FY-XXXXX)
  const fyCounters = new Map<string, number>();

  // Sequential counters per Outlet Location (TR-OUT-0001 per OUT outlet, TR-IN-0001 per IN outlet)
  const trOutCounters = new Map<string, number>();
  const trInCounters = new Map<string, number>();

  let processedLines = 0;
  let completedCount = 0;
  let inTransitCount = 0;

  for (const [groupKey, groupRows] of transferGroups.entries()) {
    const sample = groupRows[0];
    const fromEntity = entityCache.get(sample.codeTrOut)!;
    const toEntity = entityCache.get(sample.codeTrIn)!;

    // 1. Global STN Request Number per Fiscal Year (e.g. STN-26-27-00001)
    const fy = getFiscalYear(sample.documentDate);
    const fySeq = (fyCounters.get(fy) || 0) + 1;
    fyCounters.set(fy, fySeq);
    const requestNo = `STN-${fy}-${String(fySeq).padStart(5, '0')}`;

    // 2. Sequential TR-OUT per OUT outlet (TR-OUT-0001, TR-OUT-0002...)
    const outSeq = (trOutCounters.get(sample.codeTrOut) || 0) + 1;
    trOutCounters.set(sample.codeTrOut, outSeq);
    const outNo = `TR-OUT-${String(outSeq).padStart(4, '0')}`;

    // 3. Sequential TR-IN per IN outlet (TR-IN-0001, TR-IN-0002...)
    let inNo = 'TR-IN-PENDING';
    if (sample.isReceived && sample.receivingDocDate) {
      const inSeq = (trInCounters.get(sample.codeTrIn) || 0) + 1;
      trInCounters.set(sample.codeTrIn, inSeq);
      inNo = `TR-IN-${String(inSeq).padStart(4, '0')}`;
    }

    const isReceived = sample.isReceived;
    if (isReceived) completedCount++;
    else inTransitCount++;

    const fromWarehouseId = fromEntity.type === 'WAREHOUSE' ? fromEntity.id : defaultWarehouse.id;
    const fromLocationId = fromEntity.type === 'LOCATION' ? fromEntity.id : null;

    const toWarehouseId = toEntity.type === 'WAREHOUSE' ? toEntity.id : defaultWarehouse.id;
    const toLocationId = toEntity.type === 'LOCATION' ? toEntity.id : null;

    let transferType = 'OUTLET_TO_OUTLET';
    if (fromEntity.type === 'WAREHOUSE' && toEntity.type === 'LOCATION') {
      transferType = 'WAREHOUSE_TO_OUTLET';
    } else if (fromEntity.type === 'LOCATION' && toEntity.type === 'WAREHOUSE') {
      transferType = 'OUTLET_TO_WAREHOUSE';
    } else if (fromEntity.type === 'WAREHOUSE' && toEntity.type === 'WAREHOUSE') {
      transferType = 'WAREHOUSE_TO_WAREHOUSE';
    }

    if (isDryRun) {
      if (fySeq <= 12 || fySeq % 20 === 0 || !isReceived) {
        console.log(`🔍 [DRY-RUN #${requestNo}] FY:${fy} | Date:${sample.documentDateStr} | ${fromEntity.name} [${outNo}] -> ${toEntity.name} [${inNo}] | Status: ${isReceived ? 'COMPLETED' : 'IN_TRANSIT'} | Items: ${groupRows.length}`);
      }
      processedLines += groupRows.length;
      continue;
    }

    // Live execution
    const transferNotes = `TR OUT No: ${outNo} | TR IN No: ${inNo} | OrigDocNo: ${sample.documentNumber} | RecDocNo: ${sample.receivingDocNo || 'N/A'} | RecDate: ${sample.receivingDocDateStr || 'N/A'} | Remarks: ${sample.remarks}`;

    const transferRequest = await prisma.transferRequest.create({
      data: {
        requestNo,
        fromLocationId,
        toLocationId,
        fromWarehouseId,
        toWarehouseId,
        transferType,
        requestDate: sample.documentDate,
        createdAt: sample.documentDate,
        sourceApprovedAt: sample.documentDate,
        status: isReceived ? 'COMPLETED' : 'DISPATCHED',
        notes: transferNotes,
      },
    });

    for (const row of groupRows) {
      const item = itemCache.get(row.barCode);
      const qty = row.quantity;

      // 1. Create TransferRequestItem
      await prisma.transferRequestItem.create({
        data: {
          transferRequestId: transferRequest.id,
          itemId: item.id,
          quantity: qty,
          fulfilledQty: isReceived ? qty : 0,
        },
      });

      // 2. OUTBOUND Stock Movement & Ledger at Source
      if (fromEntity.type === 'WAREHOUSE') {
        const sourceInv = await prisma.inventoryItem.findFirst({
          where: { warehouseId: fromEntity.id, locationId: null, itemId: item.id },
        });

        if (sourceInv) {
          await prisma.inventoryItem.update({
            where: { id: sourceInv.id },
            data: { quantity: { decrement: qty } },
          });
        } else {
          await prisma.inventoryItem.create({
            data: { warehouseId: fromEntity.id, locationId: null, itemId: item.id, quantity: -qty, status: 'AVAILABLE' },
          });
        }
      } else {
        const sourceInv = await prisma.inventoryItem.findFirst({
          where: { locationId: fromLocationId, itemId: item.id },
        });

        if (sourceInv) {
          await prisma.inventoryItem.update({
            where: { id: sourceInv.id },
            data: { quantity: { decrement: qty } },
          });
        } else {
          await prisma.inventoryItem.create({
            data: { warehouseId: defaultWarehouse.id, locationId: fromLocationId, itemId: item.id, quantity: -qty, status: 'AVAILABLE' },
          });
        }
      }

      const outMovNo = `MV-OUT-${outNo}-${row.barCode}`;
      await prisma.stockMovement.create({
        data: {
          movementNo: outMovNo,
          itemId: item.id,
          fromLocationId,
          toLocationId: null,
          quantity: qty,
          type: 'TRANSFER',
          referenceType: 'TRANSFER_REQUEST',
          referenceId: transferRequest.id,
          movementDate: sample.documentDate,
          createdAt: sample.documentDate,
          notes: `STN Transfer Out: ${requestNo} (${outNo})`,
        },
      });

      await prisma.stockLedger.create({
        data: {
          itemId: item.id,
          warehouseId: fromWarehouseId,
          locationId: fromLocationId,
          qty: -qty,
          referenceType: 'TRANSFER_OUT',
          referenceId: transferRequest.id,
          movementType: 'TRANSFER',
          createdAt: sample.documentDate,
        },
      });

      // 3. INBOUND Stock Movement & Ledger at Destination (ONLY IF RECEIVED/APPROVED)
      if (isReceived && sample.receivingDocDate) {
        if (toEntity.type === 'WAREHOUSE') {
          const destInv = await prisma.inventoryItem.findFirst({
            where: { warehouseId: toEntity.id, locationId: null, itemId: item.id },
          });

          if (destInv) {
            await prisma.inventoryItem.update({
              where: { id: destInv.id },
              data: { quantity: { increment: qty } },
            });
          } else {
            await prisma.inventoryItem.create({
              data: { warehouseId: toEntity.id, locationId: null, itemId: item.id, quantity: qty, status: 'AVAILABLE' },
            });
          }
        } else {
          const destInv = await prisma.inventoryItem.findFirst({
            where: { locationId: toLocationId, itemId: item.id },
          });

          if (destInv) {
            await prisma.inventoryItem.update({
              where: { id: destInv.id },
              data: { quantity: { increment: qty } },
            });
          } else {
            await prisma.inventoryItem.create({
              data: { warehouseId: defaultWarehouse.id, locationId: toLocationId, itemId: item.id, quantity: qty, status: 'AVAILABLE' },
            });
          }
        }

        const inMovNo = `MV-IN-${inNo}-${row.barCode}`;
        await prisma.stockMovement.create({
          data: {
            movementNo: inMovNo,
            itemId: item.id,
            fromLocationId: null,
            toLocationId,
            quantity: qty,
            type: 'TRANSFER',
            referenceType: 'TRANSFER_REQUEST',
            referenceId: transferRequest.id,
            movementDate: sample.receivingDocDate,
            createdAt: sample.receivingDocDate,
            notes: `STN Transfer In: ${requestNo} (${inNo})`,
          },
        });

        await prisma.stockLedger.create({
          data: {
            itemId: item.id,
            warehouseId: toWarehouseId,
            locationId: toLocationId,
            qty: qty,
            referenceType: 'TRANSFER_IN',
            referenceId: transferRequest.id,
            movementType: 'TRANSFER',
            createdAt: sample.receivingDocDate,
          },
        });
      }

      processedLines++;
    }
  }

  console.log(`\n==================================================`);
  console.log(`✨ ${isDryRun ? '[DRY RUN SUMMARY]' : '[IMPORT SUMMARY]'}`);
  console.log(`   - Total STNs Processed: ${transferGroups.size}`);
  console.log(`   - Completed STNs      : ${completedCount}`);
  console.log(`   - In-Transit STNs     : ${inTransitCount}`);
  console.log(`   - Total Item Lines    : ${processedLines}`);
  console.log(`   - Global STN Format   : STN-FY-XXXXX (e.g. STN-26-27-00001)`);
  console.log(`   - TR-OUT Format       : TR-OUT-XXXX (per outing outlet e.g. TR-OUT-0001)`);
  console.log(`   - TR-IN Format        : TR-IN-XXXX (per receiving outlet e.g. TR-IN-0001)`);
  console.log(`==================================================\n`);
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run') || process.argv.includes('-d');

  let limit: number | undefined = undefined;
  const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
  if (limitArg) {
    limit = parseInt(limitArg.split('=')[1], 10);
  }

  let filePath = path.join(__dirname, '..', 'data', 'A-madison-STN.md');
  const fileArg = process.argv.find((arg) => arg.startsWith('--file=') || arg.startsWith('--path='));
  if (fileArg) {
    const customPath = fileArg.split('=')[1];
    filePath = path.isAbsolute(customPath) ? customPath : path.join(process.cwd(), customPath);
  }

  console.log(`🚀 Starting Generalized STN Import Script...`);
  console.log(`📄 Target Data File: ${filePath}`);
  if (isDryRun) {
    console.log(`⚠️ DRY RUN ACTIVATED: No database changes will be committed.`);
  }

  const rows = readAndParseGeneralizedStns(filePath, limit);

  console.log(`📄 Successfully parsed and sorted ${rows.length} rows chronologically.`);
  if (rows.length > 0) {
    console.log('\n🔍 First Chronological Transfer Row (#1):');
    console.log(`   - Out Location : ${rows[0].stockOutLocationName} (${rows[0].codeTrOut})`);
    console.log(`   - In Location  : ${rows[0].stockInLocationName} (${rows[0].codeTrIn})`);
    console.log(`   - Doc Date     : ${rows[0].documentDateStr}`);
    console.log(`   - Rec Date     : ${rows[0].receivingDocDateStr || '[IN TRANSIT]'}`);
    console.log(`   - Barcode      : ${rows[0].barCode}`);
    console.log(`   - Qty          : ${rows[0].quantity}`);
  }

  const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;

  if (managementUrl && masterKey) {
    const pool = new Pool({ connectionString: managementUrl });
    const adapter = new PrismaPg(pool);
    const management = new ManagementClient({ adapter } as any);

    try {
      const companies = await management.company.findMany({
        where: { status: 'active' },
      });

      if (companies.length > 0) {
        console.log(`\n🏢 Found ${companies.length} tenant companies. Running transfer import for each...`);
        for (const company of companies) {
          console.log(`\n👉 Processing Tenant: ${company.name} (${company.code})`);
          let connectionString = company.dbUrl;
          if (company.dbPassword) {
            try {
              const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
              connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
            } catch (e) {
              console.warn(`  ⚠️ Decryption failed, using default connectionUrl`);
            }
          }

          if (!connectionString) continue;

          const tenantPool = new Pool({ connectionString });
          const tenantAdapter = new PrismaPg(tenantPool);
          const tenantPrisma = new PrismaClient({ adapter: tenantAdapter });

          try {
            await tenantPrisma.$connect();
            await processTransfersForTenant(tenantPrisma, rows, isDryRun);
          } finally {
            await tenantPrisma.$disconnect();
            await tenantPool.end();
          }
        }
        await management.$disconnect();
        await pool.end();
        return;
      }
    } catch (err: any) {
      console.warn(`ℹ️ Multi-tenant check failed (${err.message}). Falling back to single database...`);
    }
  }

  console.log('\n🔗 Running on primary DATABASE_URL...');
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('❌ DATABASE_URL environment variable is missing.');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: dbUrl });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter: adapter as any });
  try {
    await prisma.$connect();
    await processTransfersForTenant(prisma, rows, isDryRun);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌ Error executing script:', err);
  process.exit(1);
});
