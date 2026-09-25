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
  return c.startsWith('WH') || c.includes('WAREHOUSE') || c.includes('LOGISTIC');
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

export function excelSerialToDate(serial: number): Date {
  const utcDays = Math.floor(serial - 25569);
  const utcValue = utcDays * 86400;
  const dateInfo = new Date(utcValue * 1000);
  const fractionalDay = serial - Math.floor(serial) + 0.0000001;
  let totalSeconds = Math.floor(86400 * fractionalDay);
  const seconds = totalSeconds % 60;
  totalSeconds = Math.floor(totalSeconds / 60);
  const minutes = totalSeconds % 60;
  const hours = Math.floor(totalSeconds / 60);
  return new Date(
    dateInfo.getFullYear(),
    dateInfo.getMonth(),
    dateInfo.getDate(),
    hours,
    minutes,
    seconds,
  );
}

export function parseCustomDate(val: any): Date | null {
  if (val === null || val === undefined || val === '') return null;

  if (typeof val === 'number') {
    if (val > 30000 && val < 70000) {
      return excelSerialToDate(val);
    }
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }

  const str = String(val).trim();
  if (!str) return null;

  const num = parseFloat(str);
  if (!isNaN(num) && num > 30000 && num < 70000 && /^\d+(\.\d+)?$/.test(str)) {
    return excelSerialToDate(num);
  }

  const spaceParts = str.split(/\s+/);
  const datePart = spaceParts[0];
  const timePart = spaceParts[1] || '0:0';

  const dParts = datePart.split('/');
  if (dParts.length === 3) {
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

    const d = new Date(year, month - 1, day, hours, minutes, seconds);
    return isNaN(d.getTime()) ? null : d;
  }

  const fallback = new Date(str);
  return isNaN(fallback.getTime()) ? null : fallback;
}

