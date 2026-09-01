import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:root@localhost:5432/spl_core_db?schema=public';
const pool = new Pool({ connectionString: dbUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

async function main() {
  try {
    const updated = await prisma.$executeRawUnsafe(
      `UPDATE "Company" SET "dbName" = 'tenant_speed_main_mox1gfsi', "dbUrl" = 'postgresql://postgres:root@localhost:5432/tenant_speed_main_mox1gfsi?schema=public', "dbPort" = 5432, "dbUser" = 'postgres'`
    );
    console.log('Successfully updated Company record to tenant_speed_main_mox1gfsi! Rows updated:', updated);

    const companies: any[] = await prisma.$queryRawUnsafe(`SELECT id, code, name, "dbName", "dbUrl" FROM "Company"`);
    console.log('Current Company Records:', JSON.stringify(companies, null, 2));
  } catch (error) {
    console.error('Error updating company:', error);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main();
