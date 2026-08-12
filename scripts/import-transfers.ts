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

export interface ParsedTransferRow {
  rowNum: number;
  stockOutLocationName: string;
  codeTrOut: string;
  docNoOutInpl: string;
  docNoOut: string;
  documentDateOut: string;
  textLine: string;
  stockInLocationName: string;
  codeTrIn: string;
  barCode: string;
  quantity: number;
  receivingDocNoTrIn: string;
  receivingDocDate: string;
  remarks: string;
  documentStatus: string;
  parsedDate: Date;
}

export interface EntityRef {
  type: 'WAREHOUSE' | 'LOCATION';
  id: string;
  code: string;
  name: string;
}

const KNOWN_WAREHOUSE_CODES = new Set(['C-TSDMC', 'C30001', 'C20001', 'C40001']);

const isWarehouseCode = (code: string) => {
  const c = code.trim().toUpperCase();
  if (KNOWN_WAREHOUSE_CODES.has(c)) return true;
  return c.startsWith('WH') || c.includes('WAREHOUSE');
};

export function parseCustomDate(dateStr: string): Date {
  if (!dateStr || !dateStr.trim()) return new Date(0);

  const trimmed = dateStr.trim();
  const spaceParts = trimmed.split(/\s+/);
  const datePart = spaceParts[0];
  const timePart = spaceParts[1] || '0:0';

  const dParts = datePart.split('/');
  if (dParts.length !== 3) return new Date(0);

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

export function readAndParseMdTransfers(filePath: string, maxRows?: number): ParsedTransferRow[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found at path: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);

  const rawParsed: ParsedTransferRow[] = [];

  // Line 0 is header, Line 1 is separator, data starts from Line 2 (index 2)
  for (let i = 2; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine || rawLine.startsWith('---')) continue;

    const parts = rawLine.split('|').map((p) => p.trim());
    if (parts.length < 12) continue;

    const stockOutLocationName = parts[0] || '';
    const codeTrOut = parts[1] || '';
    const docNoOutInpl = parts[2] || '';
    const docNoOut = parts[3] || '';
    const documentDateOut = parts[4] || '';
    const textLine = parts[5] || '';
    const stockInLocationName = parts[6] || '';
    const codeTrIn = parts[7] || '';

    // Column index 9 is BarCode value, 10 is Quantity, 11 is ReceivingDocumentNo TR IN
    const rawBarCode = parts[9] || parts[8] || '';
    const barCode = rawBarCode.replace(/"/g, '').trim();

    const rawQty = parts[10] || '1';
    const quantity = parseFloat(rawQty) || 1;

    const receivingDocNoTrIn = parts[11] || '';
    const receivingDocDate = parts[12] || '';
    const remarks = parts[13] || '';
    const documentStatus = parts[14] || 'Approved / Closed';

    if (!codeTrOut || !codeTrIn || !barCode) continue;

    // Parse date & time for sorting (prefer documentDateOut, fallback to receivingDocDate)
    let parsedDate = parseCustomDate(documentDateOut);
    if (parsedDate.getTime() === 0) {
      parsedDate = parseCustomDate(receivingDocDate);
    }

    rawParsed.push({
      rowNum: 0,
      stockOutLocationName,
      codeTrOut,
      docNoOutInpl,
      docNoOut,
      documentDateOut,
      textLine,
      stockInLocationName,
      codeTrIn,
      barCode,
      quantity,
      receivingDocNoTrIn,
      receivingDocDate,
      remarks,
      documentStatus,
      parsedDate,
    });
  }

  // Sort ALL parsed rows chronologically by date and time ascending (oldest first)
  rawParsed.sort((a, b) => a.parsedDate.getTime() - b.parsedDate.getTime());

  // Assign sequential row numbers after sorting
  rawParsed.forEach((row, index) => {
    row.rowNum = index + 1;
  });

  // Apply maxRows limit if provided
  const finalRows = maxRows ? rawParsed.slice(0, maxRows) : rawParsed;
  return finalRows;
}

