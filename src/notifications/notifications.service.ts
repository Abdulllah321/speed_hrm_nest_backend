import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from './notifications.gateway';
import {
  type CreateNotificationInput,
  type NotificationChannel,
  type NotificationPreferences,
  type NotificationPriority,
  type NotificationStatus,
} from './notifications.types';

const PRIORITY_ORDER: Record<NotificationPriority, number> = {
  low: 1,
  normal: 2,
  high: 3,
  urgent: 4,
};

function normalizePriority(
  value: string | null | undefined,
): NotificationPriority {
  const v = (value || '').toLowerCase();
  if (v === 'low' || v === 'normal' || v === 'high' || v === 'urgent') return v;
  return 'normal';
}

function parseBoolean(value: string | null | undefined, defaultValue: boolean) {
  if (value === undefined || value === null) return defaultValue;
  const v = value.toLowerCase().trim();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  return defaultValue;
}

@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private deliveryTimer: NodeJS.Timeout | null = null;
  private lastDeliveryRunAt: Date | null = null;

  constructor(
    private prisma: PrismaService,
    private gateway: NotificationsGateway,
  ) {}

  onModuleInit() {
    const enabled = parseBoolean(
      process.env.NOTIFICATIONS_DELIVERY_WORKER_ENABLED,
      true,
    );
    if (!enabled) return;
    const intervalMs = Number(
      process.env.NOTIFICATIONS_DELIVERY_WORKER_INTERVAL_MS || 30000,
    );
    this.deliveryTimer = setInterval(() => {
      this.retryPendingDeliveries().catch(() => undefined);
    }, intervalMs);
  }

  onModuleDestroy() {
    if (this.deliveryTimer) clearInterval(this.deliveryTimer);
    this.deliveryTimer = null;
  }

  async getPreferences(userId: string): Promise<NotificationPreferences> {
    const rows = await this.prisma.userPreference.findMany({
      where: { userId, key: { startsWith: 'notifications.' } },
      select: { key: true, value: true },
    });

    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    const inAppEnabled = parseBoolean(
      byKey.get('notifications.inApp.enabled'),
      true,
    );
    const emailEnabled = parseBoolean(
      byKey.get('notifications.email.enabled'),
      false,
    );
    const smsEnabled = parseBoolean(
      byKey.get('notifications.sms.enabled'),
      false,
    );
    const minPriority = normalizePriority(
      byKey.get('notifications.minPriority') || 'normal',
    );

    const disabledCategories = new Set<string>();
    for (const [key, value] of byKey.entries()) {
      if (!key.startsWith('notifications.category.')) continue;
      if (!key.endsWith('.enabled')) continue;
      const category = key
        .replace('notifications.category.', '')
        .replace('.enabled', '');
      if (!parseBoolean(value, true)) disabledCategories.add(category);
    }

    return {
      inAppEnabled,
      emailEnabled,
      smsEnabled,
      disabledCategories,
      minPriority,
    };
  }

  resolveChannels(
    preferences: NotificationPreferences,
    requested?: NotificationChannel[],
  ): NotificationChannel[] {
    const base =
      requested && requested.length > 0
        ? requested
        : (['inApp'] as NotificationChannel[]);
    const result: NotificationChannel[] = [];
    for (const channel of base) {
      if (channel === 'inApp' && preferences.inAppEnabled) result.push(channel);
      if (channel === 'email' && preferences.emailEnabled) result.push(channel);
      if (channel === 'sms' && preferences.smsEnabled) result.push(channel);
    }
    if (result.length === 0) return ['inApp'];
    return Array.from(new Set(result));
  }

  shouldDeliver(
    preferences: NotificationPreferences,
    category: string,
    priority: NotificationPriority,
  ) {
    if (preferences.disabledCategories.has(category)) return false;
    return PRIORITY_ORDER[priority] >= PRIORITY_ORDER[preferences.minPriority];
  }

  async list(
    userId: string,
    args?: { status?: NotificationStatus; limit?: number; offset?: number },
  ) {
    const limit = Math.min(Math.max(args?.limit ?? 20, 1), 50);
    const offset = Math.max(args?.offset ?? 0, 0);
    const where: any = { userId };
    if (args?.status) where.status = args.status;

    const [items, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.notification.count({ where: { userId, status: 'unread' } }),
    ]);

    return { status: true, data: { items, unreadCount } };
  }

  async markRead(userId: string, id: string) {
    const existing = await this.prisma.notification.findUnique({
      where: { id },
    });
    if (!existing || existing.userId !== userId) {
      return { status: false, message: 'Notification not found' };
    }
    const updated = await this.prisma.notification.update({
      where: { id },
      data: { status: 'read', readAt: new Date() },
    });
    return { status: true, data: updated };
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, status: 'unread' },
      data: { status: 'read', readAt: new Date() },
    });
    return { status: true };
  }

  async markRelatedAsRead(
    userId: string,
    args: { entityType: string; entityId: string },
  ) {
    await this.prisma.notification.updateMany({
      where: {
        userId,
        status: 'unread',
        entityType: args.entityType,
        entityId: args.entityId,
      },
      data: { status: 'read', readAt: new Date() },
    });
  }

  async create(input: CreateNotificationInput) {
    const category = (input.category || 'general').toLowerCase();
    const priority = input.priority || 'normal';
    const preferences = await this.getPreferences(input.userId);
    if (!this.shouldDeliver(preferences, category, priority)) {
      return { status: true, data: null };
    }

    const channels = this.resolveChannels(preferences, input.channels);
    const actionPayload = input.actionPayload
      ? JSON.stringify(input.actionPayload)
      : null;
    const created = await this.prisma.notification.create({
      data: {
        userId: input.userId,
        title: input.title,
        message: input.message,
        category,
        priority,
        status: 'unread',
        actionType: input.actionType || null,
        actionPayload,
        entityType: input.entityType || null,
        entityId: input.entityId || null,
        deliveryChannels: channels.join(','),
      },
    });

    this.gateway.emitToUser(input.userId, { notification: created });

    const nonInApp = channels.filter((c) => c !== 'inApp');
    if (nonInApp.length > 0) {
      await this.prisma.notificationDeliveryAttempt.createMany({
        data: nonInApp.map((channel) => ({
          notificationId: created.id,
          channel,
          status: 'pending',
          attempt: 0,
          nextAttemptAt: new Date(),
        })),
      });
    }

    return { status: true, data: created };
  }

  async createForUsers(inputs: CreateNotificationInput[]) {
    for (const input of inputs) {
      await this.create(input);
    }
    return { status: true };
  }

  getHealthSnapshot() {
    return {
      workerEnabled: !!this.deliveryTimer,
      lastDeliveryRunAt: this.lastDeliveryRunAt,
    };
  }

  private async sendEmail(args: {
    userId: string;
    subject: string;
    body: string;
  }) {
    const webhook = process.env.EMAIL_WEBHOOK_URL;
    if (!webhook) throw new Error('EMAIL_WEBHOOK_URL not configured');
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    if (!res.ok)
      throw new Error(`Email webhook failed with status ${res.status}`);
  }

  private async sendSms(args: { userId: string; message: string }) {
    const webhook = process.env.SMS_WEBHOOK_URL;
    if (!webhook) throw new Error('SMS_WEBHOOK_URL not configured');
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    if (!res.ok)
      throw new Error(`SMS webhook failed with status ${res.status}`);
  }

  private computeBackoffMs(attempt: number) {
    const base = 60000;
    const max = 60 * 60000;
    const value = base * Math.pow(2, Math.max(0, attempt));
    return Math.min(value, max);
  }

  async retryPendingDeliveries() {
    this.lastDeliveryRunAt = new Date();
    const now = new Date();
    const attempts = await this.prisma.notificationDeliveryAttempt.findMany({
      where: {
        status: 'pending',
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      },
      orderBy: { createdAt: 'asc' },
      take: 25,
      include: { notification: true },
    });

    for (const attempt of attempts) {
      await this.processAttempt(attempt.id).catch(() => undefined);
    }
  }

  private async processAttempt(attemptId: string) {
    const attempt = await this.prisma.notificationDeliveryAttempt.findUnique({
      where: { id: attemptId },
      include: { notification: true },
    });
    if (!attempt) return;
    if (attempt.status !== 'pending') return;

    const nextAttempt = attempt.attempt + 1;
    if (nextAttempt > 5) {
      await this.prisma.notificationDeliveryAttempt.update({
        where: { id: attempt.id },
        data: {
          status: 'failed',
          attempt: nextAttempt,
          errorMessage: 'Max retries exceeded',
        },
      });
      return;
    }

    try {
      if (attempt.channel === 'email') {
        await this.sendEmail({
          userId: attempt.notification.userId,
          subject: attempt.notification.title,
          body: attempt.notification.message,
        });
      } else if (attempt.channel === 'sms') {
        await this.sendSms({
          userId: attempt.notification.userId,
          message: `${attempt.notification.title}: ${attempt.notification.message}`,
        });
      } else {
        throw new Error(`Unsupported channel: ${attempt.channel}`);
      }

      await this.prisma.notificationDeliveryAttempt.update({
        where: { id: attempt.id },
        data: { status: 'sent', attempt: nextAttempt, errorMessage: null },
      });

      await this.prisma.notification.update({
        where: { id: attempt.notificationId },
        data: { deliveredAt: attempt.notification.deliveredAt || new Date() },
      });
    } catch (e: any) {
      const backoffMs = this.computeBackoffMs(nextAttempt);
      await this.prisma.notificationDeliveryAttempt.update({
        where: { id: attempt.id },
        data: {
          status: 'pending',
          attempt: nextAttempt,
          nextAttemptAt: new Date(Date.now() + backoffMs),
          errorMessage: e?.message || 'Delivery failed',
        },
      });
    }
  }
}
