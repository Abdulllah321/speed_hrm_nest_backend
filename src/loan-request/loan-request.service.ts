import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PrismaMasterService } from '../database/prisma-master.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import {
  CreateLoanRequestDto,
  UpdateLoanRequestDto,
  ApproveLoanRequestDto,
} from './dto/create-loan-request.dto';

@Injectable()
export class LoanRequestService {
  constructor(
    private prisma: PrismaService,
    private prismaMaster: PrismaMasterService,
    private activityLogs: ActivityLogsService,
  ) {}

  private async resolveApproverUserId(args: {
    level: {
      approverType: string;
      departmentHeadMode?: string | null;
      specificEmployeeId?: string | null;
      departmentId?: string | null;
      subDepartmentId?: string | null;
    };
    employee: {
      departmentId: string;
      subDepartmentId?: string | null;
      reportingManager?: string | null;
    };
  }) {
    const { level, employee } = args;

    if (level.approverType === 'reporting-manager') {
      if (!employee.reportingManager) return null;
      const manager = await this.prisma.employee.findUnique({
        where: { id: employee.reportingManager },
        select: { userId: true },
      });
      return manager?.userId || null;
    }

    if (level.approverType === 'specific-employee') {
      if (!level.specificEmployeeId) return null;
      const specific = await this.prisma.employee.findUnique({
        where: { id: level.specificEmployeeId },
        select: { userId: true },
      });
      return specific?.userId || null;
    }

    if (level.approverType === 'department-head') {
      const departmentId =
        level.departmentHeadMode === 'specific'
          ? level.departmentId
          : employee.departmentId;
      if (!departmentId) return null;
      const department = await this.prisma.department.findUnique({
        where: { id: departmentId },
        select: { headId: true },
      });
      if (!department?.headId) return null;
      const head = await this.prisma.employee.findUnique({
        where: { id: department.headId },
        select: { userId: true },
      });
      return head?.userId || null;
    }

    if (level.approverType === 'sub-department-head') {
      const subDepartmentId =
        level.departmentHeadMode === 'specific'
          ? level.subDepartmentId
          : employee.subDepartmentId;
      if (!subDepartmentId) return null;
      const subDepartment = await this.prisma.subDepartment.findUnique({
        where: { id: subDepartmentId },
        select: { headId: true },
      });
      if (!subDepartment?.headId) return null;
      const head = await this.prisma.employee.findUnique({
        where: { id: subDepartment.headId },
        select: { userId: true },
      });
      return head?.userId || null;
    }

    return null;
  }

  private getPendingApprovalLevel(req: any): 1 | 2 | null {
    if (
      req.approvalStatus === 'approved' ||
      req.approvalStatus === 'rejected'
    ) {
      return null;
    }

    if (
      req.approval1Status !== 'approved' &&
      req.approval1Status !== 'auto-approved'
    ) {
      return 1;
    }

    if (req.approval2 && req.approval2Status !== 'approved') {
      return 2;
    }

    return null;
  }

  private async enrichSingleLoanRequest(loanRequest: any) {
    if (!loanRequest) return null;

    const [
      loanType,
      department,
      subDepartment,
      approvedBy,
      createdBy,
      updatedBy,
    ] = await Promise.all([
      loanRequest.loanTypeId
        ? this.prisma.loanType.findUnique({
            where: { id: loanRequest.loanTypeId },
            select: { id: true, name: true },
          })
        : null,
      loanRequest.employee?.departmentId
        ? this.prisma.department.findUnique({
            where: { id: loanRequest.employee.departmentId },
            select: { id: true, name: true },
          })
        : null,
      loanRequest.employee?.subDepartmentId
        ? this.prisma.subDepartment.findUnique({
            where: { id: loanRequest.employee.subDepartmentId },
            select: { id: true, name: true },
          })
        : null,
      loanRequest.approvedById
        ? this.prismaMaster.user.findUnique({
            where: { id: loanRequest.approvedById },
            select: { id: true, firstName: true, lastName: true, email: true },
          })
        : null,
      loanRequest.createdById
        ? this.prismaMaster.user.findUnique({
            where: { id: loanRequest.createdById },
            select: { id: true, firstName: true, lastName: true, email: true },
          })
        : null,
      loanRequest.updatedById
        ? this.prismaMaster.user.findUnique({
            where: { id: loanRequest.updatedById },
            select: { id: true, firstName: true, lastName: true, email: true },
          })
        : null,
    ]);

    return {
      ...loanRequest,
      loanType,
      employee: loanRequest.employee
        ? {
            ...loanRequest.employee,
            department,
            subDepartment,
          }
        : null,
      approvedBy,
      createdBy,
      updatedBy,
    };
  }

