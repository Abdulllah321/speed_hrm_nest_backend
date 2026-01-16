import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { CreateRebateDto, UpdateRebateDto } from './dto/create-rebate.dto';

@Injectable()
export class RebateService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) {}

  async list(params?: {
    employeeId?: string;
    rebateNatureId?: string;
    monthYear?: string;
    status?: string;
  }) {
    try {
      const where: any = {};

      if (params?.employeeId) {
        where.employeeId = params.employeeId;
      }

      if (params?.rebateNatureId) {
        where.rebateNatureId = params.rebateNatureId;
      }

      if (params?.monthYear) {
        where.monthYear = params.monthYear;
      }

      if (params?.status) {
        where.status = params.status;
      }

      const rebates = await this.prisma.rebate.findMany({
        where,
        include: {
          employee: {
            select: {
              id: true,
              employeeId: true,
              employeeName: true,
              bankName: true,
              accountNumber: true,
              accountTitle: true,
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
          rebateNature: {
            select: {
              id: true,
              name: true,
              type: true,
              category: true,
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
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      return { status: true, data: rebates };
    } catch (error) {
      console.error('Error listing rebates:', error);
      return {
        status: false,
        message:
          error instanceof Error ? error.message : 'Failed to list rebates',
      };
    }
  }

  async get(id: string) {
    try {
      const rebate = await this.prisma.rebate.findUnique({
        where: { id },
        include: {
          employee: {
            select: {
              id: true,
              employeeId: true,
              employeeName: true,
              bankName: true,
              accountNumber: true,
              accountTitle: true,
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
          rebateNature: {
            select: {
              id: true,
              name: true,
              type: true,
              category: true,
              maxInvestmentPercentage: true,
              maxInvestmentAmount: true,
              details: true,
              underSection: true,
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
        },
      });

      if (!rebate) {
        return { status: false, message: 'Rebate not found' };
      }

      return { status: true, data: rebate };
    } catch (error) {
      console.error('Error getting rebate:', error);
      return {
        status: false,
        message:
          error instanceof Error ? error.message : 'Failed to get rebate',
      };
    }
  }

  async create(
    body: CreateRebateDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      // Validate employee exists
      const employee = await this.prisma.employee.findUnique({
        where: { id: body.employeeId },
      });

      if (!employee) {
        return { status: false, message: 'Employee not found' };
      }

      // Validate rebate nature exists
      const rebateNature = await this.prisma.rebateNature.findUnique({
        where: { id: body.rebateNatureId },
      });

      if (!rebateNature) {
        return { status: false, message: 'Rebate nature not found' };
      }

      // Validate monthYear format
      if (!/^\d{4}-\d{2}$/.test(body.monthYear)) {
        return {
          status: false,
          message: 'Invalid monthYear format. Expected YYYY-MM',
        };
      }

      // Check for duplicate (employee, rebateNature, monthYear combination)
      const existing = await this.prisma.rebate.findUnique({
        where: {
          employeeId_rebateNatureId_monthYear: {
            employeeId: body.employeeId,
            rebateNatureId: body.rebateNatureId,
            monthYear: body.monthYear,
          },
        },
      });

      if (existing) {
        return {
          status: false,
          message:
            'Rebate already exists for this employee, rebate nature, and month/year combination',
        };
      }

      // Create rebate (attachment is already a string path from the frontend)
      const rebate = await this.prisma.rebate.create({
        data: {
          employeeId: body.employeeId,
          rebateNatureId: body.rebateNatureId,
          rebateAmount: body.rebateAmount,
          monthYear: body.monthYear,
          attachment: body.attachment || null,
          remarks: body.remarks || null,
          status: 'pending',
          createdById: ctx.userId,
        },
        include: {
          employee: {
            select: {
              id: true,
              employeeId: true,
              employeeName: true,
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
          rebateNature: {
            select: {
              id: true,
              name: true,
              type: true,
              category: true,
            },
          },
        },
      });

      // Log activity
      if (ctx.userId) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'rebate',
          entity: 'Rebate',
          entityId: rebate.id,
          description: `Created rebate for ${employee.employeeName} - ${rebateNature.name}`,
          newValues: JSON.stringify(body),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      return {
        status: true,
        data: rebate,
        message: 'Rebate created successfully',
      };
    } catch (error) {
      console.error('Error creating rebate:', error);
      return {
        status: false,
        message:
          error instanceof Error ? error.message : 'Failed to create rebate',
      };
    }
  }

  async update(
    id: string,
    body: UpdateRebateDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.rebate.findUnique({
        where: { id },
      });

      if (!existing) {
        return { status: false, message: 'Rebate not found' };
      }

      // Validate employee if provided
      if (body.employeeId) {
        const employee = await this.prisma.employee.findUnique({
          where: { id: body.employeeId },
        });
        if (!employee) {
          return { status: false, message: 'Employee not found' };
        }
      }

      // Validate rebate nature if provided
      if (body.rebateNatureId) {
        const rebateNature = await this.prisma.rebateNature.findUnique({
          where: { id: body.rebateNatureId },
        });
        if (!rebateNature) {
          return { status: false, message: 'Rebate nature not found' };
        }
      }

      // Validate monthYear format if provided
      if (body.monthYear && !/^\d{4}-\d{2}$/.test(body.monthYear)) {
        return {
          status: false,
          message: 'Invalid monthYear format. Expected YYYY-MM',
        };
      }

      // Check for duplicate if employeeId, rebateNatureId, or monthYear changed
      if (body.employeeId || body.rebateNatureId || body.monthYear) {
        const employeeId = body.employeeId || existing.employeeId;
        const rebateNatureId = body.rebateNatureId || existing.rebateNatureId;
        const monthYear = body.monthYear || existing.monthYear;

        const duplicate = await this.prisma.rebate.findUnique({
          where: {
            employeeId_rebateNatureId_monthYear: {
              employeeId,
              rebateNatureId,
              monthYear,
            },
          },
        });

        if (duplicate && duplicate.id !== id) {
          return {
            status: false,
            message:
              'Another rebate already exists for this employee, rebate nature, and month/year combination',
          };
        }
      }

      // Prepare update data (attachment is already a string path from the frontend)
      const updateData: any = {};
      if (body.employeeId) updateData.employeeId = body.employeeId;
      if (body.rebateNatureId) updateData.rebateNatureId = body.rebateNatureId;
      if (body.rebateAmount !== undefined)
        updateData.rebateAmount = body.rebateAmount;
      if (body.monthYear) updateData.monthYear = body.monthYear;
      if (body.remarks !== undefined) updateData.remarks = body.remarks;
      if (body.status) updateData.status = body.status;
      if (body.attachment !== undefined)
        updateData.attachment = body.attachment || null;

      const updated = await this.prisma.rebate.update({
        where: { id },
        data: updateData,
        include: {
          employee: {
            select: {
              id: true,
              employeeId: true,
              employeeName: true,
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
          rebateNature: {
            select: {
              id: true,
              name: true,
              type: true,
              category: true,
            },
          },
        },
      });

      // Log activity
      if (ctx.userId) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'rebate',
          entity: 'Rebate',
          entityId: id,
          description: 'Updated rebate',
          newValues: JSON.stringify(body),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      return {
        status: true,
        data: updated,
        message: 'Rebate updated successfully',
      };
    } catch (error) {
      console.error('Error updating rebate:', error);
      return {
        status: false,
        message:
          error instanceof Error ? error.message : 'Failed to update rebate',
      };
    }
  }

  async remove(
    id: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.rebate.findUnique({
        where: { id },
      });

      if (!existing) {
        return { status: false, message: 'Rebate not found' };
      }

      await this.prisma.rebate.delete({
        where: { id },
      });

      // Log activity
      if (ctx.userId) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'rebate',
          entity: 'Rebate',
          entityId: id,
          description: 'Deleted rebate',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      return { status: true, message: 'Rebate deleted successfully' };
    } catch (error) {
      console.error('Error deleting rebate:', error);
      return {
        status: false,
        message:
          error instanceof Error ? error.message : 'Failed to delete rebate',
      };
    }
  }
}
