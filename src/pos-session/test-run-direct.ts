import * as dotenv from 'dotenv';
dotenv.config();

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PosSessionService } from './pos-session.service';
import { PrismaService } from '../database/prisma.service';

async function run() {
  console.log('Bootstrapping NestJS application context...');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  
  const posSessionService = app.get(PosSessionService);
  const prismaService = app.get(PrismaService);
  
  // Set the tenant context manually
  // We know the tenant DB name from our PG script: tenant_speed_mnfqeqgw
  const context = {
    tenantId: 'some-tenant-id', // can be anything
    companyId: 'some-company-id',
    dbUrl: 'postgresql://speedlimit:speedlimit123@localhost:5433/tenant_speed_mnfqeqgw'
  };
  
  console.log('Running generateReconciliationVoucher inside tenant context...');
  await PrismaService.asyncLocalStorage.run(context, async () => {
    try {
      await (posSessionService as any).generateReconciliationVoucher(
        '884b47af-fd3d-4f3e-90c0-e7251a644f77',
        'c5ae47d8-536c-4a8b-82df-5bbe4965e128'
      );
      console.log('Successfully completed generateReconciliationVoucher.');
    } catch (err) {
      console.error('Error during generateReconciliationVoucher:', err);
    }
  });
  
  await app.close();
}

run().catch(e => console.error(e));