  async list(
    params?: {
      employeeId?: string;
      loanTypeId?: string;
      status?: string;
      approvalStatus?: string;
      requestedDate?: string;
      repaymentStartMonthYear?: string;
    },
    user?: any,
  ) {
    try {
      const where: any = {};

      // If user is not admin, they see:
      // 1. Requests they created (createdById)
      // 2. Requests for their employee record (employeeId)
      // 3. Requests where they are an approver (approval1 or approval2)
      const roleName = (user?.roleName || '').toLowerCase();
      const isAdmin = ['admin', 'super admin', 'super_admin'].includes(
        roleName,
      );

      if (!isAdmin && user?.userId) {
        // Show requests created by user OR for user's employee record OR where user is an approver
        where.OR = [
          { createdById: user.userId },           // Requests they created
          { employeeId: user.employeeId },        // Requests for their employee record
          { approval1: user.userId },             // Requests where they are level 1 approver
          { approval2: user.userId },             // Requests where they are level 2 approver
        ];
      } else if (params?.employeeId) {
        where.employeeId = params.employeeId;
      }

      if (params?.employeeId && isAdmin) {
        where.employeeId = params.employeeId;
      }

      if (params?.loanTypeId) {
        where.loanTypeId = params.loanTypeId;
      }

      if (params?.status) {
        where.status = params.status;
      }

      if (params?.approvalStatus) {
        where.approvalStatus = params.approvalStatus;
      }

      if (params?.requestedDate) {
        where.requestedDate = new Date(params.requestedDate);
      }

      if (params?.repaymentStartMonthYear) {
        where.repaymentStartMonthYear = params.repaymentStartMonthYear;
      }

      const loanRequests = await this.prisma.loanRequest.findMany({
        where,
        include: {
          employee: {
            select: {
              id: true,
              employeeId: true,
              employeeName: true,
              departmentId: true,
              subDepartmentId: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      if (loanRequests.length === 0) {
        return { status: true, data: [] };
      }

      // Collect all IDs for bulk fetching from Master DB
      const loanTypeIds = [
        ...new Set(loanRequests.map((lr) => lr.loanTypeId).filter(Boolean)),
      ] as string[];
      const deptIds = [
        ...new Set(
          loanRequests.map((lr) => lr.employee?.departmentId).filter(Boolean),
        ),
      ] as string[];
      const subDeptIds = [
        ...new Set(
          loanRequests
            .map((lr) => lr.employee?.subDepartmentId)
            .filter(Boolean),
        ),
      ] as string[];
      const userIds = [
        ...new Set(
          [
            ...loanRequests.map((lr) => lr.approval1),
            ...loanRequests.map((lr) => lr.approval2),
            ...loanRequests.map((lr) => lr.approvedById),
            ...loanRequests.map((lr) => lr.createdById),
            ...loanRequests.map((lr) => lr.updatedById),
          ].filter(Boolean),
        ),
      ] as string[];
      const employeeIds = [...new Set(loanRequests.map((lr) => lr.employeeId))];

      // Fetch all required data in parallel
      const [loanTypes, departments, subDepartments, users, payrollAggregates] =
        await Promise.all([
          this.prisma.loanType.findMany({
            where: { id: { in: loanTypeIds } },
            select: { id: true, name: true },
          }),
          this.prisma.department.findMany({
            where: { id: { in: deptIds } },
            select: { id: true, name: true },
          }),
          this.prisma.subDepartment.findMany({
            where: { id: { in: subDeptIds } },
            select: { id: true, name: true },
          }),
          this.prismaMaster.user.findMany({
            where: { id: { in: userIds as string[] } },
            select: { id: true, firstName: true, lastName: true, email: true },
          }),
          this.prisma.payrollDetail.groupBy({
            by: ['employeeId'],
            where: {
              employeeId: { in: employeeIds },
              payroll: { status: 'confirmed' },
            },
            _sum: {
              loanDeduction: true,
            },
          }),
        ]);

      // Create maps for efficient lookups
      const loanTypeMap = new Map(loanTypes.map((t) => [t.id, t]));
      const deptMap = new Map(departments.map((d) => [d.id, d]));
      const subDeptMap = new Map(subDepartments.map((sd) => [sd.id, sd]));
      const userMap = new Map(users.map((u) => [u.id, u]));
      const paidAmountMap = new Map(
        payrollAggregates.map((pa) => [
          pa.employeeId,
          Number(pa._sum.loanDeduction || 0),
        ]),
      );

      const data = loanRequests.map((loan) => {
        const lr = loan as any;
        return {
          ...lr,
          loanType: loanTypeMap.get(lr.loanTypeId) || null,
          employee: lr.employee
            ? {
                ...lr.employee,
                department: deptMap.get(lr.employee.departmentId) || null,
                subDepartment:
                  subDeptMap.get(lr.employee.subDepartmentId) || null,
              }
            : null,
          approvedBy: userMap.get(lr.approvedById) || null,
          createdBy: userMap.get(lr.createdById) || null,
          updatedBy: userMap.get(lr.updatedById) || null,
          paidAmount: paidAmountMap.get(lr.employeeId) || 0,
        };
      });

      return { status: true, data };
    } catch (error) {
      console.error('Error listing loan requests:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to list loan requests',
      };
    }
  }

  async get(id: string) {
    try {
      const loanRequest = await this.prisma.loanRequest.findUnique({
        where: { id },
        include: {
          employee: {
            select: {
              id: true,
              employeeId: true,
              employeeName: true,
              departmentId: true,
              subDepartmentId: true,
            },
          },
        },
      });

      if (!loanRequest) {
        return { status: false, message: 'Loan request not found' };
      }

      // Fetch Master data
      const [
        loanType,
        department,
        subDepartment,
        approvedBy,
        createdBy,
        updatedBy,
      ] = await Promise.all([
        loanRequest.loanTypeId
          ? this.prisma.loanType.findUnique({
              where: { id: loanRequest.loanTypeId },
              select: { id: true, name: true },
            })
          : null,
        loanRequest.employee?.departmentId
          ? this.prisma.department.findUnique({
              where: { id: loanRequest.employee.departmentId },
              select: { id: true, name: true },
            })
          : null,
        loanRequest.employee?.subDepartmentId
          ? this.prisma.subDepartment.findUnique({
              where: { id: loanRequest.employee.subDepartmentId },
              select: { id: true, name: true },
            })
          : null,
        loanRequest.approvedById
          ? this.prismaMaster.user.findUnique({
              where: { id: loanRequest.approvedById },
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            })
          : null,
        loanRequest.createdById
          ? this.prismaMaster.user.findUnique({
              where: { id: loanRequest.createdById },
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            })
          : null,
        loanRequest.updatedById
          ? this.prismaMaster.user.findUnique({
              where: { id: loanRequest.updatedById },
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            })
          : null,
      ]);

      const enriched = {
        ...loanRequest,
        loanType,
        employee: loanRequest.employee
          ? {
              ...loanRequest.employee,
              department,
              subDepartment,
            }
          : null,
        approvedBy,
        createdBy,
        updatedBy,
      };

      return { status: true, data: enriched };
    } catch (error) {
      console.error('Error getting loan request:', error);
      return {
        status: false,
        message:
          error instanceof Error ? error.message : 'Failed to get loan request',
      };
    }
  }

  async create(
    body: CreateLoanRequestDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      if (!body.loanRequests || body.loanRequests.length === 0) {
        return {
          status: false,
          message: 'Loan request data is required',
        };
      }

      // Validate only one loan request is provided (single employee per request)
      if (body.loanRequests.length > 1) {
        return {
          status: false,
          message:
            'Only one loan request per employee is allowed. Please create separate requests for multiple employees.',
        };
      }

      const employeeIds = body.loanRequests.map((l) => l.employeeId);
      const employees = await this.prisma.employee.findMany({
        where: { id: { in: employeeIds } },
        select: {
          id: true,
          departmentId: true,
          subDepartmentId: true,
          reportingManager: true,
        },
      });

      if (employees.length !== employeeIds.length) {
        return { status: false, message: 'One or more employees not found' };
      }

      const employeeById = new Map(employees.map((e) => [e.id, e]));

      const loanTypeIds = body.loanRequests.map((l) => l.loanTypeId);
      const loanTypes = await this.prisma.loanType.findMany({
        where: { id: { in: loanTypeIds }, status: 'active' },
        select: { id: true, name: true },
      });

      if (loanTypes.length !== loanTypeIds.length) {
        return {
          status: false,
          message: 'One or more loan types not found or inactive',
        };
      }
      const loanTypeMap = new Map(loanTypes.map((lt) => [lt.id, lt]));

      const forwarding =
        await this.prisma.requestForwardingConfiguration.findUnique({
          where: { requestType: 'loan' },
          include: { approvalLevels: { orderBy: { level: 'asc' } } },
        });
      const activeForwarding =
        forwarding && forwarding.status === 'active' ? forwarding : null;

      const result = await this.prisma.$transaction(async (tx) => {
        const createdLoanRequests: any[] = [];

        for (const loanRequestItem of body.loanRequests) {
          const requestedDate = new Date(loanRequestItem.requestedDate);

          const employee = employeeById.get(loanRequestItem.employeeId);
          if (!employee) {
            throw new Error('Employee not found');
          }

          const now = new Date();
          let approvalStatus: string = 'pending';
          let status: string = 'pending';
          let approval1: string | null = null;
          let approval1Status: string | null = null;
          let approval1Date: Date | null = null;
          let approval2: string | null = null;
          let approval2Status: string | null = null;
          const approval2Date: Date | null = null;

          if (activeForwarding?.approvalFlow === 'auto-approved') {
            approvalStatus = 'approved';
            status = 'approved';
            approval1Status = 'auto-approved';
            approval1Date = now;
          } else if (activeForwarding?.approvalFlow === 'multi-level') {
            const level1 = activeForwarding.approvalLevels.find(
              (l) => l.level === 1,
            );
            if (!level1) {
              throw new Error(
                'Approval level 1 is required for multi-level flow',
              );
            }

            const approver1UserId = await this.resolveApproverUserId({
              level: level1,
              employee: {
                departmentId: employee.departmentId,
                subDepartmentId: employee.subDepartmentId,
                reportingManager: employee.reportingManager,
              },
            });
            // If approver cannot be resolved, allow creation without approver (will require admin approval)
            if (approver1UserId) {
              approval1 = approver1UserId;
              approval1Status = 'pending';
            }

            const level2 = activeForwarding.approvalLevels.find(
              (l) => l.level === 2,
            );
            if (level2) {
              const approver2UserId = await this.resolveApproverUserId({
                level: level2,
                employee: {
                  departmentId: employee.departmentId,
                  subDepartmentId: employee.subDepartmentId,
                  reportingManager: employee.reportingManager,
                },
              });
              // If approver cannot be resolved, allow creation without approver
              if (approver2UserId) {
                approval2 = approver2UserId;
                approval2Status = 'pending';
              }
            }
          }

          const created = await tx.loanRequest.create({
            data: {
              employeeId: loanRequestItem.employeeId,
              loanTypeId: loanRequestItem.loanTypeId,
              amount: loanRequestItem.amount,
              requestedDate: requestedDate,
              repaymentStartMonthYear:
                loanRequestItem.repaymentStartMonthYear || null,
              numberOfInstallments:
                loanRequestItem.numberOfInstallments || null,
              reason: loanRequestItem.reason,
              additionalDetails: loanRequestItem.additionalDetails || null,
              approval1,
              approval1Status,
              approval1Date,
              approval2,
              approval2Status,
              approval2Date,
              approvalStatus,
              status,
              createdById: ctx.userId,
            },
            include: {
              employee: {
                select: {
                  id: true,
                  employeeId: true,
                  employeeName: true,
                  departmentId: true,
                  subDepartmentId: true,
                },
              },
            },
          });
          createdLoanRequests.push(created);
        }

        return createdLoanRequests;
      });

      // Enrich result with Master data
      const enrichedResult = await Promise.all(
        result.map(async (lr) => {
          const [department, subDepartment, createdBy] = await Promise.all([
            lr.employee?.departmentId
              ? this.prisma.department.findUnique({
                  where: { id: lr.employee.departmentId },
                  select: { id: true, name: true },
                })
              : null,
            lr.employee?.subDepartmentId
              ? this.prisma.subDepartment.findUnique({
                  where: { id: lr.employee.subDepartmentId },
                  select: { id: true, name: true },
                })
              : null,
            lr.createdById
              ? this.prismaMaster.user.findUnique({
                  where: { id: lr.createdById },
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                  },
                })
              : null,
          ]);

          return {
            ...lr,
            loanType: loanTypeMap.get(lr.loanTypeId) || null,
            employee: lr.employee
              ? {
                  ...lr.employee,
                  department,
                  subDepartment,
                }
              : null,
            createdBy,
          };
        }),
      );

      // Log activity
      if (Array.isArray(result) && result.length > 0 && ctx.userId) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'loan-request',
          entity: 'LoanRequest',
          entityId: result[0].id,
          description: 'Created loan request',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      return {
        status: true,
        data: enrichedResult.length === 1 ? enrichedResult[0] : enrichedResult,
        message: 'Loan request created successfully',
      };
    } catch (error) {
      console.error('Error creating loan request:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to create loan request',
      };
    }
  }

  async update(
    id: string,
    body: UpdateLoanRequestDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.loanRequest.findUnique({
        where: { id },
      });

      if (!existing) {
        return { status: false, message: 'Loan request not found' };
      }

      const updateData: any = {
        updatedById: ctx.userId,
      };

      if (body.loanTypeId !== undefined) {
        // Validate loan type exists
        const loanType = await this.prisma.loanType.findUnique({
          where: { id: body.loanTypeId },
        });
        if (!loanType || loanType.status !== 'active') {
          return { status: false, message: 'Loan type not found or inactive' };
        }
        updateData.loanTypeId = body.loanTypeId;
      }

      if (body.amount !== undefined) {
        updateData.amount = body.amount;
      }

      if (body.requestedDate !== undefined) {
        updateData.requestedDate = new Date(body.requestedDate);
      }

      if (body.repaymentStartMonthYear !== undefined) {
        updateData.repaymentStartMonthYear =
          body.repaymentStartMonthYear || null;
      }

      if (body.numberOfInstallments !== undefined) {
        updateData.numberOfInstallments = body.numberOfInstallments || null;
      }

      if (body.reason !== undefined) {
        updateData.reason = body.reason;
      }

      if (body.additionalDetails !== undefined) {
        updateData.additionalDetails = body.additionalDetails || null;
      }

      if (body.approvalStatus !== undefined) {
        updateData.approvalStatus = body.approvalStatus;
      }

      if (body.rejectionReason !== undefined) {
        updateData.rejectionReason = body.rejectionReason || null;
      }

      if (body.status !== undefined) {
        updateData.status = body.status;
      }

      const updated = await this.prisma.loanRequest.update({
        where: { id },
        data: updateData,
        include: {
          employee: {
            select: {
              id: true,
              employeeId: true,
              employeeName: true,
              departmentId: true,
              subDepartmentId: true,
            },
          },
        },
      });

      // Fetch Master data for enrichment
      const [
        loanType,
        department,
        subDepartment,
        approvedBy,
        createdBy,
        updatedBy,
      ] = await Promise.all([
        updated.loanTypeId
          ? this.prisma.loanType.findUnique({
              where: { id: updated.loanTypeId },
              select: { id: true, name: true },
            })
          : null,
        updated.employee?.departmentId
          ? this.prisma.department.findUnique({
              where: { id: updated.employee.departmentId },
              select: { id: true, name: true },
            })
          : null,
        updated.employee?.subDepartmentId
          ? this.prisma.subDepartment.findUnique({
              where: { id: updated.employee.subDepartmentId },
              select: { id: true, name: true },
            })
          : null,
        updated.approvedById
          ? this.prismaMaster.user.findUnique({
              where: { id: updated.approvedById },
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            })
          : null,
        updated.createdById
          ? this.prismaMaster.user.findUnique({
              where: { id: updated.createdById },
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            })
          : null,
        updated.updatedById
          ? this.prismaMaster.user.findUnique({
              where: { id: updated.updatedById },
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            })
          : null,
      ]);

      const enriched = {
        ...updated,
        loanType,
        employee: updated.employee
          ? {
              ...updated.employee,
              department,
              subDepartment,
            }
          : null,
        approvedBy,
        createdBy,
        updatedBy,
      };

      // Log activity
      if (ctx.userId) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'loan-request',
          entity: 'LoanRequest',
          entityId: id,
          description: 'Updated loan request',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      return {
        status: true,
        data: enriched,
        message: 'Loan request updated successfully',
      };
    } catch (error) {
      console.error('Error updating loan request:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to update loan request',
      };
    }
  }

  async approve(
    id: string,
    body: ApproveLoanRequestDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    return this.approveLevel(id, undefined, body, ctx);
  }

  async reject(
    id: string,
    body: ApproveLoanRequestDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    return this.rejectLevel(id, undefined, body, ctx);
  }

  async approveLevel(
    id: string,
    level: 1 | 2 | undefined,
    body: ApproveLoanRequestDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      if (!ctx.userId) {
        return { status: false, message: 'Unauthorized' };
      }

      const existing = await this.prisma.loanRequest.findUnique({
        where: { id },
        include: {
          employee: {
            select: {
              id: true,
              employeeId: true,
              employeeName: true,
              departmentId: true,
              subDepartmentId: true,
              reportingManager: true,
            },
          },
        },
      });

      if (!existing) {
        return { status: false, message: 'Loan request not found' };
      }

      if (existing.approvalStatus === 'approved') {
        return { status: false, message: 'Loan request already approved' };
      }

      if (existing.approvalStatus === 'rejected') {
        return { status: false, message: 'Loan request already rejected' };
      }

      const effectiveLevel = level || this.getPendingApprovalLevel(existing);
      if (!effectiveLevel) {
        return { status: false, message: 'No pending approval found' };
      }

      if (effectiveLevel === 1) {
        // If no approval1 is set, allow admin to approve directly (auto-approve)
        if (!(existing as any).approval1) {
          const nextApprovalStatus = (existing as any).approval2
            ? 'pending'
            : 'approved';
          const nextStatus =
            nextApprovalStatus === 'approved' ? 'approved' : 'pending';

          const updated = await this.prisma.loanRequest.update({
            where: { id },
            data: {
              approval1Status: 'approved',
              approval1Date: new Date(),
              approval1: ctx.userId,
              approvalStatus: nextApprovalStatus,
              status: nextStatus,
              approvedById: nextApprovalStatus === 'approved' ? ctx.userId : null,
              approvedAt: nextApprovalStatus === 'approved' ? new Date() : null,
              updatedById: ctx.userId,
            } as any,
            include: {
              employee: {
                select: {
                  id: true,
                  employeeId: true,
                  employeeName: true,
                  departmentId: true,
                  subDepartmentId: true,
                },
              },
            },
          });

          await this.activityLogs.log({
            userId: ctx.userId,
            action: 'approve',
            module: 'loan-request',
            entity: 'LoanRequest',
            entityId: id,
            description: 'Approved loan request (Level 1)',
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            status: 'success',
          });

          const enriched = await this.enrichSingleLoanRequest(updated);

          return {
            status: true,
            data: enriched,
            message: 'Loan request approved successfully',
          };
        }

        // Allow any authorized admin to approve (permission already checked by @Permissions guard)
        const nextApprovalStatus = (existing as any).approval2
          ? 'pending'
          : 'approved';
        const nextStatus =
          nextApprovalStatus === 'approved' ? 'approved' : 'pending';

        const updated = await this.prisma.loanRequest.update({
          where: { id },
          data: {
            approval1Status: 'approved',
            approval1Date: new Date(),
            approvalStatus: nextApprovalStatus,
            status: nextStatus,
            approvedById: nextApprovalStatus === 'approved' ? ctx.userId : null,
            approvedAt: nextApprovalStatus === 'approved' ? new Date() : null,
            updatedById: ctx.userId,
          } as any,
          include: {
            employee: {
              select: {
                id: true,
                employeeId: true,
                employeeName: true,
                departmentId: true,
                subDepartmentId: true,
              },
            },
          },
        });

        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'approve',
          module: 'loan-request',
          entity: 'LoanRequest',
          entityId: id,
          description: 'Approved loan request (Level 1)',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });

        const enriched = await this.enrichSingleLoanRequest(updated);

        return {
          status: true,
          data: enriched,
          message: 'Loan request approved successfully',
        };
      }

      if (effectiveLevel === 2) {
        if (
          (existing as any).approval1Status !== 'approved' &&
          (existing as any).approval1Status !== 'auto-approved'
        ) {
          return {
            status: false,
            message: 'Approval level 1 must be approved first',
          };
        }

        if (!(existing as any).approval2) {
          return {
            status: false,
            message: 'No approver configured for level 2',
          };
        }

        if ((existing as any).approval2 !== ctx.userId) {
          return { status: false, message: 'Forbidden' };
        }

        const updated = await this.prisma.loanRequest.update({
          where: { id },
          data: {
            approval2Status: 'approved',
            approval2Date: new Date(),
            approvalStatus: 'approved',
            status: 'approved',
            approvedById: ctx.userId,
            approvedAt: new Date(),
            updatedById: ctx.userId,
          } as any,
          include: {
            employee: {
              select: {
                id: true,
                employeeId: true,
                employeeName: true,
                departmentId: true,
                subDepartmentId: true,
              },
            },
          },
        });

        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'approve',
          module: 'loan-request',
          entity: 'LoanRequest',
          entityId: id,
          description: 'Approved loan request (Level 2)',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });

