import { NestFactory } from '@nestjs/core';
import { PrismaService } from './src/database/prisma.service';
import { AppModule } from './src/app.module';

async function bootstrap() {
    const app = await NestFactory.createApplicationContext(AppModule);
    const prisma = app.get(PrismaService);

    console.log('--- Creating Dummy Webhook ---');

    const webhook = await prisma.webhook.create({
        data: {
            url: 'https://webhook.site/dummy-url', // User should replace this for real testing
            name: 'Test Webhook',
            events: ['employee.created', 'employee.updated', 'employee.deleted'],
            secret: 'test-secret-123',
            isActive: true,
        },
    });

    console.log('Created webhook:', webhook);

    await app.close();
}

bootstrap().catch(err => {
    console.error('Failed to create dummy webhook:', err);
    process.exit(1);
});
