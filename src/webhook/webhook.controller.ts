import {
    Controller,
    Get,
    Post,
    Body,
    Patch,
    Param,
    Delete,
    UseGuards,
} from '@nestjs/common';
import { WebhookService } from './webhook.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('webhooks')
@UseGuards(JwtAuthGuard)
export class WebhookController {
    constructor(private readonly webhookService: WebhookService) { }

    @Get()
    findAll() {
        return this.webhookService.findAll();
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.webhookService.findOne(id);
    }

    @Post()
    create(@Body() data: any) {
        return this.webhookService.create(data);
    }

    @Patch(':id')
    update(@Param('id') id: string, @Body() data: any) {
        return this.webhookService.update(id, data);
    }

    @Delete(':id')
    remove(@Param('id') id: string) {
        return this.webhookService.remove(id);
    }
}
