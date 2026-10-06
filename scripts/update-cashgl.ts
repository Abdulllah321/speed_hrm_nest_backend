import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as fs from 'fs';
import * as path from 'path';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter: adapter as any });

async function main() {
  const jsonPath = path.join(__dirname, '..', 'data', 'location-cashgl.json');
  const fileContent = fs.readFileSync(jsonPath, 'utf-8');
  const data = JSON.parse(fileContent);

  console.log(`Loaded ${data.length} records from location-cashgl.json`);

  let updatedCount = 0;
  let notFoundCount = 0;

  for (const item of data) {
    // The JSON uses "tagId" as the location code and "GL Code" for the cash GL code
    const locationCode = item['tagId'] ? item['tagId'].trim() : null;
    const glCode = item['GL Code'] ? item['GL Code'].trim() : null;

    if (!locationCode || !glCode) {
      console.log(`Skipping entry with missing code or GL Code: ${JSON.stringify(item)}`);
      continue;
    }

    try {
      await prisma.location.update({
        where: { code: locationCode },
        data: { cashGLCode: glCode },
      });
      console.log(`✅ Updated location [${locationCode}] with GL Code: ${glCode}`);
      updatedCount++;
    } catch (error: any) {
      // Prisma error code P2025 means record not found
      if (error.code === 'P2025') {
        console.log(`⚠️ Location with code [${locationCode}] not found in database.`);
        notFoundCount++;
      } else {
        console.error(`❌ Error updating location [${locationCode}]:`, error);
      }
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`Successfully updated: ${updatedCount}`);
  console.log(`Locations not found: ${notFoundCount}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
