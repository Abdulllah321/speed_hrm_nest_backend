import * as dotenv from 'dotenv';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { StockValuationExportService } from './src/warehouse/stock-ledger/stock-valuation-export.service';

dotenv.config({ path: path.join(__dirname, '.env') });

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const service = app.get(StockValuationExportService);
  
  console.log('Fetching stock valuation report preview for 2026-07-01 to now...');
  const res = await service.generatePreview({
    startDate: new Date('2026-07-01T00:00:00Z'),
    endDate: new Date(),
    summaryOnly: false,
    showBrand: true,
    showDivision: true,
    showCategory: true,
    showGender: true,
    showSilhouette: true,
    showArticle: true,
    showVariant: true,
  });
  
  console.log('Grand Totals:', res.grandTotals);
  console.log('Result items length:', res.result.length);
  
  await app.close();
}

main().catch(console.error);
