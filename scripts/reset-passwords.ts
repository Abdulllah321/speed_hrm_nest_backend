import 'dotenv/config';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';

async function main() {
  console.log('🚀 Starting password reset script...');
  
  const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
  if (!managementUrl) {
    console.error('❌ DATABASE_URL_MANAGEMENT environment variable is missing.');
    process.exit(1);
  }

  // Connect to Master Database
  const pool = new Pool({ connectionString: managementUrl });
  const adapter = new PrismaPg(pool);
  const management = new ManagementClient({ adapter } as any);

  try {
    await management.$connect();
    
    const newPassword = 'Password@123';
    console.log(`🔒 Hashing new password: "${newPassword}"...`);
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    console.log('🔄 Updating passwords for all users in the master database...');
    
    // Update all users in the management database
    const result = await management.user.updateMany({
      data: {
        password: hashedPassword,
        mustChangePassword: true, // Force them to change it on next login just in case
      },
    });

    console.log(`✅ Successfully updated passwords for ${result.count} employees/users!`);

  } catch (error) {
    console.error('❌ Error updating passwords:', error);
  } finally {
    await management.$disconnect();
    await pool.end();
    console.log('👋 Done.');
  }
}

main();
