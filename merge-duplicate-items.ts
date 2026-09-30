import 'dotenv/config';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as crypto from 'crypto';

function decrypt(encryptedText: string, masterKeyString: string): string {
  if (!encryptedText || !masterKeyString || masterKeyString.length < 32) {
    return '';
  }
  const masterKey = Buffer.from(masterKeyString.slice(0, 32), 'utf-8');
  const algorithm = 'aes-256-gcm';

  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    return '';
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

const realItemIds = [
  '846eecca-01f8-4bac-bbd9-0b8978d22b9e', '1c5ed371-17cd-4bbf-be37-77286e071cfc',
  '9c22efb2-364b-4b0e-a40b-9dd2f43ce45a', '38a59e78-336b-4bc1-b184-55235a2585cc',
  'c512b797-fc55-45fa-bf4d-b5be735c20e4', 'cbd38219-6228-4920-bd4c-11fcb27ecdab',
  'af10bb71-9d9d-45a8-8d0a-56922f174902', 'e57f7123-e454-4c91-a441-5a61236a2805',
  '139415a4-2b63-4524-bf6b-7965203b30aa', 'c0802456-277f-4f1c-94ee-c64c803a94e7',
  '6bf666c8-18ed-4eb6-8dad-27172b5ade58', 'a38b9e13-6328-4966-a45f-c72caab47556',
  'f19f474d-74da-4709-8e5f-475961a7703d', '9a4e8027-160d-48b2-99bb-7bba436afa0d',
  '5eeda180-1938-4d2a-a36c-411d5088beb6', '3046ce1c-c41c-4284-9756-7f101bae6f3d',
  'b39e8349-7d0b-4b3f-b604-313ca44178da', '5bf8aeec-b3d0-4a62-8f1d-78634e1df6e0',
  'e73c75b8-99dc-48c1-9856-a8f581a46eec', '83812b85-bb80-453d-ad42-5d666b04bc0b',
  'bec7cef8-8c5b-46ea-ad26-ec76293da1a4', '44692c21-15b0-43b8-a389-917ba70d0b94',
  '7152a3d5-c780-4882-a0f7-d4daa811d189', '468b0475-67ed-46f2-8549-8f8ac8c3b98a',
  '7c408b71-aa64-405a-9c44-e5dcd84537aa', 'e7d3a0e4-3322-4caf-a144-fb85f735e013',
  '436a4529-9dc5-4884-bcb5-ab6de284708a', '821a69db-8aef-4963-a602-f88ed7762027',
  '51feb06b-09b5-4ce2-9c33-2316763e010d', '3da9852b-d536-4de3-aa76-03e9ce7606b9',
  '8cd8e122-d082-4e9d-aa33-5651430e942b', 'f3105b8f-b357-418f-8c18-c8959c9559d3',
  'c470080d-4eae-4028-8f52-e24a24edd6ae', 'a8198d1f-f2f2-428e-9b88-b06810f900bf'
];

async function runMergeForTenant(tenantPrisma: any, companyName: string) {
  const tablesResult = await tenantPrisma.$queryRawUnsafe(`
    SELECT table_name, column_name 
    FROM information_schema.columns 
    WHERE column_name IN ('item_id', 'itemId', 'swap_item_id') 
      AND table_schema = 'public'
      AND table_name != 'Item';
  `);

  console.log(`[${companyName}] Found ${tablesResult.length} tables referencing items.`);
  if (tablesResult.length === 0) {
     console.log(`[${companyName}] Warning: 0 tables found. Are you sure you're connected to the correct schema?`);
  }

  for (const realId of realItemIds) {
    const realItem = await tenantPrisma.item.findUnique({ where: { id: realId } });
    if (!realItem || !realItem.barCode) {
      continue;
    }

    const duplicates = await tenantPrisma.item.findMany({
      where: { 
        barCode: realItem.barCode, 
        id: { not: realId }
      }
    });

    for (const dup of duplicates) {
      console.log(`[${companyName}] [${realItem.barCode}] Merging duplicate ${dup.id} -> ${realId}`);

      const invItems = await tenantPrisma.inventoryItem.findMany({ where: { itemId: dup.id } });
      for (const inv of invItems) {
        const existing = await tenantPrisma.inventoryItem.findFirst({
          where: {
            itemId: realId,
            locationId: inv.locationId,
            warehouseId: inv.warehouseId,
            batchNumber: inv.batchNumber,
            status: inv.status
          }
        });

        if (existing) {
          await tenantPrisma.inventoryItem.update({
            where: { id: existing.id },
            data: {
              quantity: { increment: inv.quantity },
              available: { increment: inv.available },
              reserved: { increment: inv.reserved }
            }
          });
          await tenantPrisma.inventoryItem.delete({ where: { id: inv.id } });
        } else {
          await tenantPrisma.inventoryItem.update({
            where: { id: inv.id },
            data: { itemId: realId }
          });
        }
      }

      for (const { table_name, column_name } of tablesResult) {
        if (table_name === 'InventoryItem' || table_name === 'inventory_items') continue;
        
        await tenantPrisma.$executeRawUnsafe(`
          UPDATE "${table_name}"
          SET "${column_name}" = $1
          WHERE "${column_name}" = $2
        `, realId, dup.id);
      }

      try {
        await tenantPrisma.item.delete({ where: { id: dup.id } });
        console.log(`[${companyName}] [${realItem.barCode}] Successfully deleted duplicate ${dup.id}`);
      } catch (e: any) {
        console.error(`[${companyName}] [${realItem.barCode}] Could not delete ${dup.id}: ${e.message}`);
        await tenantPrisma.item.update({
          where: { id: dup.id },
          data: { barCode: 'DUP-' + dup.barCode, isActive: false, status: 'inactive' }
        });
      }
    }
  }
}

async function main() {
  console.log('🚀 Starting Multi-Tenant Item Duplicate Merge...');

  const managementUrl = process.env.DATABASE_URL_MANAGEMENT || process.env.DATABASE_URL;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;

  if (!managementUrl) {
    console.error('❌ Missing DATABASE_URL / DATABASE_URL_MANAGEMENT');
    return;
  }

  if (managementUrl && masterKey) {
    const pool = new Pool({ connectionString: managementUrl });
    const adapter = new PrismaPg(pool);
    const management = new ManagementClient({ adapter } as any);

    let companies: any[] = [];
    try {
      companies = await management.company.findMany({ where: { status: 'active' } });
    } catch (err: any) {
      console.warn(`ℹ️ Multi-tenant check skipped. Running in single-tenant mode.`);
    } finally {
      await management.$disconnect();
      await pool.end();
    }

    if (companies.length > 0) {
      console.log(`🏢 Found ${companies.length} tenant companies. Running merge for each...`);
      for (const company of companies) {
        let connectionString = company.dbUrl;
        if (company.dbPassword) {
          try {
            const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
            connectionString = \`postgresql://\${company.dbUser}:\${decPassword}@\${company.dbHost || 'localhost'}:\${company.dbPort || 5432}/\${company.dbName}?schema=public\`;
          } catch (e) {
            console.warn(\`  ⚠️ Decryption failed for \${company.name}\`);
          }
        }
        if (!connectionString) continue;

        const tenantPool = new Pool({ connectionString });
        const tenantAdapter = new PrismaPg(tenantPool);
        const tenantPrisma = new PrismaClient({ adapter: tenantAdapter } as any);
        try {
          await tenantPrisma.$connect();
          await runMergeForTenant(tenantPrisma, company.name);
        } catch (e) {
           console.error(\`❌ Failed to run for tenant \${company.name}: \`, e);
        } finally {
          await tenantPrisma.$disconnect();
          await tenantPool.end();
        }
      }
      return;
    }
  }

  // Fallback if not using management database approach
  console.log('🔗 Running on primary DATABASE_URL (single-tenant fallback)...');
  const pool = new Pool({ connectionString: managementUrl });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter } as any);
  try {
    await prisma.$connect();
    await runMergeForTenant(prisma, 'Primary');
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch(console.error);
