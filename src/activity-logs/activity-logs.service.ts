import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityLogsGateway } from './activity-logs.gateway';

@Injectable()
export class ActivityLogsService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => ActivityLogsGateway))
    private gateway: ActivityLogsGateway,
  ) {}

  async log(data: {
    userId?: string;
    action: string;
    module: string;
    entity?: string;
    entityId?: string;
    description?: string;
    oldValues?: string;
    newValues?: string;
    errorMessage?: string;
    ipAddress?: string;
    userAgent?: string;
    status: 'success' | 'failure';
  }) {
    const created = await this.prisma.activityLog.create({
      data: {
        userId: data.userId,
        action: data.action,
        module: data.module,
        entity: data.entity,
        entityId: data.entityId,
        description: data.description,
        oldValues: data.oldValues,
        newValues: data.newValues,
        errorMessage: data.errorMessage,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
        status: data.status,
      },
    });

    this.gateway.emitActivityLog(created);
    return created;
  }
}
