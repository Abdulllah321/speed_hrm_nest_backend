import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const dbUrl = 'postgresql://speedlimit:speedlimit123@localhost:5433/tenant_speed_main_mox1gfsi?schema=public';
const pool = new Pool({ connectionString: dbUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter: adapter as any });

// Invoices data based on your screenshot
const invoicesData = [
  { invoiceNumber: 'PI-2026-0001', staxEInvoiceNumber: '4' },
  { invoiceNumber: 'PI-2026-0002', staxEInvoiceNumber: '5' },
  { invoiceNumber: 'PI-2026-0003', staxEInvoiceNumber: '10' },
  { invoiceNumber: 'PI-2026-0004', staxEInvoiceNumber: '1' },
  { invoiceNumber: 'PI-2026-0005', staxEInvoiceNumber: '6' },
  { invoiceNumber: 'PI-2026-0006', staxEInvoiceNumber: '7' },
  { invoiceNumber: 'PI-2026-0007', staxEInvoiceNumber: '2' },
  { invoiceNumber: 'PI-2026-0008', staxEInvoiceNumber: '3' },
  { invoiceNumber: 'PI-2026-0009', staxEInvoiceNumber: '9' },
  { invoiceNumber: 'PI-2026-0010', staxEInvoiceNumber: '15' },
  { invoiceNumber: 'PI-2026-0011', staxEInvoiceNumber: '8' },
  { invoiceNumber: 'PI-2026-0012', staxEInvoiceNumber: '19' },
  { invoiceNumber: 'PI-2026-0013', staxEInvoiceNumber: '20' },
  { invoiceNumber: 'PI-2026-0014', staxEInvoiceNumber: '21' },
  { invoiceNumber: 'PI-2026-0015', staxEInvoiceNumber: '28' },
  { invoiceNumber: 'PI-2026-0016', staxEInvoiceNumber: '29' },
  { invoiceNumber: 'PI-2026-0017', staxEInvoiceNumber: '30' },
  { invoiceNumber: 'PI-2026-0018', staxEInvoiceNumber: '31' },
  { invoiceNumber: 'PI-2026-0019', staxEInvoiceNumber: '48' },
  { invoiceNumber: 'PI-2026-0020', staxEInvoiceNumber: '47' },
  { invoiceNumber: 'PI-2026-0021', staxEInvoiceNumber: '46' },
];

async function main() {
  console.log('Starting STax e-Invoice Number update process...');
  
  for (const item of invoicesData) {
    try {
      // Find the invoice first
      const invoice = await prisma.purchaseInvoice.findFirst({
        where: { invoiceNumber: item.invoiceNumber }
      });

      if (invoice) {
        // Update the invoice
        const updated = await prisma.purchaseInvoice.update({
          where: { id: invoice.id },
          data: { staxEInvoiceNumber: item.staxEInvoiceNumber }
        });
        console.log(`✅ Updated ${item.invoiceNumber}: staxEInvoiceNumber = ${updated.staxEInvoiceNumber}`);
      } else {
        console.log(`⚠️ Invoice not found: ${item.invoiceNumber}`);
      }
    } catch (error) {
      console.error(`❌ Error updating ${item.invoiceNumber}:`, error);
    }
  }

  console.log('Update process completed.');
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
