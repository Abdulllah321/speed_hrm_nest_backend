import 'dotenv/config';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as crypto from 'crypto';

/**
 * LOCATION CENTER ID SEEDING SCRIPT (LATEST LIST)
 * ───────────────────────────────────────────────
 * Adds and updates the `center_id` for all locations in the latest reference list:
 *
 * center_id | Name                                    | Status   | Channels
 * 107       | Nike Centaurus Mall                     | Active   | SPL
 * 101       | Nike Dolmen City Mall                   | Active   | SPL
 * 106       | Nike Packages Mall                      | Active   | SPL
 * 108       | Nike Safa Gold Mall                     | Active   | SPL
 * 206       | Nike Speed Sports Dolmen Mall Lahore    | Active   | SPL
 * 104       | Nike Xinhua Mall                        | Active   | SPL
 * 210       | Speed Sports Dolman Mall Clifton        | Active   | SPL
 * 204       | Speed Sports Emporium Mall              | Active   | SPL
 * 205       | Speed Sports Fountain Avenue            | Active   | SPL
 * 203       | Speed Sports Lucky One Mall             | Active   | SPL
 * 208       | Speed Sports Lyallpur Galleria          | Active   | SPL
 * 207       | Speed Sports Mall of Multan             | Active   | SPL
 * 209       | Speed Sports Safa Gold Mall             | Active   | SPL
 * 201       | Speed Sports The Forum                  | Active   | SPL
 * 33        | SPEEDSPORTS ONLINE                      | Active   | SPL
 * 211       | SpeedSports Trade Centre                | Active   | SPL
 * 102       | Nike Ocean Mall                         | Inactive | SPL
 * 109       | Nike World Trade Centre                 | Inactive | SPL
 * 206       | Speed Sports Boulevard Mall Hyderabad   | Inactive | SPL
 * 401       | Pedro DMC                               | Active   | pedroPedroShoes
 * 405       | Pedro Dolmen Mall Lahore                | Active   | pedroPedroShoes
 * 404       | Pedro Online                            | Active   | pedroPedroShoes
 * 403       | Pedro Packages Mall                     | Active   | pedroPedroShoes
 *
 * Usage:
 *   bun scripts/seed-location-center-ids.ts
 *   bun scripts/seed-location-center-ids.ts --tenant <tenant_db_name>
 */

interface CenterIdMapping {
  centerId: string;
  name: string;
  code?: string;
  shortCode?: string;
  status?: string;
  alternateNames?: string[];
}