export function readAndParseGeneralizedStns(filePath: string, maxRows?: number): ParsedStnRow[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found at path: ${filePath}`);
  }

  const rawParsed: ParsedStnRow[] = [];

  if (filePath.toLowerCase().endsWith('.json')) {
    console.log(`📑 Reading JSON format STN data from ${filePath}...`);
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const parsedJson = JSON.parse(fileContent);

    let rows: any[] = [];
    if (Array.isArray(parsedJson)) {
      rows = parsedJson;
    } else if (typeof parsedJson === 'object' && parsedJson !== null) {
      for (const key of Object.keys(parsedJson)) {
        const val = parsedJson[key];
        if (Array.isArray(val) && val.length > 0) {
          rows = val;
          break;
        } else if (typeof val === 'object' && val !== null) {
          for (const innerKey of Object.keys(val)) {
            if (Array.isArray(val[innerKey]) && val[innerKey].length > 0) {
              rows = val[innerKey];
              break;
            }
          }
          if (rows.length > 0) break;
        }
      }
    }

    console.log(`  Found ${rows.length} records in JSON dataset.`);

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const stockOutLocationName = r['From'] || r['Stock TR Out Location'] || r['Stock Out Location'] || '';
      const codeTrOut = String(r['From Location Code'] || r['Stock TR Out Location Code'] || r['Code TR Out'] || '').trim();
      const documentNumber = String(r['DocumentNumber'] !== undefined && r['DocumentNumber'] !== null ? r['DocumentNumber'] : r['DocNo'] || '').trim();
      const rawDocDate = r['DocumentDate'] !== undefined && r['DocumentDate'] !== null ? r['DocumentDate'] : r['DocDate'];
      const documentType = r['TextLine'] || r['DocumentType'] || 'Transfer Out';
      const stockInLocationName = r['To'] || r['Stock Deliver To Location'] || r['Stock In Location'] || '';
      const codeTrIn = String(r['To Location Code'] || r['Stock Deliver to Location Code'] || r['Code TR In'] || '').trim();
      const barCode = String(r['BarCode'] || r['Barcode'] || '').replace(/"/g, '').trim();
      const rawQty = r['Quantity'] !== undefined ? r['Quantity'] : r['Qty'] !== undefined ? r['Qty'] : 1;
      const quantity = parseFloat(rawQty) || 1;
      const receivingDocNo = r['ReceivingDocumentNo'] !== undefined && r['ReceivingDocumentNo'] !== null ? String(r['ReceivingDocumentNo']).trim() : '';
      const rawRecDate = r['ReceivingDocumentDate'] !== undefined && r['ReceivingDocumentDate'] !== null ? r['ReceivingDocumentDate'] : '';
      const remarks = String(r['Remarks'] || '').trim();
      const documentStatus = String(r['DocumentStatus'] || 'Approved / Closed').trim();

      if (!codeTrOut || !codeTrIn || !barCode) continue;

      const documentDate = parseCustomDate(rawDocDate);
      if (!documentDate || isNaN(documentDate.getTime())) continue;

      const receivingDocDate = parseCustomDate(rawRecDate);
      const isReceived = Boolean(receivingDocDate && !isNaN(receivingDocDate.getTime()));

      rawParsed.push({
        rowNum: 0,
        stockOutLocationName,
        codeTrOut,
        documentNumber,
        documentDateStr: String(rawDocDate || ''),
        documentDate,
        documentType,
        stockInLocationName,
        codeTrIn,
        barCode,
        quantity,
        receivingDocNo,
        receivingDocDateStr: String(rawRecDate || ''),
        receivingDocDate: isReceived ? receivingDocDate : null,
        remarks,
        documentStatus,
        isReceived,
      });
    }
  } else {
    // Delimited text/csv/markdown parsing
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
  }

  // Sort ALL parsed rows chronologically by documentDate ascending (oldest first)
  rawParsed.sort((a, b) => a.documentDate.getTime() - b.documentDate.getTime());

  rawParsed.forEach((row, index) => {
    row.rowNum = index + 1;
  });

  return maxRows ? rawParsed.slice(0, maxRows) : rawParsed;
}

async function bulkInsertTransferRequests(pool: Pool, records: any[]) {
  const CHUNK = 1000;
  for (let i = 0; i < records.length; i += CHUNK) {
    const chunk = records.slice(i, i + CHUNK);
    const valueStrings: string[] = [];
    const params: any[] = [];
    let idx = 1;
    for (const r of chunk) {
      valueStrings.push(
        `($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6}, $${idx + 7}, $${idx + 8}, $${idx + 9}, $${idx + 10}, $${idx + 11}, $${idx + 12}, $${idx + 13})`
      );
      params.push(
        r.id,
        r.requestNo,
        r.fromLocationId,
        r.toLocationId,
        r.fromWarehouseId,
        r.toWarehouseId,
        r.transferType,
        r.requestDate,
        r.createdAt,
        r.updatedAt,
        r.sourceApprovedAt,
        r.dispatchDate,
        r.status,
        r.notes
      );
      idx += 14;
    }
    await pool.query(
      `INSERT INTO "TransferRequest" (
        id, "requestNo", "fromLocationId", "toLocationId", "fromWarehouseId", "toWarehouseId",
        transfer_type, "requestDate", "createdAt", "updatedAt", source_approved_at,
        dispatch_date, status, notes
      ) VALUES ${valueStrings.join(', ')}`,
      params
    );
  }
}

async function bulkInsertTransferRequestItems(pool: Pool, records: any[]) {
  const CHUNK = 1000;
  for (let i = 0; i < records.length; i += CHUNK) {
    const chunk = records.slice(i, i + CHUNK);
    const valueStrings: string[] = [];
    const params: any[] = [];
    let idx = 1;
    for (const r of chunk) {
      valueStrings.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4})`);
      params.push(r.id, r.transferRequestId, r.itemId, r.quantity, r.fulfilledQty);
      idx += 5;
    }
    await pool.query(
      `INSERT INTO "TransferRequestItem" (
        id, "transferRequestId", "itemId", quantity, "fulfilledQty"
      ) VALUES ${valueStrings.join(', ')}`,
      params
    );
  }
}

