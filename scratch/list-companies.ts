import { PrismaClient } from '@prisma/management-client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL_MANAGEMENT || 'postgresql://speedlimit:speedlimit123@localhost:5433/speedlimit_management' });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

async function main() {
  try {
    const companies = await prisma.company.findMany({
      include: {
        tenant: true,
      }
    });
    console.log('--- Companies in Master DB ---');
    console.log(JSON.stringify(companies, null, 2));
  } catch (error) {
    console.error('Error listing companies:', error);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main();
