import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { CreateDeductionDto, BulkCreateDeductionDto, UpdateDeductionDto } from './dto/create-deduction.dto';

@Injectable()
export class DeductionService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) {}

  async list(params?: {
    employeeId?: string;
    deductionHeadId?: string;
    month?: string;
    year?: string;
    status?: string;
  }) {
    try {
      const where: any = {};

      if (params?.employeeId) {
        where.employeeId = params.employeeId;
      }

      if (params?.deductionHeadId) {
        where.deductionHeadId = params.deductionHeadId;
      }

      if (params?.month) {
        where.month = params.month;
      }

      if (params?.year) {
        where.year = params.year;
      }

      if (params?.status) {
        where.status = params.status;
      }

      const deductions = await this.prisma.deduction.findMany({
        where,
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
          deductionHead: {
            select: {
              id: true,
              name: true,
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

      return { status: true, data: deductions };
    } catch (error) {
      console.error('Error listing deductions:', error);
      return {
        status: false,
        message: error instanceof Error ? error.message : 'Failed to list deductions',
      };
    }
  }

  async get(id: string) {
    try {
      const deduction = await this.prisma.deduction.findUnique({
        where: { id },
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
          deductionHead: {
            select: {
              id: true,
              name: true,
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

      if (!deduction) {
        return { status: false, message: 'Deduction not found' };
      }

      return { status: true, data: deduction };
    } catch (error) {
      console.error('Error getting deduction:', error);
      return {
        status: false,
        message: error instanceof Error ? error.message : 'Failed to get deduction',
      };
    }
  }

  async create(body: CreateDeductionDto, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      if (!body.deductions || body.deductions.length === 0) {
        return { status: false, message: 'At least one deduction item is required' };
      }

      // Validate all employees exist
      const employeeIds = body.deductions.map((d) => d.employeeId);
      const employees = await this.prisma.employee.findMany({
        where: { id: { in: employeeIds } },
        select: { id: true },
      });

      if (employees.length !== employeeIds.length) {
        return { status: false, message: 'One or more employees not found' };
      }

      // Validate all deduction heads exist
      const deductionHeadIds = Array.from(new Set(body.deductions.map((d) => d.deductionHeadId)));
      const deductionHeads = await this.prisma.deductionHead.findMany({
        where: { id: { in: deductionHeadIds }, status: 'active' },
        select: { id: true },
      });

      if (deductionHeads.length !== deductionHeadIds.length) {
        return { status: false, message: 'One or more deduction heads not found or inactive' };
      }

      const date = new Date(body.date);

      // Create deductions in a transaction
      const result = await this.prisma.$transaction(async (tx) => {
        const createdDeductions: any[] = [];

        for (const deductionItem of body.deductions) {
          // Check for duplicate
          const existing = await tx.deduction.findUnique({
            where: {
              employeeId_deductionHeadId_month_year: {
                employeeId: deductionItem.employeeId,
                deductionHeadId: deductionItem.deductionHeadId,
                month: body.month,
                year: body.year,
              },
            },
          });

          if (existing) {
            // Update existing instead of creating duplicate
            const updated = await tx.deduction.update({
              where: { id: existing.id },
              data: {
                amount: deductionItem.amount,
                isTaxable: deductionItem.isTaxable ?? false,
                taxPercentage: deductionItem.taxPercentage ? deductionItem.taxPercentage : null,
                notes: deductionItem.notes ?? null,
                updatedById: ctx.userId,
              },
            });
            createdDeductions.push(updated);
          } else {
            // Create new
            const created = await tx.deduction.create({
              data: {
                employeeId: deductionItem.employeeId,
                deductionHeadId: deductionItem.deductionHeadId,
                amount: deductionItem.amount,
                month: body.month,
                year: body.year,
                date: date,
                isTaxable: deductionItem.isTaxable ?? false,
                taxPercentage: deductionItem.taxPercentage ? deductionItem.taxPercentage : null,
                notes: deductionItem.notes ?? null,
                status: 'active',
                createdById: ctx.userId,
              },
            });
            createdDeductions.push(created);
          }
        }

        return createdDeductions;
      });

      // Log activity
      if (result.length > 0 && ctx.userId) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'deduction',
          entity: 'Deduction',
          entityId: result[0].id,
          description: `Created ${result.length} deduction(s) for ${body.month}/${body.year}`,
          newValues: JSON.stringify(body),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      return {
        status: true,
        data: result,
        message: `Successfully created ${result.length} deduction(s)`,
      };
    } catch (error) {
      console.error('Error creating deduction:', error);
      return {
        status: false,
        message: error instanceof Error ? error.message : 'Failed to create deduction',
      };
    }
  }

  async bulkCreate(body: BulkCreateDeductionDto, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    return this.create(body, ctx);
  }

  async update(
    id: string,
    body: UpdateDeductionDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.deduction.findUnique({
        where: { id },
      });

      if (!existing) {
        return { status: false, message: 'Deduction not found' };
      }

      const updated = await this.prisma.deduction.update({
        where: { id },
        data: {
          ...(body.deductionHeadId && { deductionHeadId: body.deductionHeadId }),
          ...(body.amount !== undefined && { amount: body.amount }),
          ...(body.isTaxable !== undefined && { isTaxable: body.isTaxable }),
          ...(body.taxPercentage !== undefined && { taxPercentage: body.taxPercentage }),
          ...(body.notes !== undefined && { notes: body.notes }),
          ...(body.status && { status: body.status }),
          updatedById: ctx.userId,
        },
        include: {
          employee: {
            select: {
              id: true,
              employeeId: true,
              employeeName: true,
            },
          },
          deductionHead: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      // Log activity
      if (ctx.userId) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'deduction',
          entity: 'Deduction',
          entityId: id,
          description: 'Updated deduction',
          newValues: JSON.stringify(body),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      return { status: true, data: updated, message: 'Deduction updated successfully' };
    } catch (error) {
      console.error('Error updating deduction:', error);
      return {
        status: false,
        message: error instanceof Error ? error.message : 'Failed to update deduction',
      };
    }
  }

  async remove(id: string, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existing = await this.prisma.deduction.findUnique({
        where: { id },
      });

      if (!existing) {
        return { status: false, message: 'Deduction not found' };
      }

      await this.prisma.deduction.delete({
        where: { id },
      });

      // Log activity
      if (ctx.userId) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'deduction',
          entity: 'Deduction',
          entityId: id,
          description: 'Deleted deduction',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      return { status: true, message: 'Deduction deleted successfully' };
    } catch (error) {
      console.error('Error deleting deduction:', error);
      return {
        status: false,
        message: error instanceof Error ? error.message : 'Failed to delete deduction',
      };
    }
  }

  async bulkDelete(ids: string[], ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      if (!ids || ids.length === 0) {
        return { status: false, message: 'No deductions selected for deletion' };
      }

      const result = await this.prisma.deduction.deleteMany({
        where: { id: { in: ids } },
      });

      // Log activity
      if (ctx.userId && result.count > 0) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'deduction',
          entity: 'Deduction',
          entityId: ids[0],
          description: `Deleted ${result.count} deduction(s)`,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      return {
        status: true,
        message: `Successfully deleted ${result.count} deduction(s)`,
      };
    } catch (error) {
      console.error('Error bulk deleting deductions:', error);
      return {
        status: false,
        message: error instanceof Error ? error.message : 'Failed to delete deductions',
      };
    }
  }

  async listDeductionHeads(status?: string) {
    try {
      const where: any = {};
      if (status) {
        where.status = status;
      }

      const deductionHeads = await this.prisma.deductionHead.findMany({
        where,
        orderBy: { name: 'asc' },
      });

      return { status: true, data: deductionHeads };
    } catch (error) {
      console.error('Error listing deduction heads:', error);
      return {
        status: false,
        message: error instanceof Error ? error.message : 'Failed to list deduction heads',
      };
    }
  }

  async getDeductionHead(id: string) {
    try {
      const deductionHead = await this.prisma.deductionHead.findUnique({
        where: { id },
      });

      if (!deductionHead) {
        return { status: false, message: 'Deduction head not found' };
      }

      return { status: true, data: deductionHead };
    } catch (error) {
      console.error('Error getting deduction head:', error);
      return {
        status: false,
        message: error instanceof Error ? error.message : 'Failed to get deduction head',
      };
    }
  }
}
