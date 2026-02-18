import { NestFactory } from '@nestjs/core';
import { PrismaService } from './src/database/prisma.service';
import { WebhookService } from './src/webhook/webhook.service';
import { AppModule } from './src/app.module';

async function bootstrap() {
    const app = await NestFactory.createApplicationContext(AppModule);

    // Resolve scoped services
    const prisma = await app.resolve(PrismaService);
    const webhookService = await app.resolve(WebhookService);

    console.log('--- Webhook System Verification ---');

    // 1. Create a dummy webhook that points to a local or dummy URL
    const testUrl = 'https://webhook.site/dummy-' + Math.random().toString(36).substring(7);
    console.log(`Creating test webhook with URL: ${testUrl}`);

    const webhook = await prisma.webhook.create({
        data: {
            url: testUrl,
            name: 'Verification Test Webhook',
            events: ['employee.created'],
            secret: 'test-secret-456',
            isActive: true,
        },
    });
    console.log(`Webhook created with ID: ${webhook.id}`);

    // 2. Trigger the event
    console.log('Triggering employee.created event...');
    const testPayload = {
        id: 'verif-id-999',
        employeeName: 'Verification User',
    };

    await webhookService.trigger('employee.created', testPayload);
    console.log('Event triggered successfully.');

    // 3. Cleanup (optional)
    // await prisma.webhook.delete({ where: { id: webhook.id } });

    await app.close();
    process.exit(0);
}

bootstrap().catch(err => {
    console.error('Verification failed:', err);
    process.exit(1);
});
