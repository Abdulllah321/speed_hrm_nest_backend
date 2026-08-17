import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const dbUrl = 'postgresql://speedlimit:speedlimit123@localhost:5433/tenant_speed_main_mox1gfsi?schema=public';
const pool = new Pool({ connectionString: dbUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter: adapter as any });

// Purchase Returns mapping based on your screenshot with Sales Tax Invoice Date
const returnData = [
  { purchaseInvoiceNo: 'PI-2026-0001', purchaseReturnNo: 'PR-2026-0001', supplierGst: '12-00-3907-004-64', saleTaxInvDate: '2026-07-07T00:00:00Z' },
  { purchaseInvoiceNo: 'PI-2026-0002', purchaseReturnNo: 'PR-2026-0002', supplierGst: '12-00-3907-004-64', saleTaxInvDate: '2026-07-07T00:00:00Z' },
  { purchaseInvoiceNo: 'PI-2026-0003', purchaseReturnNo: 'PR-2026-0003', supplierGst: '12-00-3907-004-64', saleTaxInvDate: '2026-07-07T00:00:00Z' },
  { purchaseInvoiceNo: 'PI-2026-0005', purchaseReturnNo: 'PR-2026-0007', supplierGst: '12-00-3907-004-64', saleTaxInvDate: '2026-07-07T00:00:00Z' },
  { purchaseInvoiceNo: 'PI-2026-0006', purchaseReturnNo: 'PR-2026-0008', supplierGst: '12-00-3907-004-64', saleTaxInvDate: '2026-07-07T00:00:00Z' },
  { purchaseInvoiceNo: 'PI-2026-0012', purchaseReturnNo: 'PR-2026-0004', supplierGst: '12-00-3907-004-64', saleTaxInvDate: '2026-07-27T00:00:00Z' },
  { purchaseInvoiceNo: 'PI-2026-0013', purchaseReturnNo: 'PR-2026-0005', supplierGst: '12-00-3907-004-64', saleTaxInvDate: '2026-07-27T00:00:00Z' },
  { purchaseInvoiceNo: 'PI-2026-0014', purchaseReturnNo: 'PR-2026-0006', supplierGst: '12-00-3907-004-64', saleTaxInvDate: '2026-07-27T00:00:00Z' },
  { purchaseInvoiceNo: 'PI-2026-0017', purchaseReturnNo: 'PR-2026-0009', supplierGst: '12-00-3907-004-64', saleTaxInvDate: '2026-08-03T00:00:00Z' },
  { purchaseInvoiceNo: 'PI-2026-0017', purchaseReturnNo: 'PR-2026-0011', supplierGst: '12-00-3907-004-64', saleTaxInvDate: '2026-08-03T00:00:00Z' },
  { purchaseInvoiceNo: 'PI-2026-0018', purchaseReturnNo: 'PR-2026-0010', supplierGst: '12-00-3907-004-64', saleTaxInvDate: '2026-08-03T00:00:00Z' },
  { purchaseInvoiceNo: 'PI-2026-0020', purchaseReturnNo: 'PR-2026-0012', supplierGst: '12-00-3907-004-64', saleTaxInvDate: '2026-08-05T00:00:00Z' },
  { purchaseInvoiceNo: 'PI-2026-0021', purchaseReturnNo: 'PR-2026-0013', supplierGst: '12-00-3907-004-64', saleTaxInvDate: '2026-08-05T00:00:00Z' },
];

async function main() {
  console.log('Starting Purchase Return update process (including Sale Tax Invoice Date / return_date)...');

  for (const item of returnData) {
    try {
      // Find the Purchase Invoice
      const invoice = await prisma.purchaseInvoice.findFirst({
        where: { invoiceNumber: item.purchaseInvoiceNo }
      });

      if (!invoice) {
        console.log(`⚠️ Purchase Invoice not found: ${item.purchaseInvoiceNo}`);
        continue;
      }

      // Find the Purchase Return
      const purchaseReturn = await prisma.purchaseReturn.findFirst({
        where: { returnNumber: item.purchaseReturnNo }
      });

      if (!purchaseReturn) {
        console.log(`⚠️ Purchase Return not found: ${item.purchaseReturnNo}`);
        continue;
      }

      // Update the Purchase Return
      const updated = await prisma.purchaseReturn.update({
        where: { id: purchaseReturn.id },
        data: {
          purchaseInvoiceId: invoice.id,
          supplierGstNumber: item.supplierGst,
          staxEInvoiceNumber: invoice.staxEInvoiceNumber || purchaseReturn.staxEInvoiceNumber,
          returnDate: new Date(item.saleTaxInvDate), // updates the Sale Tax Invoice Date (return_date)
        }
      });

      console.log(`✅ Updated ${item.purchaseReturnNo}: Linked to ${item.purchaseInvoiceNo}, Supplier GST = ${updated.supplierGstNumber}, STax = ${updated.staxEInvoiceNumber || 'N/A'}, Sale Tax Date = ${updated.returnDate.toISOString().split('T')[0]}`);

    } catch (error) {
      console.error(`❌ Error updating ${item.purchaseReturnNo}:`, error);
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
