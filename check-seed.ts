// Simple script to check if database is seeded
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

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

