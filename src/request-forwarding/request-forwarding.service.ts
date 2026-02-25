import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { CreateRequestForwardingDto } from './dto/create-request-forwarding.dto';
import { UpdateRequestForwardingDto } from './dto/update-request-forwarding.dto';
import { PrismaMasterService } from '../database/prisma-master.service';

@Injectable()
export class RequestForwardingService {
  constructor(
    private prisma: PrismaService,
    private prismaMaster: PrismaMasterService,
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
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

    // Collect all IDs for Master DB lookup
    const deptIds = new Set<string>();
    const subDeptIds = new Set<string>();
    const userIds = new Set<string>();

    configurations.forEach((config) => {
      if (config.createdById) userIds.add(config.createdById);
      if (config.updatedById) userIds.add(config.updatedById);
      config.approvalLevels.forEach((level) => {
        if (level.departmentId) deptIds.add(level.departmentId);
        if (level.subDepartmentId) subDeptIds.add(level.subDepartmentId);
      });
    });

    // Fetch Master DB data in parallel
    const [departments, subDepartments, users] = await Promise.all([
      this.prisma.department.findMany({
        where: { id: { in: Array.from(deptIds) } },
        select: { id: true, name: true },
      }),
      this.prisma.subDepartment.findMany({
        where: { id: { in: Array.from(subDeptIds) } },
        select: { id: true, name: true },
      }),
      this.prismaMaster.user.findMany({
        where: { id: { in: Array.from(userIds) } },
        select: { id: true, firstName: true, lastName: true, email: true },
      }),
    ]);

    // Create maps for quick lookup
    const deptMap = new Map(departments.map((d) => [d.id, d]));
    const subDeptMap = new Map(subDepartments.map((sd) => [sd.id, sd]));
    const userMap = new Map(users.map((u) => [u.id, u]));

    // Map the results back
    const mapped = configurations.map((config) => ({
      ...config,
      createdBy: config.createdById
        ? userMap.get(config.createdById) || null
        : null,
      updatedBy: config.updatedById
        ? userMap.get(config.updatedById) || null
        : null,
      approvalLevels: config.approvalLevels.map((level) => ({
        ...level,
        department: level.departmentId
          ? deptMap.get(level.departmentId) || null
          : null,
        subDepartment: level.subDepartmentId
          ? subDeptMap.get(level.subDepartmentId) || null
          : null,
      })),
    }));

    return { status: true, data: mapped };
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

    // Collect all IDs for Master DB lookup
    const deptIds = new Set<string>();
    const subDeptIds = new Set<string>();
    const userIds = new Set<string>();

    if (configuration.createdById) userIds.add(configuration.createdById);
    if (configuration.updatedById) userIds.add(configuration.updatedById);
    configuration.approvalLevels.forEach((level) => {
      if (level.departmentId) deptIds.add(level.departmentId);
      if (level.subDepartmentId) subDeptIds.add(level.subDepartmentId);
    });

    // Fetch Master DB data in parallel
    const [departments, subDepartments, users] = await Promise.all([
      this.prisma.department.findMany({
        where: { id: { in: Array.from(deptIds) } },
        select: { id: true, name: true },
      }),
      this.prisma.subDepartment.findMany({
        where: { id: { in: Array.from(subDeptIds) } },
        select: { id: true, name: true },
      }),
      this.prismaMaster.user.findMany({
        where: { id: { in: Array.from(userIds) } },
        select: { id: true, firstName: true, lastName: true, email: true },
      }),
    ]);

    // Create maps for quick lookup
    const deptMap = new Map(departments.map((d) => [d.id, d]));
    const subDeptMap = new Map(subDepartments.map((sd) => [sd.id, sd]));
    const userMap = new Map(users.map((u) => [u.id, u]));

    // Map the results back
    const mapped = {
      ...configuration,
      createdBy: configuration.createdById
        ? userMap.get(configuration.createdById) || null
        : null,
      updatedBy: configuration.updatedById
        ? userMap.get(configuration.updatedById) || null
        : null,
      approvalLevels: configuration.approvalLevels.map((level) => ({
        ...level,
        department: level.departmentId
          ? deptMap.get(level.departmentId) || null
          : null,
        subDepartment: level.subDepartmentId
          ? subDeptMap.get(level.subDepartmentId) || null
          : null,
      })),
    };

    return { status: true, data: mapped };
  }

