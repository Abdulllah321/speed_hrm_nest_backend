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
  generatedTrOutNo: string;
  generatedTrInNo: string;
}

export interface EntityRef {
  type: 'WAREHOUSE' | 'LOCATION';
  id: string;
  code: string;
  name: string;
}

const isWarehouseCode = (code: string) => {
  const c = code.trim().toUpperCase();
  return c === 'C40001' || c.startsWith('WH') || c.includes('WAREHOUSE');
};

export function readAndParseMdTransfers(filePath: string, maxRows?: number): ParsedTransferRow[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found at path: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);

  const parsedRows: ParsedTransferRow[] = [];

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

    // Generate formatted Outlet TR OUT and TR IN Numbers (e.g. TROUT-001, TRIN-001)
    const numOutStr = docNoOut.replace(/\D/g, '') || '1';
    const numInStr = receivingDocNoTrIn.replace(/\D/g, '') || '1';

    const generatedTrOutNo = `TROUT-${numOutStr.padStart(3, '0')}`;
    const generatedTrInNo = `TRIN-${numInStr.padStart(3, '0')}`;

    parsedRows.push({
      rowNum: parsedRows.length + 1,
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
      generatedTrOutNo,
      generatedTrInNo,
    });

    if (maxRows && parsedRows.length >= maxRows) {
      break;
    }
  }

  return parsedRows;
}

async function processTransfersForTenant(
  prisma: PrismaClient,
  rows: ParsedTransferRow[],
  isDryRun: boolean = false
) {
  console.log(`\n==================================================`);
  console.log(`📦 ${isDryRun ? '[DRY RUN MODE]' : '[LIVE COMMIT MODE]'} Processing ALL ${rows.length} rows into database...`);
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
      // Find or create Warehouse
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
      // Find or create Location
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
  console.log(`⚙️ Pre-caching and initializing Warehouses (C40001), Locations, and Items...`);
  
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

  const warehouseCount = Array.from(entityCache.values()).filter((e) => e.type === 'WAREHOUSE').length;
  const locationCount = Array.from(entityCache.values()).filter((e) => e.type === 'LOCATION').length;

  console.log(`✅ Cached ${warehouseCount} Warehouses (including C40001), ${locationCount} Outlet Locations, and ${itemCache.size} unique Items.`);

  // Group rows into Transfer Requests by unique (codeTrOut, docNoOut, codeTrIn, receivingDocNoTrIn)
  const transferGroups = new Map<string, ParsedTransferRow[]>();
  for (const row of rows) {
    const groupKey = `${row.codeTrOut}_${row.docNoOut}_${row.codeTrIn}_${row.receivingDocNoTrIn}`;
    if (!transferGroups.has(groupKey)) {
      transferGroups.set(groupKey, []);
    }
    transferGroups.get(groupKey)!.push(row);
  }

  console.log(`\n📋 Grouped ${rows.length} total rows into ${transferGroups.size} unique Transfer Requests.`);

  let stnCounter = 1;
  let processedCount = 0;

  for (const [groupKey, groupRows] of transferGroups.entries()) {
    const sample = groupRows[0];
    const fromEntity = entityCache.get(sample.codeTrOut)!;
    const toEntity = entityCache.get(sample.codeTrIn)!;

    // Sequential STN number format e.g. STN-00001
    const stnNumber = `STN-${String(stnCounter++).padStart(5, '0')}`;
    const outNo = sample.generatedTrOutNo; // e.g. TROUT-001
    const inNo = sample.generatedTrInNo;   // e.g. TRIN-001

    if (isDryRun && stnCounter % 1000 === 0) {
      console.log(`🔍 [DRY-RUN Progress] Processed ${stnCounter} / ${transferGroups.size} STNs (${processedCount} line items)...`);
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
            status: sample.documentStatus === 'Approved / Closed' ? 'APPROVED' : 'COMPLETED',
            transferType,
            notes: `TR OUT No: ${outNo} | TR IN No: ${inNo} | TextLine: ${sample.textLine} | Remarks: ${sample.remarks}`,
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
  console.log(`   - Warehouses (C40001): ${warehouseCount}`);
  console.log(`   - Outlet Locations  : ${locationCount}`);
  console.log(`   - TR OUT Format     : TROUT-001, TROUT-002, etc.`);
  console.log(`   - TR IN Format      : TRIN-001, TRIN-003, TRIN-049, etc.`);
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

  console.log(`🚀 Starting Transfer Import Script (Processing ${limit ? `first ${limit}` : 'ALL available'} Rows)...`);
  if (isDryRun) {
    console.log(`⚠️ DRY RUN ACTIVATED: No database changes will be committed.`);
  }

  const mdFilePath = path.join(__dirname, '..', 'tableConvert.com_7s3gov.md');
  const rows = readAndParseMdTransfers(mdFilePath, limit);

  console.log(`📄 Successfully parsed ${rows.length} rows from markdown file.`);
  if (rows.length > 0) {
    console.log('\n🔍 Sample parsed row (#1):');
    console.log(`   - OUT Entity  : ${rows[0].stockOutLocationName} (${rows[0].codeTrOut}) [${isWarehouseCode(rows[0].codeTrOut) ? 'WAREHOUSE' : 'LOCATION'}]`);
    console.log(`   - OUT TR No   : ${rows[0].generatedTrOutNo}`);
    console.log(`   - IN Entity   : ${rows[0].stockInLocationName} (${rows[0].codeTrIn}) [${isWarehouseCode(rows[0].codeTrIn) ? 'WAREHOUSE' : 'LOCATION'}]`);
    console.log(`   - IN TR No    : ${rows[0].generatedTrInNo}`);
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