async function bulkInsertStockMovements(pool: Pool, records: any[]) {
  const CHUNK = 1000;
  for (let i = 0; i < records.length; i += CHUNK) {
    const chunk = records.slice(i, i + CHUNK);
    const valueStrings: string[] = [];
    const params: any[] = [];
    let idx = 1;
    for (const r of chunk) {
      valueStrings.push(
        `($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6}, $${idx + 7}, $${idx + 8}, $${idx + 9}, $${idx + 10}, $${idx + 11}, $${idx + 12})`
      );
      params.push(
        r.id,
        r.movementNo,
        r.itemId,
        r.fromLocationId,
        r.toLocationId,
        r.quantity,
        r.type,
        r.referenceType,
        r.referenceId,
        r.movementDate,
        r.createdAt,
        r.updatedAt,
        r.notes
      );
      idx += 13;
    }
    await pool.query(
      `INSERT INTO "StockMovement" (
        id, "movementNo", "itemId", "fromLocationId", "toLocationId",
        quantity, type, "referenceType", "referenceId", "movementDate",
        "createdAt", "updatedAt", notes
      ) VALUES ${valueStrings.join(', ')}
      ON CONFLICT ("movementNo") DO NOTHING`,
      params
    );
  }
}

async function bulkInsertStockLedgers(pool: Pool, records: any[]) {
  const CHUNK = 1000;
  for (let i = 0; i < records.length; i += CHUNK) {
    const chunk = records.slice(i, i + CHUNK);
    const valueStrings: string[] = [];
    const params: any[] = [];
    let idx = 1;
    for (const r of chunk) {
      valueStrings.push(
        `($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6}, $${idx + 7})`
      );
      params.push(
        r.itemId,
        r.warehouseId,
        r.locationId,
        r.qty,
        r.movementType,
        r.referenceType,
        r.referenceId,
        r.createdAt
      );
      idx += 8;
    }
    await pool.query(
      `INSERT INTO stock_ledgers (
        item_id, warehouse_id, location_id, qty, movement_type,
        reference_type, reference_id, created_at
      ) VALUES ${valueStrings.join(', ')}`,
      params
    );
  }
}

async function bulkUpdateInventoryItems(
  pool: Pool,
  deltas: { warehouseId: string; locationId: string | null; itemId: string; delta: number }[]
) {
  const CHUNK = 1000;
  for (let i = 0; i < deltas.length; i += CHUNK) {
    const chunk = deltas.slice(i, i + CHUNK);
    const valueStrings: string[] = [];
    const params: any[] = [];
    let idx = 1;
    for (const d of chunk) {
      valueStrings.push(`($${idx}::text, $${idx + 1}::text, $${idx + 2}::text, $${idx + 3}::numeric)`);
      params.push(d.warehouseId, d.locationId, d.itemId, d.delta);
      idx += 4;
    }

    // 1. Update existing records
    await pool.query(
      `UPDATE "InventoryItem" inv
       SET quantity = inv.quantity + d.delta, "updatedAt" = NOW()
       FROM (VALUES ${valueStrings.join(', ')}) AS d(warehouse_id, location_id, item_id, delta)
       WHERE inv."warehouseId" = d.warehouse_id
         AND inv."locationId" IS NOT DISTINCT FROM d.location_id
         AND inv."itemId" = d.item_id
         AND inv.status = 'AVAILABLE'`,
      params
    );

    // 2. Insert newly encountered records
    await pool.query(
      `INSERT INTO "InventoryItem" (id, "warehouseId", "locationId", "itemId", quantity, status, "createdAt", "updatedAt")
       SELECT gen_random_uuid(), d.warehouse_id, d.location_id, d.item_id, d.delta, 'AVAILABLE', NOW(), NOW()
       FROM (VALUES ${valueStrings.join(', ')}) AS d(warehouse_id, location_id, item_id, delta)
       WHERE NOT EXISTS (
         SELECT 1 FROM "InventoryItem" inv
         WHERE inv."warehouseId" = d.warehouse_id
           AND inv."locationId" IS NOT DISTINCT FROM d.location_id
           AND inv."itemId" = d.item_id
           AND inv.status = 'AVAILABLE'
       )`,
      params
    );
  }
}

