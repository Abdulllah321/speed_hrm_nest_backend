import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);

  const count = await (prisma as any).posReturn.count();
  console.log('Total PosReturn count in default DB:', count);

  const salesOrderCount = await (prisma as any).salesOrder.count();
  console.log('Total SalesOrder count in default DB:', salesOrderCount);

  await app.close();
}
bootstrap();
