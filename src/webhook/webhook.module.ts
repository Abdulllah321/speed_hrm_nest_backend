import { Global, Module } from '@nestjs/common';
import { WebhookService } from './webhook.service';
import { WebhookController } from './webhook.controller';
import { DatabaseModule } from '../database/database.module';

@Global()
@Module({
    imports: [DatabaseModule],
    controllers: [WebhookController],
    providers: [WebhookService],
    exports: [WebhookService],
})
export class WebhookModule { }
