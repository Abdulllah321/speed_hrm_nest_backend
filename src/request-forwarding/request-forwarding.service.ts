import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { CreateRequestForwardingDto } from './dto/create-request-forwarding.dto';
import { UpdateRequestForwardingDto } from './dto/update-request-forwarding.dto';

@Injectable()
export class RequestForwardingService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) {}

  async list() {
    const configurations =
      await this.prisma.requestForwardingConfiguration.findMany({
        include: {
          approvalLevels: {
            orderBy: { level: 'asc' },
            include: {
              specificEmployee: {
                select: {
                  id: true,
                  employeeId: true,
                  employeeName: true,
                },
              },
              department: {
                select: {
                  id: true,
                  name: true,
                },
              },
              subDepartment: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          createdBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          updatedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

    return { status: true, data: configurations };
  }

  async getByRequestType(requestType: string) {
    const configuration =
      await this.prisma.requestForwardingConfiguration.findUnique({
        where: { requestType },
        include: {
          approvalLevels: {
            orderBy: { level: 'asc' },
            include: {
              specificEmployee: {
                select: {
                  id: true,
                  employeeId: true,
                  employeeName: true,
                },
              },
              department: {
                select: {
                  id: true,
                  name: true,
                },
              },
              subDepartment: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          createdBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          updatedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      });

    if (!configuration) {
      return {
        status: false,
        message: 'Request forwarding configuration not found',
      };
    }

    return { status: true, data: configuration };
  }

  async create(
    body: CreateRequestForwardingDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    // Validate request type
    if (
      !['exemption', 'attendance', 'advance-salary', 'loan'].includes(
        body.requestType,
      )
    ) {
      throw new BadRequestException(
        'Invalid request type. Must be "exemption", "attendance", "advance-salary", or "loan"',
      );
    }

    // Validate approval flow
    if (!['auto-approved', 'multi-level'].includes(body.approvalFlow)) {
      throw new BadRequestException(
        'Invalid approval flow. Must be "auto-approved" or "multi-level"',
      );
    }

    // Check if configuration already exists for this request type
    const existing =
      await this.prisma.requestForwardingConfiguration.findUnique({
        where: { requestType: body.requestType },
      });

    if (existing) {
      throw new BadRequestException(
        `Configuration already exists for request type: ${body.requestType}`,
      );
    }

    // Validate levels if multi-level
    if (body.approvalFlow === 'multi-level') {
      if (!body.levels || body.levels.length === 0) {
        throw new BadRequestException(
          'At least one approval level is required for multi-level flow',
        );
      }

      // Validate each level
      for (let i = 0; i < body.levels.length; i++) {
        const level = body.levels[i];

        if (
          level.approverType === 'specific-employee' &&
          !level.specificEmployeeId
        ) {
          throw new BadRequestException(
            `Level ${level.level}: Specific employee is required`,
          );
        }

        if (
          level.approverType === 'department-head' ||
          level.approverType === 'sub-department-head'
        ) {
          if (!level.departmentHeadMode) {
            throw new BadRequestException(
              `Level ${level.level}: Department head mode is required`,
            );
          }

          if (level.departmentHeadMode === 'specific') {
            if (!level.departmentId) {
              throw new BadRequestException(
                `Level ${level.level}: Department is required when mode is specific`,
              );
            }

            if (
              level.approverType === 'sub-department-head' &&
              !level.subDepartmentId
            ) {
              throw new BadRequestException(
                `Level ${level.level}: Sub-department is required when mode is specific`,
              );
            }
          }
        }
      }
    }

    // Create configuration with levels in a transaction
    const result = await this.prisma.$transaction(async (tx) => {
      const configuration = await tx.requestForwardingConfiguration.create({
        data: {
          requestType: body.requestType,
          approvalFlow: body.approvalFlow,
          status: 'active',
          createdById: ctx.userId,
          updatedById: ctx.userId,
        },
      });

      // Create approval levels if multi-level
      if (body.approvalFlow === 'multi-level' && body.levels) {
        await tx.requestForwardingApprovalLevel.createMany({
          data: body.levels.map((level) => ({
            configurationId: configuration.id,
            level: level.level,
            approverType: level.approverType,
            departmentHeadMode: level.departmentHeadMode || null,
            specificEmployeeId: level.specificEmployeeId || null,
            departmentId: level.departmentId || null,
            subDepartmentId: level.subDepartmentId || null,
          })),
        });
      }

      // Fetch created configuration with relations
      return await tx.requestForwardingConfiguration.findUnique({
        where: { id: configuration.id },
        include: {
          approvalLevels: {
            orderBy: { level: 'asc' },
            include: {
              specificEmployee: {
                select: {
                  id: true,
                  employeeId: true,
                  employeeName: true,
                },
              },
              department: {
                select: {
                  id: true,
                  name: true,
                },
              },
              subDepartment: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      });
    });

    // Log activity
    if (result) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'request-forwarding',
        entity: 'RequestForwardingConfiguration',
        entityId: result.id,
        description: `Created request forwarding configuration for ${body.requestType}`,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
    }

    return { status: true, data: result };
  }

  async update(
    requestType: string,
    body: UpdateRequestForwardingDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    // Validate request type
    if (
      !['exemption', 'attendance', 'advance-salary', 'loan'].includes(
        requestType,
      )
    ) {
      throw new BadRequestException(
        'Invalid request type. Must be "exemption", "attendance", "advance-salary", or "loan"',
      );
    }

    const existing =
      await this.prisma.requestForwardingConfiguration.findUnique({
        where: { requestType },
        include: { approvalLevels: true },
      });

    // Determine approval flow (use body value or existing, or default to auto-approved)
    const approvalFlow =
      body.approvalFlow || existing?.approvalFlow || 'auto-approved';

    // Validate approval flow
    if (!['auto-approved', 'multi-level'].includes(approvalFlow)) {
      throw new BadRequestException(
        'Invalid approval flow. Must be "auto-approved" or "multi-level"',
      );
    }

    // Validate levels if multi-level
    if (approvalFlow === 'multi-level') {
      const levelsToValidate = body.levels || existing?.approvalLevels || [];

      if (levelsToValidate.length === 0) {
        throw new BadRequestException(
          'At least one approval level is required for multi-level flow',
        );
      }

      // Validate each level
      for (let i = 0; i < levelsToValidate.length; i++) {
        const level = levelsToValidate[i];

        if (
          level.approverType === 'specific-employee' &&
          !level.specificEmployeeId
        ) {
          throw new BadRequestException(
            `Level ${level.level}: Specific employee is required`,
          );
        }

        if (
          level.approverType === 'department-head' ||
          level.approverType === 'sub-department-head'
        ) {
          if (!level.departmentHeadMode) {
            throw new BadRequestException(
              `Level ${level.level}: Department head mode is required`,
            );
          }

          if (level.departmentHeadMode === 'specific') {
            if (!level.departmentId) {
              throw new BadRequestException(
                `Level ${level.level}: Department is required when mode is specific`,
              );
            }

            if (
              level.approverType === 'sub-department-head' &&
              !level.subDepartmentId
            ) {
              throw new BadRequestException(
                `Level ${level.level}: Sub-department is required when mode is specific`,
              );
            }
          }
        }
      }
    }

    // Upsert configuration with levels in a transaction
    const result = await this.prisma.$transaction(async (tx) => {
      let configuration;

      if (existing) {
        // Update existing configuration
        configuration = await tx.requestForwardingConfiguration.update({
          where: { requestType },
          data: {
            approvalFlow: approvalFlow,
            status: body.status || existing.status,
            updatedById: ctx.userId,
          },
        });
      } else {
        // Create new configuration if it doesn't exist
        configuration = await tx.requestForwardingConfiguration.create({
          data: {
            requestType: requestType,
            approvalFlow: approvalFlow,
            status: body.status || 'active',
            createdById: ctx.userId,
            updatedById: ctx.userId,
          },
        });
      }

      // If levels are provided, replace all existing levels
      if (body.levels !== undefined) {
        // Delete existing levels
        await tx.requestForwardingApprovalLevel.deleteMany({
          where: { configurationId: configuration?.id },
        });

        // Create new levels if multi-level
        if (approvalFlow === 'multi-level' && body.levels.length > 0) {
          await tx.requestForwardingApprovalLevel.createMany({
            data: body.levels.map((level) => ({
              configurationId: configuration?.id,
              level: level.level,
              approverType: level.approverType,
              departmentHeadMode: level.departmentHeadMode || null,
              specificEmployeeId: level.specificEmployeeId || null,
              departmentId: level.departmentId || null,
              subDepartmentId: level.subDepartmentId || null,
            })),
          });
        }
      }

      // Fetch configuration with relations
      return await tx.requestForwardingConfiguration.findUnique({
        where: { id: configuration.id },
        include: {
          approvalLevels: {
            orderBy: { level: 'asc' },
            include: {
              specificEmployee: {
                select: {
                  id: true,
                  employeeId: true,
                  employeeName: true,
                },
              },
              department: {
                select: {
                  id: true,
                  name: true,
                },
              },
              subDepartment: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      });
    });

    // Log activity
    if (result) {
      const action = existing ? 'update' : 'create';
      await this.activityLogs.log({
        userId: ctx.userId,
        action: action,
        module: 'request-forwarding',
        entity: 'RequestForwardingConfiguration',
        entityId: result.id,
        description: `${existing ? 'Updated' : 'Created'} request forwarding configuration for ${requestType}`,
        oldValues: existing ? JSON.stringify(existing) : undefined,
        newValues: JSON.stringify({ requestType, ...body }),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
    }

    return { status: true, data: result };
  }

  async delete(
    requestType: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    const existing =
      await this.prisma.requestForwardingConfiguration.findUnique({
        where: { requestType },
      });

    if (!existing) {
      throw new NotFoundException(
        `Configuration not found for request type: ${requestType}`,
      );
    }

    // Delete configuration (levels will be cascade deleted)
    await this.prisma.requestForwardingConfiguration.delete({
      where: { requestType },
    });

    // Log activity
    await this.activityLogs.log({
      userId: ctx.userId,
      action: 'delete',
      module: 'request-forwarding',
      entity: 'RequestForwardingConfiguration',
      entityId: existing.id,
      description: `Deleted request forwarding configuration for ${requestType}`,
      oldValues: JSON.stringify(existing),
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      status: 'success',
    });

    return { status: true, message: 'Configuration deleted successfully' };
  }
}
