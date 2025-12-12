import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import fastifyMultipart from '@fastify/multipart';
import 'dotenv/config'

async function bootstrap() {
  // Create Fastify adapter first
  const adapter = new FastifyAdapter();
  
  // Register multipart plugin on the adapter BEFORE creating the app
  await adapter.register(fastifyMultipart as any, {
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB limit
    },
  });
  
  // Now create the NestJS application with the configured adapter
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter);
  
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
