const { Pool } = require('pg');
const crypto = require('crypto');

function decrypt(encryptedText, masterKeyString) {
  const masterKey = Buffer.from(masterKeyString.slice(0, 32), 'utf-8');
  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted text format');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];

  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf-8');
  decrypted += decipher.final('utf-8');

  return decrypted;
}

async function main() {
  const masterKeyString = 'savdbia8s98ydgiqwns98s0a9djsa98hsu_master_key_encryption';
  
  const pool = new Pool({
    connectionString: 'postgresql://speedlimit:speedlimit123@localhost:5433/speedlimit_management'
  });
  
  try {
    const companiesRes = await pool.query('SELECT * FROM "Company"');
    
    for (const comp of companiesRes.rows) {
      if (!comp.dbPassword) continue;
      
      const plainPassword = decrypt(comp.dbPassword, masterKeyString);
      const dbUrl = `postgresql://${comp.dbUser}:${plainPassword}@localhost:5433/${comp.dbName}?schema=public`;
      
      const tenantPool = new Pool({ connectionString: dbUrl });
      try {
        console.log(`\nQuerying Purchase Orders for ${comp.name}...`);
        const poRes = await tenantPool.query(
          'SELECT id, po_number, created_at, status, subtotal, total_amount FROM purchase_orders WHERE id = $1',
          ['de4d168d-567d-4436-bd96-a168563e9f2e']
        );
        console.log(`PO de4d168d:`, poRes.rows);

        const itemsRes = await tenantPool.query(
          'SELECT id, purchase_order_id, item_id, quantity, unit_price, line_total FROM purchase_order_items WHERE purchase_order_id = $1',
          ['de4d168d-567d-4436-bd96-a168563e9f2e']
        );
        console.log(`PO Items:`, itemsRes.rows);

        console.log("\nLatest 3 Purchase Orders:");
        const latestPoRes = await tenantPool.query(
          'SELECT id, po_number, created_at, status, subtotal FROM purchase_orders ORDER BY created_at DESC LIMIT 3'
        );
        console.log(latestPoRes.rows);
      } catch (err) {
        console.error(`Error querying company ${comp.name}:`, err.message);
      } finally {
        await tenantPool.end();
      }
    }
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await pool.end();
  }
}

main();
