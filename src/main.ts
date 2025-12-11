import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import 'dotenv/config'

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
  
  // Register multipart plugin for file uploads
  await app.register(import('fastify-multipart') as any, {
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB limit
    },
  });
  
  const origins = (process.env.FRONTEND_URL || '').split(',').map(s => s.trim()).filter(Boolean);
  app.enableCors({
    origin: origins.length ? origins : true,
    credentials: true,
    methods: ['GET','HEAD','PUT','PATCH','POST','DELETE'],
    allowedHeaders: ['Content-Type','Authorization','X-Refresh-Token','X-New-Access-Token','X-New-Refresh-Token']
  });
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