const CENTER_ID_MAPPINGS: CenterIdMapping[] = [
  {
    centerId: '107',
    name: 'Nike Centaurus Mall',
    code: 'N10004',
    shortCode: 'NCM',
    status: 'active',
    alternateNames: ['NIKE-CENTAURUS MALL', 'NIKE CENTAURUS MALL', 'CENTAURUS MALL'],
  },
  {
    centerId: '101',
    name: 'Nike Dolmen City Mall',
    code: 'N10001',
    shortCode: 'NDC',
    status: 'active',
    alternateNames: ['NIKE-DOLMEN CLIFTON', 'NIKE DOLMEN CITY MALL', 'NIKE DOLMEN CLIFTON', 'DOLMEN CLIFTON'],
  },
  {
    centerId: '106',
    name: 'Nike Packages Mall',
    code: 'N10003',
    shortCode: 'NPM',
    status: 'active',
    alternateNames: ['NIKE-PACKAGES MALL', 'NIKE PACKAGES MALL', 'PACKAGES MALL'],
  },
  {
    centerId: '108',
    name: 'Nike Safa Gold Mall',
    code: 'N10005',
    shortCode: 'NSGM',
    status: 'active',
    alternateNames: ['NIKE-SAFA GOLD MALL', 'NIKE SAFA GOLD MALL', 'SAFA GOLD MALL'],
  },
  {
    centerId: '206',
    name: 'Nike Speed Sports Dolmen Mall Lahore',
    code: 'SS1006',
    shortCode: 'SS-DML',
    status: 'active',
    alternateNames: ['SPEED SPORTS-DOLMEN LAHORE', 'NIKE SPEED SPORTS DOLMEN MALL LAHORE', 'DOLMEN LAHORE'],
  },
  {
    centerId: '104',
    name: 'Nike Xinhua Mall',
    code: 'N10002',
    shortCode: 'NXM',
    status: 'active',
    alternateNames: ['NIKE-XINHUA MALL', 'NIKE XINHUA MALL', 'XINHUA MALL'],
  },
  {
    centerId: '210',
    name: 'Speed Sports Dolman Mall Clifton',
    code: 'SS1002',
    shortCode: 'SS-DMC',
    status: 'active',
    alternateNames: ['SPEED SPORTS-DOLMEN CLIFTON', 'SPEED SPORTS DOLMAN MALL CLIFTON', 'DOLMEN CLIFTON'],
  },
  {
    centerId: '204',
    name: 'Speed Sports Emporium Mall',
    code: 'SS1005',
    shortCode: 'SS-EM',
    status: 'active',
    alternateNames: ['SPEED SPORTS-EMPORIUM MALL', 'SPEED SPORTS EMPORIUM MALL', 'EMPORIUM MALL'],
  },
  {
    centerId: '205',
    name: 'Speed Sports Fountain Avenue',
    code: 'SS1004',
    shortCode: 'SS-FA',
    status: 'active',
    alternateNames: ['SPEED SPORTS-FOUNTAIN AVENUE', 'SPEED SPORTS FOUNTAIN AVENUE', 'FOUNTAIN AVENUE'],
  },
  {
    centerId: '203',
    name: 'Speed Sports Lucky One Mall',
    code: 'SS1001',
    shortCode: 'SS-LM',
    status: 'active',
    alternateNames: ['SPEED SPORTS-LUCKY ONE MALL', 'SPEED SPORTS LUCKY ONE MALL', 'LUCKY ONE MALL'],
  },
  {
    centerId: '208',
    name: 'Speed Sports Lyallpur Galleria',
    code: 'SS1010',
    shortCode: 'SS-LG',
    status: 'active',
    alternateNames: ['SPEED SPORTS-LYALLPUR GALLERIA', 'SPEED SPORTS LYALLPUR GALLERIA', 'LYALLPUR GALLERIA'],
  },
  {
    centerId: '207',
    name: 'Speed Sports Mall of Multan',
    code: 'SS1009',
    shortCode: 'SS-MM',
    status: 'active',
    alternateNames: ['SPEED SPORTS-MALL OF MULTAN', 'SPEED SPORTS MALL OF MULTAN', 'MALL OF MULTAN'],
  },
  {
    centerId: '209',
    name: 'Speed Sports Safa Gold Mall',
    code: 'SS1007',
    shortCode: 'SS SGM',
    status: 'active',
    alternateNames: ['SPEED SPORTS-SAFA GOLD MALL', 'SPEED SPORTS SAFA GOLD MALL', 'SAFA GOLD MALL'],
  },
  {
    centerId: '201',
    name: 'Speed Sports The Forum',
    code: 'SS1012',
    shortCode: 'SS-TF',
    status: 'active',
    alternateNames: ['SPEED SPORTS-THE FORUM', 'SPEED SPORTS THE FORUM', 'THE FORUM'],
  },
  {
    centerId: '33',
    name: 'SPEEDSPORTS ONLINE',
    code: 'SS1011',
    shortCode: 'SS-ONLINE',
    status: 'active',
    alternateNames: ['SPEED SPORTS-ONLINE', 'SPEEDSPORTS ONLINE', 'ONLINE'],
  },
  {
    centerId: '211',
    name: 'SpeedSports Trade Centre',
    code: 'SS1008',
    shortCode: 'SS WTC',
    status: 'active',
    alternateNames: ['SPEED SPORTS-GIGA MALL', 'SPEEDSPORTS TRADE CENTRE', 'SPEED SPORTS TRADE CENTRE', 'GIGA MALL', 'TRADE CENTRE'],
  },
  {
    centerId: '102',
    name: 'Nike Ocean Mall',
    code: 'N10006',
    shortCode: 'NOM',
    status: 'inactive',
    alternateNames: ['NIKE-OCEAN MALL', 'NIKE OCEAN MALL', 'OCEAN MALL'],
  },
  {
    centerId: '109',
    name: 'Nike World Trade Centre',
    code: 'N10007',
    shortCode: 'N-WTC',
    status: 'inactive',
    alternateNames: ['NIKE-WORLD TRADE CENTRE', 'NIKE WORLD TRADE CENTRE', 'NIKE-WTC', 'NIKE WTC', 'NIKE GIGA MALL'],
  },
  {
    centerId: '206',
    name: 'Speed Sports Boulevard Mall Hyderabad',
    code: 'SS1013',
    shortCode: 'SS-BMH',
    status: 'inactive',
    alternateNames: ['SPEED SPORTS-BOULEVARD MALL HYDERABAD', 'SPEED SPORTS BOULEVARD MALL', 'BOULEVARD MALL HYDERABAD', 'BOULEVARD MALL'],
  },
  {
    centerId: '401',
    name: 'Pedro DMC',
    code: 'P10001',
    shortCode: 'P DMC',
    status: 'active',
    alternateNames: ['PEDRO-DOLMEN CLIFTON', 'PEDRO DMC', 'PEDRO DOLMEN CLIFTON', 'DOLMEN CLIFTON'],
  },
  {
    centerId: '405',
    name: 'Pedro Dolmen Mall Lahore',
    code: 'P10003',
    shortCode: 'P DML',
    status: 'active',
    alternateNames: ['PEDRO-DOLMEN LAHORE', 'PEDRO DOLMEN MALL LAHORE', 'PEDRO DML', 'DOLMEN LAHORE'],
  },
  {
    centerId: '404',
    name: 'Pedro Online',
    code: 'P10004',
    shortCode: 'P ONLINE',
    status: 'active',
    alternateNames: ['PEDRO-ONLINE', 'PEDRO ONLINE'],
  },
  {
    centerId: '403',
    name: 'Pedro Packages Mall',
    code: 'P10002',
    shortCode: 'P PM',
    status: 'active',
    alternateNames: ['PEDRO-PACKAGES MALL', 'PEDRO PACKAGES MALL', 'PEDRO PM', 'PACKAGES MALL'],
  },
];