async function processTransfersForTenant(
  prisma: PrismaClient,
  rows: ParsedTransferRow[],
  isDryRun: boolean = false
) {
  console.log(`\n==================================================`);
  console.log(`📦 ${isDryRun ? '[DRY RUN MODE]' : '[LIVE COMMIT MODE]'} Processing ${rows.length} rows (Chronological Date & Time Order)...`);
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
          code: 'MAIN-WH',
          name: 'Main Central Warehouse',
          type: 'GENERAL',
          isActive: true,
        },
      });
    }
  } else {
    defaultWarehouse = { id: 'dry-run-wh-id', code: 'MAIN-WH', name: 'Main Central Warehouse' };
    console.log(`🏭 [DRY-RUN] Using Warehouse (MAIN-WH)`);
  }

  const entityCache = new Map<string, EntityRef>();
  const itemCache = new Map<string, any>();

  // Function to ensure entity (Warehouse or Location) exists
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
              name: name || 'Central Warehouse',
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
        console.log(`🏭 [DRY-RUN] Warehouse verified/created [${code}]: ${name}`);
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
        console.log(`📍 [DRY-RUN] Location verified/created [${code}]: ${name}`);
        entityCache.set(code, ref);
        return ref;
      }
    }
  }

  // Pre-cache Warehouses, Locations, and Items
  console.log(`⚙️ Pre-caching Warehouses, Locations, and Items...`);
  
  for (const row of rows) {
    await resolveEntity(row.codeTrOut, row.stockOutLocationName);
    await resolveEntity(row.codeTrIn, row.stockInLocationName);

    // ITEM / Barcode
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
              description: `Imported Item (${row.barCode})`,
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

  const warehousesList = Array.from(entityCache.values()).filter((e) => e.type === 'WAREHOUSE');
  const locationsList = Array.from(entityCache.values()).filter((e) => e.type === 'LOCATION');

  console.log(`✅ Cached ${warehousesList.length} Warehouses [${warehousesList.map(w => w.code).join(', ')}], ${locationsList.length} Outlet Locations, and ${itemCache.size} unique Items.`);

  // Group rows into Transfer Requests maintaining date/time chronological order
  const transferGroups = new Map<string, ParsedTransferRow[]>();
  for (const row of rows) {
    const groupKey = `${row.codeTrOut}_${row.docNoOut}_${row.codeTrIn}_${row.receivingDocNoTrIn}_${row.documentDateOut}`;
    if (!transferGroups.has(groupKey)) {
      transferGroups.set(groupKey, []);
    }
    transferGroups.get(groupKey)!.push(row);
  }

  console.log(`\n📋 Grouped ${rows.length} total rows into ${transferGroups.size} unique Transfer Requests in Date & Time order.`);

  // Per-outlet/warehouse sequential counters starting at 1 for the oldest document up to N for the newest
  const trOutCounters = new Map<string, number>();
  const trInCounters = new Map<string, number>();

  let stnCounter = 1;
  let processedCount = 0;

  for (const [groupKey, groupRows] of transferGroups.entries()) {
    const sample = groupRows[0];
    const fromEntity = entityCache.get(sample.codeTrOut)!;
    const toEntity = entityCache.get(sample.codeTrIn)!;

    // 1. Sequential STN number (global system counter, 1-indexed from oldest to newest)
    const stnNumber = `STN-${String(stnCounter++).padStart(5, '0')}`;

    // 2. Sequential TR OUT per outlet/warehouse (1-indexed from oldest to newest: TROUT-001, TROUT-002...)
    const currentOutSeq = (trOutCounters.get(fromEntity.code) || 0) + 1;
    trOutCounters.set(fromEntity.code, currentOutSeq);
    const outNo = `TROUT-${String(currentOutSeq).padStart(3, '0')}`;

    // 3. Sequential TR IN per outlet/warehouse (1-indexed from oldest to newest: TRIN-001, TRIN-002...)
    const currentInSeq = (trInCounters.get(toEntity.code) || 0) + 1;
    trInCounters.set(toEntity.code, currentInSeq);
    const inNo = `TRIN-${String(currentInSeq).padStart(3, '0')}`;

    if (isDryRun && (stnCounter <= 12 || stnCounter % 1000 === 0)) {
      console.log(`🔍 [DRY-RUN #${stnNumber}] Date: ${sample.documentDateOut || sample.receivingDocDate} | ${fromEntity.name} (${fromEntity.code} - ${fromEntity.type}) [${outNo}] -> ${toEntity.name} (${toEntity.code} - ${toEntity.type}) [${inNo}]`);
    } else if (!isDryRun && stnCounter % 500 === 0) {
      console.log(`🚀 [LIVE Progress] Processed ${stnCounter} / ${transferGroups.size} STNs (${processedCount} line items)...`);
    }

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

    let transferRequest: any = null;

    if (!isDryRun) {
      // Find or create TransferRequest by requestNo
      transferRequest = await prisma.transferRequest.findUnique({
        where: { requestNo: stnNumber },
      });

      if (!transferRequest) {
        transferRequest = await prisma.transferRequest.create({
          data: {
            requestNo: stnNumber,
            fromLocationId,
            toLocationId,
            fromWarehouseId,
            toWarehouseId,
            requestDate: sample.parsedDate,
            status: sample.documentStatus === 'Approved / Closed' ? 'APPROVED' : 'COMPLETED',
            transferType,
            notes: `TR OUT No: ${outNo} | TR IN No: ${inNo} | Date: ${sample.documentDateOut} | TextLine: ${sample.textLine} | Remarks: ${sample.remarks}`,
          },
        });
      }
    } else {
      transferRequest = { id: `tr-${stnNumber}`, requestNo: stnNumber };
    }

    // Process line items & stock movements
    for (const row of groupRows) {
      const item = itemCache.get(row.barCode);
      const qty = row.quantity;

      if (isDryRun) {
        processedCount++;
        continue;
      }

      // 1. Create TransferRequestItem
      const existingTrItem = await prisma.transferRequestItem.findFirst({
        where: {
          transferRequestId: transferRequest.id,
          itemId: item.id,
        },
      });

      if (!existingTrItem) {
        await prisma.transferRequestItem.create({
          data: {
            transferRequestId: transferRequest.id,
            itemId: item.id,
            quantity: qty,
            fulfilledQty: qty,
          },
        });
      }

      // 2. Adjust Stock at Source (Deduct Qty)
      if (fromEntity.type === 'WAREHOUSE') {
        const sourceInv = await prisma.inventoryItem.findFirst({
          where: {
            warehouseId: fromEntity.id,
            locationId: null,
            itemId: item.id,
          },
        });

        if (sourceInv) {
          await prisma.inventoryItem.update({
            where: { id: sourceInv.id },
            data: { quantity: { decrement: qty } },
          });
        } else {
          await prisma.inventoryItem.create({
            data: {
              warehouseId: fromEntity.id,
              locationId: null,
              itemId: item.id,
              quantity: -qty,
              status: 'AVAILABLE',
            },
          });
        }
      } else {
        const sourceInv = await prisma.inventoryItem.findFirst({
          where: {
            locationId: fromLocationId,
            itemId: item.id,
          },
        });

        if (sourceInv) {
          await prisma.inventoryItem.update({
            where: { id: sourceInv.id },
            data: { quantity: { decrement: qty } },
          });
        } else {
          await prisma.inventoryItem.create({
            data: {
              warehouseId: defaultWarehouse.id,
              locationId: fromLocationId,
              itemId: item.id,
              quantity: -qty,
              status: 'AVAILABLE',
            },
          });
        }
      }

      // 3. Adjust Stock at Destination (Add Qty)
      if (toEntity.type === 'WAREHOUSE') {
        const destInv = await prisma.inventoryItem.findFirst({
          where: {
            warehouseId: toEntity.id,
            locationId: null,
            itemId: item.id,
          },
        });

        if (destInv) {
          await prisma.inventoryItem.update({
            where: { id: destInv.id },
            data: { quantity: { increment: qty } },
          });
        } else {
          await prisma.inventoryItem.create({
            data: {
              warehouseId: toEntity.id,
              locationId: null,
              itemId: item.id,
              quantity: qty,
              status: 'AVAILABLE',
            },
          });
        }
      } else {
        const destInv = await prisma.inventoryItem.findFirst({
          where: {
            locationId: toLocationId,
            itemId: item.id,
          },
        });

        if (destInv) {
          await prisma.inventoryItem.update({
            where: { id: destInv.id },
            data: { quantity: { increment: qty } },
          });
        } else {
          await prisma.inventoryItem.create({
            data: {
              warehouseId: defaultWarehouse.id,
              locationId: toLocationId,
              itemId: item.id,
              quantity: qty,
              status: 'AVAILABLE',
            },
          });
        }
      }

      // 4. Create StockMovement entry
      const movementNo = `MV-${row.codeTrOut}-${row.codeTrIn}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      await prisma.stockMovement.create({
        data: {
          movementNo,
          itemId: item.id,
          fromLocationId,
          toLocationId,
          quantity: qty,
          type: 'TRANSFER',
          referenceType: 'TRANSFER_REQUEST',
          referenceId: transferRequest.id,
          movementDate: sample.parsedDate,
          notes: `STN: ${stnNumber} | TR OUT: ${outNo} | TR IN: ${inNo}`,
        },
      });

      // 5. Create StockLedger Entries (Outbound & Inbound)
      await prisma.stockLedger.create({
        data: {
          itemId: item.id,
          warehouseId: fromWarehouseId,
          locationId: fromLocationId,
          qty: -qty,
          referenceType: 'TRANSFER_OUT',
          referenceId: transferRequest.id,
          movementType: 'TRANSFER',
          createdAt: sample.parsedDate,
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
          createdAt: sample.parsedDate,
        },
      });

      processedCount++;
    }
  }

  console.log(`\n==================================================`);
  console.log(`✨ ${isDryRun ? '[DRY RUN SUMMARY]' : '[IMPORT SUMMARY]'}`);
  console.log(`   - Total Rows Parsed : ${rows.length}`);
  console.log(`   - Total Rows Created: ${processedCount}`);
  console.log(`   - STNs Generated    : ${transferGroups.size} (Format: STN-00001 to STN-${String(transferGroups.size).padStart(5, '0')})`);
  console.log(`   - Warehouses        : ${warehousesList.length} [${warehousesList.map(w => w.code).join(', ')}]`);
  console.log(`   - Outlet Locations  : ${locationsList.length}`);
  console.log(`   - TR OUT Format     : Sequential per Outlet starting from TROUT-001`);
  console.log(`   - TR IN Format      : Sequential per Outlet starting from TRIN-001`);
  console.log(`==================================================\n`);
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run') || process.argv.includes('-d');

  // Optional --limit=<N> parameter
  let limit: number | undefined = undefined;
  const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
  if (limitArg) {
    limit = parseInt(limitArg.split('=')[1], 10);
  }

  console.log(`🚀 Starting Transfer Import Script (Processing ${limit ? `first ${limit}` : 'ALL available'} Rows sorted by Date & Time)...`);
  if (isDryRun) {
    console.log(`⚠️ DRY RUN ACTIVATED: No database changes will be committed.`);
  }

  const mdFilePath = path.join(__dirname, '..', 'tableConvert.com_7s3gov.md');
  const rows = readAndParseMdTransfers(mdFilePath, limit);

  console.log(`📄 Successfully parsed and sorted ${rows.length} rows by Date & Time.`);
  if (rows.length > 0) {
    console.log('\n🔍 First Chronological Transfer Row (#1 - Oldest Record):');
    console.log(`   - Date & Time : ${rows[0].documentDateOut || rows[0].receivingDocDate}`);
    console.log(`   - OUT Entity  : ${rows[0].stockOutLocationName} (${rows[0].codeTrOut}) [${isWarehouseCode(rows[0].codeTrOut) ? 'WAREHOUSE' : 'LOCATION'}]`);
    console.log(`   - IN Entity   : ${rows[0].stockInLocationName} (${rows[0].codeTrIn}) [${isWarehouseCode(rows[0].codeTrIn) ? 'WAREHOUSE' : 'LOCATION'}]`);
    console.log(`   - Barcode     : ${rows[0].barCode}`);
    console.log(`   - Quantity    : ${rows[0].quantity}`);
  }

  const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;

  // Check if Multi-Tenant setup with Master DB is active
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

  // Single DB Fallback using standard DATABASE_URL
  console.log('\n🔗 Running on primary DATABASE_URL...');
  const prisma = new PrismaClient();
  try {
    await prisma.$connect();
    await processTransfersForTenant(prisma, rows, isDryRun);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('❌ Error executing script:', err);
  process.exit(1);
});
