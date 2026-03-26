import { Module } from '@nestjs/common';
import { IntegrationController } from './integration.controller';
import { IntegrationService } from './integration.service';
import { DatabaseModule } from '../database/database.module';
import { CompanyModule } from '../admin/company/company.module';

/**
 * Module for DriveSafe integration features.
 * Provides server-to-server APIs for tenant and user provisioning.
 */
@Module({
  imports: [DatabaseModule, CompanyModule],
  controllers: [IntegrationController],
  providers: [IntegrationService],
  exports: [IntegrationService],
})
export class IntegrationModule {}
