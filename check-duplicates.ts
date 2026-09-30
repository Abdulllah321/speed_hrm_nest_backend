import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

async function main() {
  const dbUrl = 'postgresql://postgres:root@localhost:5432/tenant_speed_main_mox1gfsi?schema=public';
  const pool = new Pool({ connectionString: dbUrl });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter: adapter as any });
  await prisma.$connect();

  const dupes = await prisma.$queryRaw`
    SELECT "barCode", COUNT(*) as c
    FROM "Item"
    WHERE "barCode" IS NOT NULL AND "barCode" != ''
    GROUP BY "barCode"
    HAVING COUNT(*) > 1
  `;

  console.log('Total duplicated barcodes:', (dupes as any[]).length);

  const stnItems = await prisma.$queryRaw`
    SELECT id, "barCode", description 
    FROM "Item" 
    WHERE "description" LIKE 'STN Item%'
  `;
  
  console.log('Total STN items:', (stnItems as any[]).length);

  const stnToDelete = await prisma.$queryRaw`
    SELECT i1.id, i1."barCode", i1.description
    FROM "Item" i1
    WHERE i1.description LIKE 'STN Item %'
      AND EXISTS (
        SELECT 1 FROM "Item" i2 
        WHERE i2."barCode" = i1."barCode" 
          AND (i2.description NOT LIKE 'STN Item %' OR i2.id != i1.id)
      )
  `;

  console.log('STN items that are duplicates and can be deleted:', (stnToDelete as any[]).length);

  await prisma.$disconnect();
  await pool.end();
}

main().catch(console.error);