  async create(
    body: CreateRequestForwardingDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    // Validate request type
    if (
      ![
        'exemption',
        'attendance',
        'advance-salary',
        'loan',
        'overtime',
        'leave-application',
        'leave-encashment',
      ].includes(body.requestType)
    ) {
      throw new BadRequestException(
        'Invalid request type. Must be "exemption", "attendance", "advance-salary", "loan", "overtime", "leave-application", or "leave-encashment"',
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
            },
          },
        },
      });
    });

    if (!result) {
      return { status: false, message: 'Failed to create configuration' };
    }

    // Collect all IDs for Master DB lookup
    const deptIds = new Set<string>();
    const subDeptIds = new Set<string>();

    result.approvalLevels.forEach((level) => {
      if (level.departmentId) deptIds.add(level.departmentId);
      if (level.subDepartmentId) subDeptIds.add(level.subDepartmentId);
    });

    // Fetch Master DB data in parallel (Promise.all as requested)
    const [departments, subDepartments] = await Promise.all([
      this.prisma.department.findMany({
        where: { id: { in: Array.from(deptIds) } },
        select: { id: true, name: true },
      }),
      this.prisma.subDepartment.findMany({
        where: { id: { in: Array.from(subDeptIds) } },
        select: { id: true, name: true },
      }),
    ]);

    const deptMap = new Map(departments.map((d) => [d.id, d]));
    const subDeptMap = new Map(subDepartments.map((sd) => [sd.id, sd]));

    const mappedResult = {
      ...result,
      approvalLevels: result.approvalLevels.map((level) => ({
        ...level,
        department: level.departmentId
          ? deptMap.get(level.departmentId) || null
          : null,
        subDepartment: level.subDepartmentId
          ? subDeptMap.get(level.subDepartmentId) || null
          : null,
      })),
    };

    // Log activity
    if (mappedResult) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'request-forwarding',
        entity: 'RequestForwardingConfiguration',
        entityId: mappedResult.id,
        description: `Created request forwarding configuration for ${body.requestType}`,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
    }

    return { status: true, data: mappedResult };
  }

  async update(
    requestType: string,
    body: UpdateRequestForwardingDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    // Validate request type
    if (
      ![
        'exemption',
        'attendance',
        'advance-salary',
        'loan',
        'overtime',
        'leave-application',
        'leave-encashment',
      ].includes(requestType)
    ) {
      throw new BadRequestException(
        'Invalid request type. Must be "exemption", "attendance", "advance-salary", "loan", "overtime", "leave-application", or "leave-encashment"',
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
            },
          },
        },
      });
    });

    if (!result) {
      return { status: false, message: 'Failed to update configuration' };
    }

    // Collect all IDs for Master DB lookup
    const deptIds = new Set<string>();
    const subDeptIds = new Set<string>();

    result.approvalLevels.forEach((level) => {
      if (level.departmentId) deptIds.add(level.departmentId);
      if (level.subDepartmentId) subDeptIds.add(level.subDepartmentId);
    });

    // Fetch Master DB data in parallel (Promise.all as requested)
    const [departments, subDepartments] = await Promise.all([
      this.prisma.department.findMany({
        where: { id: { in: Array.from(deptIds) } },
        select: { id: true, name: true },
      }),
      this.prisma.subDepartment.findMany({
        where: { id: { in: Array.from(subDeptIds) } },
        select: { id: true, name: true },
      }),
    ]);

    const deptMap = new Map(departments.map((d) => [d.id, d]));
    const subDeptMap = new Map(subDepartments.map((sd) => [sd.id, sd]));

    const mappedResult = {
      ...result,
      approvalLevels: result.approvalLevels.map((level) => ({
        ...level,
        department: level.departmentId
          ? deptMap.get(level.departmentId) || null
          : null,
        subDepartment: level.subDepartmentId
          ? subDeptMap.get(level.subDepartmentId) || null
          : null,
      })),
    };

    // Log activity
    if (mappedResult) {
      const action = existing ? 'update' : 'create';
      await this.activityLogs.log({
        userId: ctx.userId,
        action: action,
        module: 'request-forwarding',
        entity: 'RequestForwardingConfiguration',
        entityId: mappedResult.id,
        description: `${existing ? 'Updated' : 'Created'} request forwarding configuration for ${requestType}`,
        oldValues: existing ? JSON.stringify(existing) : undefined,
        newValues: JSON.stringify({ requestType, ...body }),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
    }

    return { status: true, data: mappedResult };
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
