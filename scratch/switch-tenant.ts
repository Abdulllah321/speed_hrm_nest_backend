import { PrismaClient } from '@prisma/management-client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL_MANAGEMENT || 'postgresql://speedlimit:speedlimit123@localhost:5433/speedlimit_management' });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

async function main() {
  try {
    const updated = await prisma.company.update({
      where: { code: 'speed' },
      data: {
        dbName: 'tenant_speed_mql1nil9',
        dbUrl: 'postgresql://speedlimit:speedlimit123@localhost:5433/tenant_speed_mql1nil9?schema=public',
        dbUser: 'speedlimit',
        dbPassword: null, // Clear dynamic encryption to use dbUrl directly
        dbPort: 5433,
        dbHost: 'localhost'
      }
    });
    console.log('Successfully switched tenant database to tenant_speed_mql1nil9!');
    console.log(JSON.stringify(updated, null, 2));
  } catch (error) {
    console.error('Error switching tenant database:', error);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main();
