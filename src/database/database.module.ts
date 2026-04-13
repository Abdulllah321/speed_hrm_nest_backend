import {
  Global,
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { PrismaMasterService } from './prisma-master.service';
import { PrismaService } from './prisma.service';
import { TenantDatabaseService } from './tenant-database.service';
import { TenantMiddleware } from './tenant.middleware';
import { EncryptionService } from '../common/utils/encryption.service';

@Global()
@Module({
  providers: [
    PrismaMasterService,
    PrismaService,
    TenantDatabaseService,
    TenantMiddleware,
    EncryptionService,
  ],
  exports: [
    PrismaMasterService,
    PrismaService,
    TenantDatabaseService,
    TenantMiddleware,
    EncryptionService,
  ],
})
export class DatabaseModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(TenantMiddleware)
      .exclude(
        { path: '/api/auth/login', method: RequestMethod.POST },
        { path: '/api/auth/register', method: RequestMethod.POST },
        { path: '/api/auth/forgot-password', method: RequestMethod.POST },
        { path: '/api/auth/reset-password', method: RequestMethod.POST },
        { path: '/api/auth/refresh', method: RequestMethod.POST },
        // super-admin endpoints that manage tenants
        { path: '/api/admin/companies', method: RequestMethod.ALL },
        { path: '/api/admin/companies/(.*)', method: RequestMethod.ALL },
        { path: '/api/users', method: RequestMethod.ALL },
        { path: '/api/users/(.*)', method: RequestMethod.ALL },
      )
      .forRoutes('*');
  }
}
