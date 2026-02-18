import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import * as crypto from 'crypto';

@Injectable()
export class WebhookService {
    private readonly logger = new Logger(WebhookService.name);

    constructor(private prisma: PrismaService) { }

    async findAll() {
        return this.prisma.webhook.findMany({
            orderBy: { createdAt: 'desc' },
        });
    }

    async findOne(id: string) {
        return this.prisma.webhook.findUnique({
            where: { id },
            include: { logs: { take: 10, orderBy: { createdAt: 'desc' } } },
        });
    }

    async create(data: any) {
        return this.prisma.webhook.create({
            data: {
                url: data.url,
                name: data.name,
                secret: data.secret,
                events: data.events || [],
                isActive: data.isActive !== undefined ? data.isActive : true,
                metadata: data.metadata,
            },
        });
    }

    async update(id: string, data: any) {
        return this.prisma.webhook.update({
            where: { id },
            data: {
                url: data.url,
                name: data.name,
                secret: data.secret,
                events: data.events,
                isActive: data.isActive,
                metadata: data.metadata,
            },
        });
    }

    async remove(id: string) {
        return this.prisma.webhook.delete({
            where: { id },
        });
    }

    /**
     * Trigger webhooks for a specific event
     */
    async trigger(event: string, payload: any) {
        const webhooks = await this.prisma.webhook.findMany({
            where: {
                isActive: true,
                events: {
                    has: event,
                },
            },
        });

        if (webhooks.length === 0) {
            return;
        }

        this.logger.log(`Triggering ${webhooks.length} webhooks for event: ${event}`);

        for (const webhook of webhooks) {
            this.deliverWebhook(webhook, event, payload).catch((err) => {
                this.logger.error(`Failed to deliver webhook ${webhook.id}: ${err.message}`);
            });
        }
    }

    private async deliverWebhook(webhook: any, event: string, payload: any) {
        const timestamp = Date.now();
        const body = JSON.stringify({
            event,
            timestamp,
            payload,
        });

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'X-Webhook-Event': event,
            'X-Webhook-Timestamp': timestamp.toString(),
        };

        if (webhook.secret) {
            const signature = crypto
                .createHmac('sha256', webhook.secret)
                .update(body)
                .digest('hex');
            headers['X-Webhook-Signature'] = signature;
        }

        let status = 'pending';
        let statusCode: number | null = null;
        let responseData: any = null;
        let error: string | null = null;

        try {
            const resp = await fetch(webhook.url, {
                method: 'POST',
                headers,
                body,
            });

            statusCode = resp.status;
            status = resp.ok ? 'success' : 'failure';

            try {
                responseData = await resp.json();
            } catch (e) {
                responseData = await resp.text();
            }
        } catch (err: any) {
            status = 'failure';
            error = err.message;
        }

        // Log the result
        await this.prisma.webhookLog.create({
            data: {
                webhookId: webhook.id,
                event,
                payload: payload as any,
                response: responseData as any,
                statusCode,
                error,
                status,
            },
        });
    }
}
