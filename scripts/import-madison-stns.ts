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

export interface ParsedMadisonStnRow {
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

const KNOWN_WAREHOUSE_CODES = new Set(['C40001', 'C-TSDMC', 'C30001', 'C20001']);

const isWarehouseCode = (code: string) => {
  const c = code.trim().toUpperCase();
  if (KNOWN_WAREHOUSE_CODES.has(c)) return true;
  return c.startsWith('C') || c.startsWith('WH') || c.includes('WAREHOUSE');
};

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

export function readAndParseMadisonStns(filePath: string, maxRows?: number): ParsedMadisonStnRow[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found at path: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);

  const rawParsed: ParsedMadisonStnRow[] = [];

  // Line 0 is header. Data starts at line 1.
  for (let i = 1; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine || rawLine.startsWith('---')) continue;

    // Split by tab (\t) or markdown table pipe (|)
    let parts = rawLine.includes('\t')
      ? rawLine.split('\t').map((p) => p.trim())
      : rawLine.split('|').map((p) => p.trim()).filter((p) => p !== '');

    if (parts.length < 9) continue;

    const stockOutLocationName = parts[0] || '';
    const codeTrOut = parts[1] || '';
    const documentNumber = parts[2] || '';
    const documentDateStr = parts[3] || '';
    const documentType = parts[4] || 'Transfer Out';
    const stockInLocationName = parts[5] || '';
    const codeTrIn = parts[6] || '';
    const barCode = (parts[7] || '').replace(/"/g, '').trim();
    const rawQty = parts[8] || '1';
    const quantity = parseFloat(rawQty) || 1;
    const receivingDocNo = parts[9] || '';
    const receivingDocDateStr = parts[10] || '';
    const remarks = parts[11] || '';
    const documentStatus = parts[12] || 'Approved / Closed';

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
  rows: ParsedMadisonStnRow[],
  isDryRun: boolean = false
) {
  console.log(`\n==================================================`);
  console.log(`📦 ${isDryRun ? '[DRY RUN MODE]' : '[LIVE COMMIT MODE]'} Processing ${rows.length} Madison STN lines...`);
  console.log(`==================================================\n`);

  let defaultWarehouse: any = null;
  if (!isDryRun) {
    defaultWarehouse = await prisma.warehouse.findFirst({
      where: { isDeleted: false },
    });

    if (!defaultWarehouse) {
      console.log(`🏭 Creating default Warehouse (MAIN-WH)...`);
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
              name: name || 'LOGISTIC AREA',
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
              description: `Madison STN Item (${row.barCode})`,
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
  const transferGroups = new Map<string, ParsedMadisonStnRow[]>();
  for (const row of rows) {
    const groupKey = `${row.codeTrOut}_${row.codeTrIn}_${row.documentNumber}_${row.documentDateStr}`;
    if (!transferGroups.has(groupKey)) {
      transferGroups.set(groupKey, []);
    }
    transferGroups.get(groupKey)!.push(row);
  }

  console.log(`📋 Grouped ${rows.length} total rows into ${transferGroups.size} STN Transfer Request documents.`);

  let stnCounter = 1;
  let processedLines = 0;
  let completedCount = 0;
  let inTransitCount = 0;

  for (const [groupKey, groupRows] of transferGroups.entries()) {
    const sample = groupRows[0];
    const fromEntity = entityCache.get(sample.codeTrOut)!;
    const toEntity = entityCache.get(sample.codeTrIn)!;

    const requestNo = `STN-MADISON-${String(stnCounter++).padStart(5, '0')}`;
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
      console.log(`🔍 [DRY-RUN #${requestNo}] ${sample.documentDateStr} | ${fromEntity.name} (${fromEntity.code}) -> ${toEntity.name} (${toEntity.code}) | Type: ${transferType} | Status: ${isReceived ? 'COMPLETED' : 'IN_TRANSIT'} | Items: ${groupRows.length}`);
      processedLines += groupRows.length;
      continue;
    }

    // Live execution
    let transferRequest = await prisma.transferRequest.findFirst({
      where: {
        fromLocationId: fromLocationId || undefined,
        toLocationId: toLocationId || undefined,
        requestDate: sample.documentDate,
        notes: { contains: `DocNo: ${sample.documentNumber}` },
      },
    });

    if (!transferRequest) {
      transferRequest = await prisma.transferRequest.create({
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
          notes: `DocNo: ${sample.documentNumber} | RecDocNo: ${sample.receivingDocNo || 'N/A'} | ReceivingDate: ${sample.receivingDocDateStr || 'N/A'} | Remarks: ${sample.remarks}`,
        },
      });
    }

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

      // Outbound Movement & Ledger
      const outMovNo = `MV-OUT-${row.codeTrOut}-${row.barCode}-${sample.documentDate.getTime()}-${Math.floor(Math.random() * 1000)}`;
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
          notes: `STN Transfer Out: ${requestNo}`,
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

        const inMovNo = `MV-IN-${row.codeTrIn}-${row.barCode}-${sample.receivingDocDate.getTime()}-${Math.floor(Math.random() * 1000)}`;
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
            notes: `STN Transfer In: ${requestNo}`,
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
  console.log(`==================================================\n`);
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run') || process.argv.includes('-d');

  let limit: number | undefined = undefined;
  const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
  if (limitArg) {
    limit = parseInt(limitArg.split('=')[1], 10);
  }

  console.log(`🚀 Starting Madison STN Import Script...`);
  if (isDryRun) {
    console.log(`⚠️ DRY RUN ACTIVATED: No database changes will be committed.`);
  }

  const stnFilePath = path.join(__dirname, '..', 'data', 'A-madison-STN.md');
  const rows = readAndParseMadisonStns(stnFilePath, limit);

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
