import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import fastifyMultipart from '@fastify/multipart';
import fastifyCookie from '@fastify/cookie';
import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import 'dotenv/config'

async function bootstrap() {
  // Create Fastify adapter first
  const adapter = new FastifyAdapter();

  // Register cookie plugin for cookie support
  await adapter.register(fastifyCookie as any, {
    secret: process.env.COOKIE_SECRET || 'your-secret-key-change-in-production',
  });

  // Register multipart plugin on the adapter BEFORE creating the app
  await adapter.register(fastifyMultipart as any, {
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB limit
    },
  });

  // Now create the NestJS application with the configured adapter
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter);

  // Global exception filter for user-friendly error responses
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Global validation pipe for DTO validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Strip properties that don't have decorators
      forbidNonWhitelisted: true, // Throw error if non-whitelisted properties are present
      transform: true, // Automatically transform payloads to DTO instances
      transformOptions: {
        enableImplicitConversion: true, // Enable implicit type conversion
      },
      exceptionFactory: (errors) => {
        // Custom error formatting for validation errors
        const formattedErrors = errors.map((error) => {
          const constraints = error.constraints || {};
          return {
            field: error.property,
            messages: Object.values(constraints),
          };
        });

        const messages = errors.map((error) => {
          const constraints = error.constraints || {};
          return Object.values(constraints).join(', ');
        });

        return new BadRequestException({
          message: messages.join('; '),
          errors: formattedErrors,
        });
      },
    }),
  );

  /* Swagger Setup */
  const { DocumentBuilder, SwaggerModule } = await import('@nestjs/swagger');
  const config = new DocumentBuilder()
    .setTitle('Speed Limit API')
    .setDescription('The Speed Limit API description')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  const origins = (process.env.FRONTEND_URL || '').split(',').map(s => s.trim()).filter(Boolean);
  app.enableCors({
    origin: origins.length ? origins : true,
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Refresh-Token', 'X-New-Access-Token', 'X-New-Refresh-Token']
  });
  await app.listen({
    port: parseInt(process.env.PORT ?? '5000'),
    host: process.env.HOSTNAME || '0.0.0.0'
  });
}
bootstrap();
