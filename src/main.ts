import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import fastifyMultipart from '@fastify/multipart';
import fastifyCookie from '@fastify/cookie';
import { ValidationPipe, BadRequestException, Logger } from '@nestjs/common';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { PrismaService } from './database/prisma.service';
import 'dotenv/config';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Create Fastify adapter first
  const adapter = new FastifyAdapter();

  // Register cookie plugin for cookie support
  await adapter.register(fastifyCookie as any, {
    secret: process.env.COOKIE_SECRET || 'your-secret-key-change-in-production',
  });

  // Register CORS on the adapter level for proper preflight handling with Fastify
  const allowedOrigins = (process.env.FRONTEND_URL || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const fastifyCors = await import('@fastify/cors');
  await adapter.register(fastifyCors.default as any, {
    origin: allowedOrigins.length ? allowedOrigins : true,
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Refresh-Token',
      'X-New-Access-Token',
      'X-New-Refresh-Token',
      'X-Tenant-Id',
      'X-Company-Id',
    ],
    exposedHeaders: ['X-New-Access-Token', 'X-New-Refresh-Token'],
    preflight: true,
    strictPreflight: false,
  });

  // Register multipart plugin on the adapter BEFORE creating the app
  await adapter.register(fastifyMultipart as any, {
    limits: {
      fileSize: 500 * 1024 * 1024, // 500MB limit
    },
  });

  // Now create the NestJS application with the configured adapter
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    adapter,
    {
      logger: ['error', 'warn', 'log', 'debug', 'verbose'],
    },
  );

  // Enable graceful shutdown hooks
  app.enableShutdownHooks();

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

  // CORS is handled at the Fastify adapter level above

  // Graceful shutdown handlers
  const gracefulShutdown = async (signal: string) => {
    logger.log(`Received ${signal}, starting graceful shutdown...`);

    try {
      // Cleanup all tenant connection pools
      logger.log('Cleaning up tenant connection pools...');
      await PrismaService.cleanupAllPools();
      logger.log('Tenant pools cleaned up successfully');

      // Close the NestJS application
      logger.log('Closing NestJS application...');
      await app.close();
      logger.log('Application closed successfully');

      process.exit(0);
    } catch (error) {
      logger.error('Error during graceful shutdown:', error);
      process.exit(1);
    }
  };

  // Listen for termination signals
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    gracefulShutdown('uncaughtException');
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    gracefulShutdown('unhandledRejection');
  });

  const port = parseInt(process.env.PORT ?? '5000');
  const host = process.env.HOSTNAME || '0.0.0.0';

  await app.listen({
    port,
    host,
  });

  logger.log(`Application is running on: http://${host}:${port}`);
  logger.log(
    `Swagger documentation available at: http://${host}:${port}/api/docs`,
  );
  logger.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
}

bootstrap().catch((error) => {
  const logger = new Logger('Bootstrap');
  logger.error('Failed to start application:', error);
  process.exit(1);
});
