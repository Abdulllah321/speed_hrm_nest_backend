// Simple script to check if database is seeded
import { PrismaClient } from '@prisma/management-client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL_MANAGEMENT });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

async function checkSeeded() {
  try {
    const adminUser = await prisma.user.findUnique({
      where: { email: 'admin@speedlimit.com' }
    });
    process.exit(adminUser ? 0 : 1);
  } catch (error) {
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

checkSeeded();