function decrypt(encryptedText: string, masterKeyString: string): string {
  const masterKey = Buffer.from(masterKeyString.slice(0, 32), 'utf-8');
  const parts = encryptedText.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted text format');
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(parts[2], 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

async function updateTenantCenterIds(pool: Pool, dbName: string) {
  console.log(`\n======================================================`);
  console.log(`📌 Updating Location center_id for DB [${dbName}]`);
  console.log(`======================================================\n`);

  // 1. Ensure column exists and handle unique vs regular index on Location and Warehouse
  try {
    await pool.query(`
      ALTER TABLE "Location" 
      ADD COLUMN IF NOT EXISTS "center_id" TEXT;
    `);
    // Drop unique index to allow duplicate center_ids for inactive / channel locations
    await pool.query(`
      DROP INDEX IF EXISTS "Location_center_id_key";
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS "Location_center_id_idx" ON "Location"("center_id");
    `);

    // Ensure center_id column on Warehouse table
    await pool.query(`
      ALTER TABLE "Warehouse" 
      ADD COLUMN IF NOT EXISTS "center_id" TEXT;
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS "Warehouse_center_id_idx" ON "Warehouse"("center_id");
    `);
  } catch (err: any) {
    console.warn(`  ⚠️  Note on DDL check: ${err.message}`);
  }

  // 1b. Update Warehouse center_id
  const { rows: warehouses } = await pool.query<{
    id: string;
    name: string;
    code: string;
    center_id: string | null;
  }>(`
    SELECT id, name, code, center_id
    FROM "Warehouse"
    WHERE "isDeleted" = false
    ORDER BY name ASC;
  `);

  const warehouseAudit: Array<{
    centerId: string;
    requestedName: string;
    matchedWarehouse: string;
    warehouseCode: string;
    action: string;
  }> = [];

  let matchedWh = warehouses.find(
    (w) =>
      w.name.toUpperCase().includes('WAREHOUSE') ||
      w.code.toUpperCase() === 'WH' ||
      w.code.toUpperCase() === 'C40001' ||
      w.name.toUpperCase().includes('LOGISTIC'),
  );

  if (!matchedWh && warehouses.length > 0) {
    matchedWh = warehouses[0];
  }

  if (matchedWh) {
    await pool.query(
      `UPDATE "Warehouse" SET "center_id" = $1, "updatedAt" = NOW() WHERE id = $2;`,
      ['9', matchedWh.id],
    );
    warehouseAudit.push({
      centerId: '9',
      requestedName: 'WAREHOUSE',
      matchedWarehouse: matchedWh.name,
      warehouseCode: matchedWh.code,
      action: '✅ Updated',
    });
  } else {
    // If no warehouse exists, create one with center_id = 9
    const insertWh = await pool.query<{ id: string }>(
      `INSERT INTO "Warehouse" (
        id, name, code, center_id, "isActive", "isDeleted", "createdAt", "updatedAt"
      ) VALUES (
        gen_random_uuid(), 'WAREHOUSE', 'WH-01', '9', true, false, NOW(), NOW()
      ) RETURNING id;`,
    );
    warehouseAudit.push({
      centerId: '9',
      requestedName: 'WAREHOUSE',
      matchedWarehouse: 'WAREHOUSE',
      warehouseCode: 'WH-01',
      action: '🆕 Created & Mapped',
    });
  }

  console.log(`🏢 Warehouse Center ID Mapping:`);
  console.table(warehouseAudit);

  // 2. Fetch all existing locations (including deleted/inactive)
  const { rows: locations } = await pool.query<{
    id: string;
    name: string;
    code: string;
    short_code: string | null;
    status: string;
    center_id: string | null;
    isDeleted: boolean;
  }>(`
    SELECT id, name, code, short_code, status, center_id, "isDeleted"
    FROM "Location"
    ORDER BY name ASC;
  `);

  let updatedCount = 0;
  let createdCount = 0;
  const auditReport: Array<{
    centerId: string;
    requestedName: string;
    matchedLocation: string;
    locationCode: string;
    status: string;
    action: string;
  }> = [];

  for (const mapping of CENTER_ID_MAPPINGS) {
    // Attempt match by code first
    let matched = locations.find((l) => mapping.code && l.code.toUpperCase() === mapping.code.toUpperCase());

    // Next attempt match by short_code
    if (!matched && mapping.shortCode) {
      matched = locations.find(
        (l) => l.short_code && l.short_code.toUpperCase() === mapping.shortCode?.toUpperCase(),
      );
    }

    // Next attempt match by name candidates
    if (!matched) {
      const matchCandidates = [mapping.name, ...(mapping.alternateNames || [])].map((n) =>
        n.replace(/[^a-zA-Z0-9]/g, '').toUpperCase(),
      );
      matched = locations.find((l) => {
        const cleanDbName = l.name.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
        return matchCandidates.includes(cleanDbName);
      });
    }

    if (matched) {
      const targetStatus = mapping.status || matched.status || 'active';
      await pool.query(
        `UPDATE "Location" SET "center_id" = $1, "status" = $2, "updatedAt" = NOW() WHERE id = $3;`,
        [mapping.centerId, targetStatus, matched.id],
      );
      auditReport.push({
        centerId: mapping.centerId,
        requestedName: mapping.name,
        matchedLocation: matched.name,
        locationCode: matched.code,
        status: targetStatus,
        action: '✅ Updated',
      });
      updatedCount++;
    } else {
      // Create inactive/missing location if it doesn't exist
      const newLocName = mapping.alternateNames?.[0] || mapping.name.toUpperCase();
      const newCode = mapping.code || `LOC-${mapping.centerId}`;
      const newStatus = mapping.status || 'inactive';
      
      const insertRes = await pool.query<{ id: string }>(
        `INSERT INTO "Location" (
          id, name, code, short_code, center_id, status, "isDeleted", "createdAt", "updatedAt"
        ) VALUES (
          gen_random_uuid(), $1, $2, $3, $4, $5, false, NOW(), NOW()
        ) RETURNING id;`,
        [newLocName, newCode, mapping.shortCode || null, mapping.centerId, newStatus],
      );

      auditReport.push({
        centerId: mapping.centerId,
        requestedName: mapping.name,
        matchedLocation: newLocName,
        locationCode: newCode,
        status: newStatus,
        action: '🆕 Created & Mapped',
      });
      createdCount++;
    }
  }

  console.table(auditReport);
  console.log(`\n🎉 DB [${dbName}]: ${updatedCount} updated, ${createdCount} created, Total ${updatedCount + createdCount}/${CENTER_ID_MAPPINGS.length} mapped.`);
}

async function main() {
  console.log('🚀 Starting Location Center ID Seeding (Latest List)...');

  const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;

  if (!managementUrl || !masterKey) {
    console.error('❌ DATABASE_URL_MANAGEMENT and MASTER_ENCRYPTION_KEY required in .env');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: managementUrl });
  const adapter = new PrismaPg(pool);
  const management = new ManagementClient({ adapter } as any);

  try {
    const tenantArgIdx = process.argv.indexOf('--tenant');
    const specificTenant = tenantArgIdx !== -1 ? process.argv[tenantArgIdx + 1] : null;

    const companies = await management.company.findMany({
      where: {
        status: 'active',
        ...(specificTenant ? { dbName: specificTenant } : {}),
      },
    });

    if (companies.length === 0) {
      console.log('ℹ️ No active companies found.');
      return;
    }

    for (const company of companies) {
      console.log(`\n🏢 Processing Company: ${company.name} (${company.code}) | DB: ${company.dbName}`);
      let connectionString = company.dbUrl;
      if (company.dbPassword) {
        try {
          const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
          connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5433}/${company.dbName}?schema=public`;
        } catch {
          console.warn(`  ⚠️ Decryption failed, falling back to stored dbUrl`);
        }
      }

      if (!connectionString) {
        console.error(`  ❌ No connection details for ${company.code}`);
        continue;
      }

      const tenantPool = new Pool({ connectionString });
      try {
        await updateTenantCenterIds(tenantPool, company.dbName || company.code);
      } catch (err: any) {
        console.error(`  ❌ Error updating tenant DB ${company.dbName}: ${err.message}`);
      } finally {
        await tenantPool.end();
      }
    }

    console.log('\n✨ All tenants processed successfully.');
  } finally {
    await management.$disconnect();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