async function processTransfersForTenant(
  prisma: PrismaClient,
  rows: ParsedStnRow[],
  isDryRun: boolean = false,
  pool?: Pool
) {
  console.log(`\n==================================================`);
  console.log(`📦 ${isDryRun ? '[DRY RUN MODE]' : '[LIVE COMMIT MODE]'} Processing ${rows.length} STN transfer rows...`);
  console.log(`==================================================\n`);

  const deltaMap = new Map<string, { warehouseId: string; locationId: string | null; itemId: string; delta: number }>();
  function recordDelta(warehouseId: string, locationId: string | null, itemId: string, delta: number) {
    const key = `${warehouseId}::${locationId || ''}::${itemId}`;
    const existing = deltaMap.get(key);
    if (existing) {
      existing.delta += delta;
    } else {
      deltaMap.set(key, { warehouseId, locationId, itemId, delta });
    }
  }

  // Step 1: Cleanup previous imported STNs in live mode
  if (!isDryRun && pool) {
    console.log(`🧹 Step 1: Cleaning up previously imported STN records...`);
    const existingStnsRes = await pool.query(`
      SELECT id, "requestNo", "fromLocationId", "toLocationId", "fromWarehouseId", "toWarehouseId", status
      FROM "TransferRequest"
      WHERE "requestNo" LIKE 'STN-%'
         OR notes LIKE '%TR-OUT-%'
         OR notes LIKE '%TR-IN-%'
         OR notes LIKE '%OrigDocNo:%'
         OR notes LIKE '%DocNo:%'
    `);
    const existingStns = existingStnsRes.rows;

    let defaultWh = await prisma.warehouse.findFirst({
      where: { code: 'C40001', isDeleted: false },
    }) || await prisma.warehouse.findFirst({
      where: { isDeleted: false },
    });

    if (existingStns.length > 0) {
      const stnIds = existingStns.map((s: any) => s.id);
      console.log(`  Found ${stnIds.length} existing STN headers to clean up.`);

      // Fetch items to reverse their inventory impacts
      const itemsRes = await pool.query(
        `SELECT "transferRequestId", "itemId", quantity, "fulfilledQty"
         FROM "TransferRequestItem"
         WHERE "transferRequestId" = ANY($1)`,
        [stnIds]
      );

      const stnMap = new Map(existingStns.map((s: any) => [s.id, s]));
      for (const item of itemsRes.rows) {
        const stn = stnMap.get(item.transferRequestId);
        if (!stn) continue;
        const qty = parseFloat(item.quantity) || 0;
        const fulfilledQty = parseFloat(item.fulfilledQty) || 0;

        // Reversal of source outbound (-qty becomes +qty)
        const srcWhId = stn.fromWarehouseId || defaultWh?.id || 'default-wh';
        const srcLocId = stn.fromLocationId || null;
        recordDelta(srcWhId, srcLocId, item.itemId, qty);

        // Reversal of destination inbound (+qty becomes -qty if completed)
        if (stn.status === 'COMPLETED' || fulfilledQty > 0) {
          const destWhId = stn.toWarehouseId || defaultWh?.id || 'default-wh';
          const destLocId = stn.toLocationId || null;
          recordDelta(destWhId, destLocId, item.itemId, -(fulfilledQty || qty));
        }
      }

      await pool.query(`DELETE FROM "TransferRequestItem" WHERE "transferRequestId" = ANY($1)`, [stnIds]);
      await pool.query(
        `DELETE FROM "StockMovement" WHERE "referenceType" = 'TRANSFER_REQUEST' OR "referenceId" = ANY($1)`,
        [stnIds]
      );
      await pool.query(
        `DELETE FROM stock_ledgers WHERE reference_type IN ('TRANSFER_IN', 'TRANSFER_OUT') OR reference_id = ANY($1)`,
        [stnIds]
      );
      await pool.query(`DELETE FROM "TransferRequest" WHERE id = ANY($1)`, [stnIds]);
      console.log(`  ✅ Successfully wiped ${stnIds.length} old STN records and queued inventory balance reversals.`);
    }

    // Also purge any orphaned STN movements/ledgers
    await pool.query(
      `DELETE FROM "StockMovement" WHERE notes LIKE 'STN Transfer%' OR "movementNo" LIKE 'MV-OUT-TR-%' OR "movementNo" LIKE 'MV-IN-TR-%'`
    );
    await pool.query(`DELETE FROM stock_ledgers WHERE reference_type IN ('TRANSFER_IN', 'TRANSFER_OUT')`);
  }

  let defaultWarehouse: any = null;
  if (!isDryRun) {
    defaultWarehouse = await prisma.warehouse.findFirst({
      where: { code: 'C40001', isDeleted: false },
    }) || await prisma.warehouse.findFirst({
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

  // Pre-load warehouses and locations into entity cache
  const warehouseMap = new Map<string, EntityRef>();
  const locationMap = new Map<string, EntityRef>();

  if (!isDryRun && pool) {
    const whRows = await pool.query(`SELECT id, code, name FROM "Warehouse" WHERE "isDeleted" = false`);
    for (const r of whRows.rows) {
      warehouseMap.set(r.code.trim().toUpperCase(), { type: 'WAREHOUSE', id: r.id, code: r.code, name: r.name });
    }

    const locRows = await pool.query(`SELECT id, code, name FROM "Location" WHERE "isDeleted" = false`);
    for (const r of locRows.rows) {
      locationMap.set(r.code.trim().toUpperCase(), { type: 'LOCATION', id: r.id, code: r.code, name: r.name });
    }
  }

  async function resolveEntity(code: string, name: string): Promise<EntityRef> {
    const upperCode = code.trim().toUpperCase();

    if (isWarehouseCode(upperCode)) {
      if (warehouseMap.has(upperCode)) {
        return warehouseMap.get(upperCode)!;
      }
      if (!isDryRun) {
        let wh = await prisma.warehouse.findFirst({
          where: { code: upperCode, isDeleted: false },
        });
        if (!wh) {
          console.log(`🏭 Creating Warehouse [${upperCode}]: ${name}`);
          wh = await prisma.warehouse.create({
            data: {
              code: upperCode,
              name: name || 'LOGISTIC AREA WAREHOUSE',
              type: 'GENERAL',
              isActive: true,
            },
          });
        }
        const ref: EntityRef = { type: 'WAREHOUSE', id: wh.id, code: wh.code, name: wh.name };
        warehouseMap.set(upperCode, ref);
        return ref;
      } else {
        const ref: EntityRef = { type: 'WAREHOUSE', id: `wh-${upperCode}`, code: upperCode, name: name || 'Warehouse' };
        warehouseMap.set(upperCode, ref);
        return ref;
      }
    } else {
      if (locationMap.has(upperCode)) {
        return locationMap.get(upperCode)!;
      }
      if (!isDryRun) {
        let loc = await prisma.location.findFirst({
          where: { code: upperCode, isDeleted: false },
        });
        if (!loc) {
          console.log(`📍 Creating Location [${upperCode}]: ${name}`);
          loc = await prisma.location.create({
            data: {
              code: upperCode,
              name,
              warehouseId: defaultWarehouse.id,
              status: 'active',
            },
          });
        }
        const ref: EntityRef = { type: 'LOCATION', id: loc.id, code: loc.code, name: loc.name };
        locationMap.set(upperCode, ref);
        return ref;
      } else {
        const ref: EntityRef = { type: 'LOCATION', id: `loc-${upperCode}`, code: upperCode, name };
        locationMap.set(upperCode, ref);
        return ref;
      }
    }
  }

  // Pre-load items into cache and batch create any missing items
  console.log(`⚙️ Pre-caching Warehouses, Locations, and Item Barcodes...`);
  const allBarcodes = Array.from(new Set(rows.map((r) => r.barCode)));
  const itemMap = new Map<string, string>(); // barcode -> itemId

  if (!isDryRun && pool) {
    const BATCH_BARCODES = 5000;
    for (let i = 0; i < allBarcodes.length; i += BATCH_BARCODES) {
      const chunk = allBarcodes.slice(i, i + BATCH_BARCODES);
      const existing = await pool.query(
        `SELECT id, "barCode" FROM "Item" WHERE "barCode" = ANY($1)`,
        [chunk]
      );
      for (const r of existing.rows) {
        if (r.barCode) itemMap.set(r.barCode, r.id);
      }
    }

    const missingBarcodes = allBarcodes.filter((b) => !itemMap.has(b));
    if (missingBarcodes.length > 0) {
      console.log(`⚠️ Found ${missingBarcodes.length} missing items in database. Creating them now...`);
      for (let i = 0; i < missingBarcodes.length; i += 1000) {
        const chunk = missingBarcodes.slice(i, i + 1000);
        const values: string[] = [];
        const params: any[] = [];
        let idx = 1;
        for (const bc of chunk) {
          const id = crypto.randomUUID();
          values.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, 'active', true, 0, 0, NOW(), NOW())`);
          params.push(id, `ITEM-${bc}`, bc, bc, `STN Item (${bc})`);
          idx += 5;
          itemMap.set(bc, id);
        }
        await pool.query(
          `INSERT INTO "Item" (id, "itemId", sku, "barCode", description, status, "isActive", "unitPrice", unit_cost, "createdAt", "updatedAt")
           VALUES ${values.join(', ')}
           ON CONFLICT ("itemId") DO NOTHING`,
          params
        );
      }
      console.log(`  ✅ Created ${missingBarcodes.length} missing items.`);
    }
  } else {
    for (const bc of allBarcodes) {
      itemMap.set(bc, `mock-item-${bc}`);
    }
  }

  // Group STN rows into single Transfer Requests
  const transferGroups = new Map<string, ParsedStnRow[]>();
  for (const row of rows) {
    const groupKey = `${row.codeTrOut}_${row.codeTrIn}_${row.documentNumber}_${row.documentDate.toISOString().slice(0, 10)}`;
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

  const transferRequestsToInsert: any[] = [];
  const transferItemsToInsert: any[] = [];
  const movementsToInsert: any[] = [];
  const ledgersToInsert: any[] = [];

  let processedLines = 0;
  let completedCount = 0;
  let inTransitCount = 0;

  for (const [groupKey, groupRows] of transferGroups.entries()) {
    const sample = groupRows[0];
    const fromEntity = await resolveEntity(sample.codeTrOut, sample.stockOutLocationName);
    const toEntity = await resolveEntity(sample.codeTrIn, sample.stockInLocationName);

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

    const whLocationMap = new Map<string, string>();
    for (const [code, loc] of locationMap.entries()) {
      if (code.startsWith('WH-')) {
        whLocationMap.set(code.replace('WH-', ''), loc.id);
      }
    }

    const fromWarehouseId = fromEntity.type === 'WAREHOUSE' ? fromEntity.id : null;
    const fromLocationId = fromEntity.type === 'LOCATION' 
      ? fromEntity.id 
      : (whLocationMap.get(fromEntity.code) || null);

    const toWarehouseId = toEntity.type === 'WAREHOUSE' ? toEntity.id : null;
    const toLocationId = toEntity.type === 'LOCATION' 
      ? toEntity.id 
      : (whLocationMap.get(toEntity.code) || null);

    let transferType = 'OUTLET_TO_OUTLET';
    if (fromEntity.type === 'WAREHOUSE' && toEntity.type === 'LOCATION') {
      transferType = 'WAREHOUSE_TO_OUTLET';
    } else if (fromEntity.type === 'LOCATION' && toEntity.type === 'WAREHOUSE') {
      transferType = 'OUTLET_TO_WAREHOUSE';
    } else if (fromEntity.type === 'WAREHOUSE' && toEntity.type === 'WAREHOUSE') {
      transferType = 'WAREHOUSE_TO_WAREHOUSE';
    }

    const transferRequestId = crypto.randomUUID();
    const transferNotes = `TR OUT No: ${outNo} | TR IN No: ${inNo} | OrigDocNo: ${sample.documentNumber} | RecDocNo: ${sample.receivingDocNo || 'N/A'} | RecDate: ${sample.receivingDocDateStr || 'N/A'} | Remarks: ${sample.remarks}`;

    transferRequestsToInsert.push({
      id: transferRequestId,
      requestNo,
      fromLocationId,
      toLocationId,
      fromWarehouseId,
      toWarehouseId,
      transferType,
      requestDate: sample.documentDate,
      createdAt: sample.documentDate,
      updatedAt: sample.documentDate,
      sourceApprovedAt: sample.documentDate,
      dispatchDate: sample.documentDate,
      status: isReceived ? 'COMPLETED' : 'SOURCE_APPROVED',
      notes: transferNotes,
    });

    for (const row of groupRows) {
      const itemId = itemMap.get(row.barCode)!;
      const qty = row.quantity;
      const transferItemId = crypto.randomUUID();

      // 1. TransferRequestItem
      transferItemsToInsert.push({
        id: transferItemId,
        transferRequestId,
        itemId,
        quantity: qty,
        fulfilledQty: isReceived ? qty : 0,
      });

      // 2. Outbound Movement & Ledger
      const outMovId = crypto.randomUUID();
      const outMovNo = `MV-OUT-${outNo}-${row.barCode}-${row.rowNum}`;
      movementsToInsert.push({
        id: outMovId,
        movementNo: outMovNo,
        itemId,
        fromLocationId,
        toLocationId: null,
        quantity: qty,
        type: 'TRANSFER',
        referenceType: 'TRANSFER_REQUEST',
        referenceId: transferRequestId,
        movementDate: sample.documentDate,
        createdAt: sample.documentDate,
        updatedAt: sample.documentDate,
        notes: `STN Transfer Out: ${requestNo} (${outNo})`,
      });

      ledgersToInsert.push({
        itemId,
        warehouseId: fromWarehouseId || defaultWarehouse.id,
        locationId: fromLocationId,
        qty: -qty,
        movementType: 'TRANSFER',
        referenceType: 'TRANSFER_OUT',
        referenceId: transferRequestId,
        createdAt: sample.documentDate,
      });

      // Source Inventory Delta (-qty)
      const srcWhId = fromWarehouseId || defaultWarehouse.id;
      const srcLocId = fromLocationId || null;
      recordDelta(srcWhId, srcLocId, itemId, -qty);

      // 3. Inbound Movement & Ledger (if received)
      if (isReceived && sample.receivingDocDate) {
        const inMovId = crypto.randomUUID();
        const inMovNo = `MV-IN-${inNo}-${row.barCode}-${row.rowNum}`;
        movementsToInsert.push({
          id: inMovId,
          movementNo: inMovNo,
          itemId,
          fromLocationId: null,
          toLocationId,
          quantity: qty,
          type: 'TRANSFER',
          referenceType: 'TRANSFER_REQUEST',
          referenceId: transferRequestId,
          movementDate: sample.receivingDocDate,
          createdAt: sample.receivingDocDate,
          updatedAt: sample.receivingDocDate,
          notes: `STN Transfer In: ${requestNo} (${inNo})`,
        });

        ledgersToInsert.push({
          itemId,
          warehouseId: toWarehouseId || defaultWarehouse.id,
          locationId: toLocationId,
          qty: qty,
          movementType: 'TRANSFER',
          referenceType: 'TRANSFER_IN',
          referenceId: transferRequestId,
          createdAt: sample.receivingDocDate,
        });

        // Destination Inventory Delta (+qty)
        const destWhId = toWarehouseId || defaultWarehouse.id;
        const destLocId = toLocationId || null;
        recordDelta(destWhId, destLocId, itemId, qty);
      }

      processedLines++;
    }
  }

  // Live execution via high-speed chunked SQL batching
  if (!isDryRun && pool) {
    console.log(`\n💾 Executing high-speed batch inserts to database...`);
    const startTime = Date.now();

    console.log(`  - Inserting ${transferRequestsToInsert.length} TransferRequests...`);
    await bulkInsertTransferRequests(pool, transferRequestsToInsert);

    console.log(`  - Inserting ${transferItemsToInsert.length} TransferRequestItems...`);
    await bulkInsertTransferRequestItems(pool, transferItemsToInsert);

    console.log(`  - Inserting ${movementsToInsert.length} StockMovements...`);
    await bulkInsertStockMovements(pool, movementsToInsert);

    console.log(`  - Inserting ${ledgersToInsert.length} StockLedgers...`);
    await bulkInsertStockLedgers(pool, ledgersToInsert);

    const nonZeroDeltas = Array.from(deltaMap.values()).filter((d) => Math.abs(d.delta) > 0.00001);
    console.log(`  - Updating ${nonZeroDeltas.length} InventoryItem stock balances...`);
    await bulkUpdateInventoryItems(pool, nonZeroDeltas);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`  ⚡ All database inserts committed successfully in ${elapsed}s!`);
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

  let filePath = path.join(__dirname, '..', 'data', 'stn.json');
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
    console.log(`   - Doc Date     : ${rows[0].documentDate.toISOString()} (raw: ${rows[0].documentDateStr})`);
    console.log(`   - Rec Date     : ${rows[0].receivingDocDate ? rows[0].receivingDocDate.toISOString() : '[IN TRANSIT]'}`);
    console.log(`   - Barcode      : ${rows[0].barCode}`);
    console.log(`   - Qty          : ${rows[0].quantity}`);
  }

  const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;

  if (managementUrl && masterKey) {
    const pool = new Pool({ connectionString: managementUrl });
    const adapter = new PrismaPg(pool);
    const management = new ManagementClient({ adapter } as any);

    let companies: any[] = [];
    try {
      companies = await management.company.findMany({
        where: { status: 'active' },
      });
    } catch (err: any) {
      console.warn(`ℹ️ Multi-tenant check skipped (${err.message}).`);
    } finally {
      await management.$disconnect();
      await pool.end();
    }

    if (companies.length > 0) {
      console.log(`\n🏢 Found ${companies.length} tenant companies. Running transfer import for each...`);
      for (const company of companies) {
        console.log(`\n👉 Processing Tenant: ${company.name} (${company.code})`);
        let connectionString = company.dbUrl;
        if (!connectionString && company.dbPassword) {
          try {
            const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
            connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
          } catch (e) {
            console.warn(`  ⚠️ Decryption failed, using default connectionUrl`);
          }
        }

        if (!connectionString) {
          connectionString = process.env.DATABASE_URL;
        }

        if (!connectionString) continue;

        const tenantPool = new Pool({ connectionString });
        const tenantAdapter = new PrismaPg(tenantPool);
        const tenantPrisma = new PrismaClient({ adapter: tenantAdapter });

        try {
          await tenantPrisma.$connect();
          await processTransfersForTenant(tenantPrisma, rows, isDryRun, tenantPool);
        } finally {
          await tenantPrisma.$disconnect();
          await tenantPool.end();
        }
      }
      return;
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
    await processTransfersForTenant(prisma, rows, isDryRun, pool);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌ Error executing script:', err);
  process.exit(1);
});
