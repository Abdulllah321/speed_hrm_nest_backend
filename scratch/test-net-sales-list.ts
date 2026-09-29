import { PrismaService } from '../src/prisma/prisma.service';
import { NetSalesListExportService } from '../src/pos-sales/net-sales-list-export.service';

async function testService() {
  console.log('--- Testing NetSalesListExportService ---');

  const prisma = new PrismaService({
    tenantId: 'speed',
    tenantDbUrl: 'postgresql://postgres:root@localhost:5432/tenant_speed_main_mox1gfsi',
  } as any);

  // Fake master service
  const fakeMaster: any = {
    user: {
      findMany: async () => [],
    },
  };

  const fakeQueue: any = {};
  const fakeUpload: any = {};
  const fakeExportHist: any = {};
  const fakeCleanup: any = {};

  const service = new NetSalesListExportService(
    fakeQueue,
    prisma,
    fakeMaster,
    fakeUpload,
    fakeExportHist,
    fakeCleanup,
  );

  const result = await service.generateNetSalesListReportDataInternal(prisma, {
    startDate: '2026-09-25',
    endDate: '2026-09-28',
    docTypeFilter: 'ALL',
    onProgress: (p, msg) => console.log(`[${p}%] ${msg}`),
  });

  console.log('\n--- Result Summary ---');
  console.log('Total Documents:', result.documents.length);
  console.log('Total Sales Orders:', result.grandTotals.salesOrderCount);
  console.log('Total Returns:', result.grandTotals.returnCount);
  console.log('Net Items:', result.grandTotals.netItems);
  console.log('Gross Sales:', result.grandTotals.grossSalesAmount);
  console.log('Gross Returns:', result.grandTotals.grossReturnAmount);
  console.log('Net Gross:', result.grandTotals.netGrossAmount);
  console.log('Net Sales Revenue:', result.grandTotals.totalNetAmount);
  console.log('Net Cash:', result.grandTotals.netCash);
  console.log('Net Card:', result.grandTotals.netCard);
  console.log('Exchange Vouchers (Redeemed vs Issued):', result.grandTotals.exchangeVoucherRedeemed, 'vs', result.grandTotals.exchangeVoucherIssued);

  await prisma.$disconnect();
}

testService().catch(console.error);
