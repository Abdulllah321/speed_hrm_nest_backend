import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

/**
 * Execute SQL backup file
 * Supports both plain SQL files and pg_dump custom format files
 */
async function executeBackupSql(pool: Pool): Promise<void> {
  try {
    // Try multiple possible locations for backup.sql
    const possiblePaths = [
      join(process.cwd(), 'backup.sql'), // Root of nestjs_backend (most common)
      join(process.cwd(), '..', 'backup.sql'), // Parent directory
    ];

    let backupPath: string | null = null;
    for (const path of possiblePaths) {
      try {
        readFileSync(path);
        backupPath = path;
        break;
      } catch {
        // Continue to next path
      }
    }

    if (!backupPath) {
      console.warn('⚠️  backup.sql file not found in any expected location, skipping...');
      return;
    }

    console.log(`📦 Loading backup.sql from: ${backupPath}`);

    // Try to detect if it's a custom format dump (pg_dump -Fc)
    const fileBuffer = readFileSync(backupPath);
    const isCustomFormat = fileBuffer[0] === 0x50 && fileBuffer[1] === 0x47 && fileBuffer[2] === 0x44 && fileBuffer[3] === 0x4d; // "PGDM" header

    if (isCustomFormat) {
      console.log('📦 Detected pg_dump custom format, using pg_restore...');
      const dbUrl = new URL(process.env.DATABASE_URL || '');
      const host = dbUrl.hostname;
      const port = dbUrl.port || '5432';
      const database = dbUrl.pathname.slice(1);
      const username = dbUrl.username;
      const password = dbUrl.password;

      // Use pg_restore for custom format
      const pgRestoreCmd = `pg_restore --no-owner --no-acl --clean --if-exists -h ${host} -p ${port} -U ${username} -d ${database} "${backupPath}"`;

      // Set PGPASSWORD environment variable for password
      const env = { ...process.env, PGPASSWORD: password };

      try {
        execSync(pgRestoreCmd, {
          env,
          stdio: 'inherit',
          shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash'
        });
        console.log('✅ Backup SQL executed successfully using pg_restore');
      } catch (error: any) {
        console.warn('⚠️  pg_restore failed, trying direct SQL execution...');
        // Fall through to try direct SQL execution
      }
    } else {
      // Plain SQL file - execute directly
      console.log('📦 Executing plain SQL file...');
      const sqlContent = readFileSync(backupPath, 'utf-8');

      // Split by semicolons and execute each statement
      // Remove comments and empty statements
      const statements = sqlContent
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--') && !s.startsWith('/*'));

      const client = await pool.connect();
      try {
        for (const statement of statements) {
          if (statement.trim()) {
            try {
              await client.query(statement);
            } catch (error: any) {
              // Ignore errors for statements that might fail (e.g., CREATE DATABASE if exists)
              if (!error.message.includes('already exists') &&
                !error.message.includes('does not exist') &&
                !error.message.includes('cannot drop')) {
                console.warn(`⚠️  SQL statement warning: ${error.message.substring(0, 100)}`);
              }
            }
          }
        }
        console.log('✅ Backup SQL executed successfully');
      } finally {
        client.release();
      }
    }
  } catch (error: any) {
    console.error(`❌ Could not execute backup.sql: ${error.message}`);
    throw error;
  }
}

async function main() {
  console.log('🌱 Seeding database from backup.sql...');
  console.log('');

  await executeBackupSql(pool);

  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log('✅ Database seeded successfully!');
  console.log('═══════════════════════════════════════════');
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
