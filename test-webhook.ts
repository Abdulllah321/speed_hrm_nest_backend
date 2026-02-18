import { NestFactory } from '@nestjs/core';
import { WebhookService } from './src/webhook/webhook.service';
import { AppModule } from './src/app.module';

async function bootstrap() {
    const app = await NestFactory.createApplicationContext(AppModule);
    const webhookService = app.get(WebhookService);

    console.log('--- Webhook Test Script ---');

    const testEvent = 'employee.created';
    const testPayload = {
        id: 'test-id-123',
        employeeName: 'John Doe Test',
        employeeId: 'EMP001TEST',
    };

    console.log(`Triggering event: ${testEvent}`);

    // Note: This will only work if there's an active webhook record in the database
    // subscribed to this event.
    await webhookService.trigger(testEvent, testPayload);

    console.log('Event triggered. Check logs for delivery status.');

    await app.close();
}

bootstrap().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
