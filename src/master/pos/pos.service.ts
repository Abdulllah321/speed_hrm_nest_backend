import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaMasterService } from '../../database/prisma-master.service';
import { PrismaService } from '../../database/prisma.service';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

import { ActivityLogsService } from '../../activity-logs/activity-logs.service';
import { CreatePosDto } from './dto/create-pos.dto';
import { UpdatePosDto } from './dto/update-pos.dto';
import { generateNextPosId } from '../../common/utils/pos-id-generator';
import * as bcrypt from 'bcrypt';
import { EncryptionService } from '../../common/utils/encryption.service';

@Injectable()
export class PosService {
  constructor(
    private prisma: PrismaService,
    private prismaMaster: PrismaMasterService,
    private activityLogs: ActivityLogsService,
    private encryptionService: EncryptionService,
  ) { }

  async list(locationId?: string) {
    const items = await this.prisma.pos.findMany({
      where: locationId ? { locationId } : {},
      include: { location: true },
      orderBy: { createdAt: 'desc' },
    });
    return { status: true, data: items };
  }

  async get(id: string) {
    const item = await this.prisma.pos.findUnique({
      where: { id },
      include: { location: true },
    });
    if (!item) return { status: false, message: 'POS not found' };
    return { status: true, data: item };
  }

  async create(
    body: CreatePosDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      // Get existing POS IDs for this location to generate the next sequential ID
      const existingPos = await this.prisma.pos.findMany({
        where: { locationId: body.locationId },
        select: { posId: true },
      });
      const existingIds = existingPos.map((p) => p.posId);
      const nextPosId = generateNextPosId(existingIds);

      // Generate terminalCode if not provided
      let terminalCode = body.terminalCode;
      if (!terminalCode) {
        const location = await this.prisma.location.findUnique({
          where: { id: body.locationId },
          select: { name: true },
        });

        const prefix = location?.name
          ? location.name.substring(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, '')
          : 'POS';

        terminalCode = `${prefix}-${nextPosId}`;

        // Check for uniqueness and append suffix if needed
        const existing = await this.prisma.pos.findUnique({
          where: { terminalCode },
        });
        if (existing) {
          terminalCode = `${terminalCode}-${Math.floor(Math.random() * 900) + 100}`;
        }
      } else {
        // strict check if manually provided
        const existing = await this.prisma.pos.findUnique({
          where: { terminalCode },
        });
        if (existing) {
          throw new BadRequestException('Terminal Code already exists');
        }
      }

      let hashedPin = null;
      if (body.terminalPin) {
        hashedPin = await bcrypt.hash(body.terminalPin, 10);
      }

      const created = await this.prisma.pos.create({
        data: {
          name: body.name,
          locationId: body.locationId,
          companyId: body.companyId,
          posId: nextPosId,
          terminalCode,
          terminalPin: hashedPin,
          status: body.status ?? 'active',
          createdById: ctx.userId,
        },
      });

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'pos',
        entity: 'Pos',
        entityId: created.id,
        description: `Created POS ${created.name} (${created.posId}) for location ${created.locationId}`,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });

      return { status: true, data: created };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'pos',
        entity: 'Pos',
        description: 'Failed to create POS',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return {
        status: false,
        message: error?.message || 'Failed to create POS',
      };
    }
  }

  async update(
    id: string,
    body: UpdatePosDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.pos.findUnique({
        where: { id },
      });
      if (!existing) return { status: false, message: 'POS not found' };

      let hashedPin = existing.terminalPin;
      if (body.terminalPin) {
        hashedPin = await bcrypt.hash(body.terminalPin, 10);
      }

      const updated = await this.prisma.pos.update({
        where: { id },
        data: {
          name: body.name ?? existing.name,
          companyId: body.companyId ?? existing.companyId,
          terminalPin: hashedPin,
          status: body.status ?? existing.status,
        },
      });

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'pos',
        entity: 'Pos',
        entityId: id,
        description: `Updated POS ${updated.name}`,
        oldValues: JSON.stringify(existing),
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });

      return { status: true, data: updated };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'pos',
        entity: 'Pos',
        entityId: id,
        description: 'Failed to update POS',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return {
        status: false,
        message: error?.message || 'Failed to update POS',
      };
    }
  }

  async remove(
    id: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.pos.findUnique({
        where: { id },
      });
      if (!existing) return { status: false, message: 'POS not found' };

      const removed = await this.prisma.pos.delete({
        where: { id },
      });

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'pos',
        entity: 'Pos',
        entityId: id,
        description: `Deleted POS ${existing.name}`,
        oldValues: JSON.stringify(existing),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });

      return { status: true, data: removed };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'pos',
        entity: 'Pos',
        entityId: id,
        description: 'Failed to delete POS',
        errorMessage: error?.message,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to delete POS' };
    }
  }

  async validateTerminal(terminalCode: string, pin: string) {
    let terminal: any = null;
    let company: any = null;

    // 1. Try to find in the current context if it exists
    const hasContext = this.prisma.getTenantId();
    if (hasContext) {
      terminal = await this.prisma.pos.findUnique({
        where: { terminalCode },
      });

      if (terminal?.companyId) {
        company = await this.prismaMaster.company.findUnique({
          where: { id: terminal.companyId },
          include: { tenant: true }
        });
      }
    } else {
      // 2. No context? Attempt a global search across all companies
      // This is necessary for the initial terminal login where the client doesn't know its tenant yet.
      const companies = await this.prismaMaster.company.findMany({
        where: { status: 'active' }
      });

      for (const comp of companies) {
        let dbUrl = comp.dbUrl;
        let password = '';

        if (comp.dbPassword) {
          try {
            password = this.encryptionService.decrypt(comp.dbPassword);
          } catch (err) {
            continue;
          }
        }

        try {
          const tempPool = new Pool({
            user: comp.dbUser || undefined,
            host: comp.dbHost || undefined,
            database: comp.dbName || undefined,
            password: password || undefined,
            port: comp.dbPort || 5432,
            max: 1,
            connectionTimeoutMillis: 2000,
          });
          const adapter = new PrismaPg(tempPool);
          const tempPrisma = new PrismaClient({ adapter: adapter as any });

          try {
            terminal = await tempPrisma.pos.findUnique({
              where: { terminalCode, status: 'active' },
            });

            if (terminal) {
              company = await this.prismaMaster.company.findUnique({
                where: { id: comp.id },
                include: { tenant: true }
              });
              break;
            }
          } finally {
            await tempPrisma.$disconnect();
            await tempPool.end();
          }
        } catch (err) {
          continue;
        }
      }
    }

    if (!terminal || terminal.status !== 'active') {
      return { status: false, message: 'Terminal not found or inactive' };
    }

    if (!terminal.terminalPin) {
      return {
        status: false,
        message: 'Terminal found but security not configured',
      };
    }

    const isValid = await bcrypt.compare(pin, terminal.terminalPin);
    if (!isValid) {
      return { status: false, message: 'Invalid Terminal PIN' };
    }

    return {
      status: true,
      data: {
        terminalId: terminal.id,
        name: terminal.name,
        companyId: terminal.companyId,
        company: company,
        tenant: company?.tenant,

        posId: terminal.posId,
        terminalCode: terminal.terminalCode,
        locationId: terminal.locationId,
      },
    };
  }
}
