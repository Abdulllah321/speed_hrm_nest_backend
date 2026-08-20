import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env') });
import { Pool } from 'pg';

async function inspectUploadErrors() {
  const masterUrl = process.env.DATABASE_URL!;
  const urlObj = new URL(masterUrl);
  const user = urlObj.username;
  const password = urlObj.password;
  const host = urlObj.hostname;
  const port = urlObj.port || '5432';

  const dbName = 'tenant_speed_main_mox1gfsi';
  const connStr = `postgresql://${user}:${password}@${host}:${port}/${dbName}?schema=public`;
  const pool = new Pool({ connectionString: connStr });

  try {
    const res = await pool.query(`
      SELECT 
        id, 
        filename, 
        status, 
        "totalRecords", 
        "processedRecords", 
        "successRecords", 
        "failedRecords", 
        message, 
        errors,
        "createdAt"
      FROM "BulkUpload"
      ORDER BY "createdAt" DESC
      LIMIT 5;
    `);

    console.log(`Found ${res.rows.length} bulk upload jobs in DB.`);
    for (const row of res.rows) {
      console.log(`\n=======================================================`);
      console.log(`Job ID: ${row.id} | File: ${row.filename} | Status: ${row.status}`);
      console.log(`Total: ${row.totalRecords} | Success: ${row.successRecords} | Failed: ${row.failedRecords}`);
      console.log(`Message: ${row.message}`);
      if (row.errors && Array.isArray(row.errors) && row.errors.length > 0) {
        console.log(`Sample Errors (Top 10):`);
        console.table(row.errors.slice(0, 10));
      }
    }
  } catch (e: any) {
    console.log(`Error inspecting BulkUpload:`, e.message);
  } finally {
    await pool.end();
  }
}

inspectUploadErrors();
