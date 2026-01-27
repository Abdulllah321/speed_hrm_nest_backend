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

  async findAll(query: {
    page?: number;
    limit?: number;
    action?: string;
    module?: string;
    search?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (query.action) {
      where.action = query.action;
    }

    if (query.module) {
      where.module = query.module;
    }

    if (query.search) {
      where.OR = [
        { description: { contains: query.search, mode: 'insensitive' } },
        { ipAddress: { contains: query.search, mode: 'insensitive' } },
        { user: { email: { contains: query.search, mode: 'insensitive' } } },
        { user: { firstName: { contains: query.search, mode: 'insensitive' } } },
        { user: { lastName: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    if (query.startDate && query.endDate) {
      where.createdAt = {
        gte: new Date(query.startDate),
        lte: new Date(query.endDate),
      };
    } else if (query.startDate) {
      where.createdAt = {
        gte: new Date(query.startDate),
      };
    } else if (query.endDate) {
      where.createdAt = {
        lte: new Date(query.endDate),
      };
    }

    const [logs, total] = await Promise.all([
      this.prisma.activityLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      }),
      this.prisma.activityLog.count({ where }),
    ]);

    return {
      logs,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

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
    // Validate userId exists in User table if provided
    let validUserId: string | null = null;
    if (data.userId) {
      try {
        const user = await this.prisma.user.findUnique({
          where: { id: data.userId },
          select: { id: true },
        });
        if (user) {
          validUserId = data.userId;
        }
      } catch (error) {
        // If userId is invalid, set to null
        validUserId = null;
      }
    }

    const created = await this.prisma.activityLog.create({
      data: {
        userId: validUserId,
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