        const enriched = await this.enrichSingleLoanRequest(updated);

        return {
          status: true,
          data: enriched,
          message: 'Loan request approved successfully',
        };
      }

      return { status: false, message: 'Invalid approval level' };
    } catch (error) {
      console.error('Error approving loan request:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to approve loan request',
      };
    }
  }

  async rejectLevel(
    id: string,
    level: 1 | 2 | undefined,
    body: ApproveLoanRequestDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      if (!ctx.userId) {
        return { status: false, message: 'Unauthorized' };
      }

      const existing = await this.prisma.loanRequest.findUnique({
        where: { id },
        include: {
          employee: {
            select: {
              id: true,
              employeeId: true,
              employeeName: true,
            },
          },
        },
      });

      if (!existing) {
        return { status: false, message: 'Loan request not found' };
      }

      if (existing.approvalStatus === 'approved') {
        return { status: false, message: 'Loan request already approved' };
      }

      if (existing.approvalStatus === 'rejected') {
        return { status: false, message: 'Loan request already rejected' };
      }

      const effectiveLevel = level || this.getPendingApprovalLevel(existing);
      if (!effectiveLevel) {
        return { status: false, message: 'No pending approval found' };
      }

      if (effectiveLevel === 1) {
        // If no approval1 is set, allow admin to reject directly
        if (!(existing as any).approval1) {
          const updated = await this.prisma.loanRequest.update({
            where: { id },
            data: {
              approval1Status: 'rejected',
              approval1Date: new Date(),
              approval1: ctx.userId,
              approvalStatus: 'rejected',
              status: 'rejected',
              rejectionReason: body.rejectionReason || null,
              approvedById: ctx.userId,
              approvedAt: new Date(),
              updatedById: ctx.userId,
            } as any,
            include: {
              employee: {
                select: {
                  id: true,
                  employeeId: true,
                  employeeName: true,
                  departmentId: true,
                  subDepartmentId: true,
                },
              },
            },
          });

          await this.activityLogs.log({
            userId: ctx.userId,
            action: 'reject',
            module: 'loan-request',
            entity: 'LoanRequest',
            entityId: id,
            description: 'Rejected loan request (Level 1)',
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            status: 'success',
          });

          const enriched = await this.enrichSingleLoanRequest(updated);

          return {
            status: true,
            data: enriched,
            message: 'Loan request rejected successfully',
          };
        }

        // Allow any authorized admin to reject (permission already checked by @Permissions guard)
        const updated = await this.prisma.loanRequest.update({
          where: { id },
          data: {
            approval1Status: 'rejected',
            approval1Date: new Date(),
            approvalStatus: 'rejected',
            status: 'rejected',
            rejectionReason: body.rejectionReason || null,
            approvedById: ctx.userId,
            approvedAt: new Date(),
            updatedById: ctx.userId,
          } as any,
          include: {
            employee: {
              select: {
                id: true,
                employeeId: true,
                employeeName: true,
                departmentId: true,
                subDepartmentId: true,
              },
            },
          },
        });

        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'reject',
          module: 'loan-request',
          entity: 'LoanRequest',
          entityId: id,
          description: 'Rejected loan request (Level 1)',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });

        const enriched = await this.enrichSingleLoanRequest(updated);

        return {
          status: true,
          data: enriched,
          message: 'Loan request rejected successfully',
        };
      }

      if (effectiveLevel === 2) {
        if (
          (existing as any).approval1Status !== 'approved' &&
          (existing as any).approval1Status !== 'auto-approved'
        ) {
          return {
            status: false,
            message: 'Approval level 1 must be approved first',
          };
        }

        if (!(existing as any).approval2) {
          return {
            status: false,
            message: 'No approver configured for level 2',
          };
        }

        if ((existing as any).approval2 !== ctx.userId) {
          return { status: false, message: 'Forbidden' };
        }

        const updated = await this.prisma.loanRequest.update({
          where: { id },
          data: {
            approval2Status: 'rejected',
            approval2Date: new Date(),
            approvalStatus: 'rejected',
            status: 'rejected',
            rejectionReason: body.rejectionReason || null,
            approvedById: ctx.userId,
            approvedAt: new Date(),
            updatedById: ctx.userId,
          } as any,
          include: {
            employee: {
              select: {
                id: true,
                employeeId: true,
                employeeName: true,
                departmentId: true,
                subDepartmentId: true,
              },
            },
          },
        });

        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'reject',
          module: 'loan-request',
          entity: 'LoanRequest',
          entityId: id,
          description: 'Rejected loan request (Level 2)',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });

        const enriched = await this.enrichSingleLoanRequest(updated);

        return {
          status: true,
          data: enriched,
          message: 'Loan request rejected successfully',
        };
      }

      return {
        status: false,
        message: 'Invalid approval level',
      };
    } catch (error) {
      console.error('Error rejecting loan request:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to reject loan request',
      };
    }
  }

  async remove(
    id: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.loanRequest.findUnique({
        where: { id },
      });

      if (!existing) {
        return { status: false, message: 'Loan request not found' };
      }

      await this.prisma.loanRequest.delete({
        where: { id },
      });

      // Log activity
      if (ctx.userId) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'loan-request',
          entity: 'LoanRequest',
          entityId: id,
          description: 'Deleted loan request',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      return { status: true, message: 'Loan request deleted successfully' };
    } catch (error) {
      console.error('Error deleting loan request:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to delete loan request',
      };
    }
  }
}
