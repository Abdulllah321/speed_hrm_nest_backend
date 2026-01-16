import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import {
  CreateSocialSecurityInstitutionDto,
  UpdateSocialSecurityInstitutionDto,
  CreateSocialSecurityEmployerRegistrationDto,
  UpdateSocialSecurityEmployerRegistrationDto,
  CreateSocialSecurityEmployeeRegistrationDto,
  UpdateSocialSecurityEmployeeRegistrationDto,
  CreateSocialSecurityContributionDto,
  UpdateSocialSecurityContributionDto,
} from './dto/social-security.dto';

@Injectable()
export class SocialSecurityService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) {}

  // ========== Social Security Institution CRUD ==========
  async listInstitutions() {
    let items = await this.prisma.socialSecurityInstitution.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: {
            employerRegistrations: true,
            employeeRegistrations: true,
          },
        },
      },
    });

    // TEMPORARY DUMMY DATA FOR DEBUGGING
    if (items.length === 0) {
      console.log('[SocialSecurityService] returning dummy data for debugging');
      items = [
        {
          id: 'dummy-1',
          code: 'SESSI',
          name: 'Sindh Employees Social Security Institution',
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
          contributionRate: 6,
        } as any,
        {
          id: 'dummy-2',
          code: 'PESSI',
          name: 'Punjab Employees Social Security Institution',
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
          contributionRate: 6,
        } as any,
      ];
    }

    return { status: true, data: items };
  }

  async getInstitution(id: string) {
    const item = await this.prisma.socialSecurityInstitution.findUnique({
      where: { id },
      include: {
        employerRegistrations: true,
        employeeRegistrations: true,
      },
    });
    if (!item) return { status: false, message: 'Institution not found' };
    return { status: true, data: item };
  }

  async createInstitution(
    body: CreateSocialSecurityInstitutionDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const created = await this.prisma.socialSecurityInstitution.create({
        data: {
          code: body.code,
          name: body.name,
          province: body.province,
          description: body.description,
          status: body.status ?? 'active',
          website: body.website,
          contactNumber: body.contactNumber,
          address: body.address,
          contributionRate: body.contributionRate ?? 0,
          createdById: ctx.userId,
        },
      });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'social-security',
        entity: 'SocialSecurityInstitution',
        entityId: created.id,
        description: `Created social security institution ${created.name}`,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
      return { status: true, data: created, message: 'Created successfully' };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'social-security',
        entity: 'SocialSecurityInstitution',
        description: 'Failed to create institution',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to create institution' };
    }
  }

  async updateInstitution(
    id: string,
    body: UpdateSocialSecurityInstitutionDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.socialSecurityInstitution.findUnique({
        where: { id },
      });
      if (!existing) return { status: false, message: 'Institution not found' };
      const updated = await this.prisma.socialSecurityInstitution.update({
        where: { id },
        data: {
          code: body.code ?? existing.code,
          name: body.name ?? existing.name,
          province: body.province ?? existing.province,
          description: body.description ?? existing.description,
          status: body.status ?? existing.status,
          website: body.website ?? existing.website,
          contactNumber: body.contactNumber ?? existing.contactNumber,
          address: body.address ?? existing.address,
          contributionRate:
            body.contributionRate ?? (existing as any).contributionRate,
          updatedById: ctx.userId,
        },
      });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'social-security',
        entity: 'SocialSecurityInstitution',
        entityId: id,
        description: `Updated institution ${updated.name}`,
        oldValues: JSON.stringify(existing),
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
      return { status: true, data: updated, message: 'Updated successfully' };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'social-security',
        entity: 'SocialSecurityInstitution',
        entityId: id,
        description: 'Failed to update institution',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to update institution' };
    }
  }

  async removeInstitution(
    id: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.socialSecurityInstitution.findUnique({
        where: { id },
      });
      if (!existing) return { status: false, message: 'Institution not found' };
      await this.prisma.socialSecurityInstitution.delete({ where: { id } });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'social-security',
        entity: 'SocialSecurityInstitution',
        entityId: id,
        description: `Deleted institution ${existing.name}`,
        oldValues: JSON.stringify(existing),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
      return { status: true, message: 'Deleted successfully' };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'social-security',
        entity: 'SocialSecurityInstitution',
        entityId: id,
        description: 'Failed to delete institution',
        errorMessage: error?.message,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to delete institution' };
    }
  }

  // ========== Employer Registration CRUD ==========
  async listEmployerRegistrations(institutionId?: string) {
    const where = institutionId ? { institutionId } : {};
    const items = await this.prisma.socialSecurityEmployerRegistration.findMany(
      {
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          institution: true,
          _count: {
            select: {
              employeeRegistrations: true,
              contributions: true,
            },
          },
        },
      },
    );
    return { status: true, data: items };
  }

  async getEmployerRegistration(id: string) {
    const item =
      await this.prisma.socialSecurityEmployerRegistration.findUnique({
        where: { id },
        include: {
          institution: true,
          employeeRegistrations: true,
          contributions: {
            take: 10,
            orderBy: { createdAt: 'desc' },
          },
        },
      });
    if (!item)
      return { status: false, message: 'Employer registration not found' };
    return { status: true, data: item };
  }

  async createEmployerRegistration(
    body: CreateSocialSecurityEmployerRegistrationDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const created =
        await this.prisma.socialSecurityEmployerRegistration.create({
          data: {
            institutionId: body.institutionId,
            registrationNumber: body.registrationNumber,
            employerName: body.employerName,
            employerType: body.employerType,
            businessAddress: body.businessAddress,
            businessCity: body.businessCity,
            businessState: body.businessState,
            businessCountry: body.businessCountry,
            contactPerson: body.contactPerson,
            contactNumber: body.contactNumber,
            email: body.email,
            registrationDate: new Date(body.registrationDate),
            expiryDate: body.expiryDate ? new Date(body.expiryDate) : null,
            status: body.status ?? 'active',
            totalEmployees: body.totalEmployees ?? 0,
            monthlyContribution: body.monthlyContribution
              ? (body.monthlyContribution as any)
              : null,
            notes: body.notes,
            documentUrls: body.documentUrls as any,
            createdById: ctx.userId,
          },
        });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'social-security',
        entity: 'SocialSecurityEmployerRegistration',
        entityId: created.id,
        description: `Created employer registration ${created.registrationNumber}`,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
      return { status: true, data: created, message: 'Created successfully' };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'social-security',
        entity: 'SocialSecurityEmployerRegistration',
        description: 'Failed to create employer registration',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return {
        status: false,
        message: 'Failed to create employer registration',
      };
    }
  }

  async updateEmployerRegistration(
    id: string,
    body: UpdateSocialSecurityEmployerRegistrationDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing =
        await this.prisma.socialSecurityEmployerRegistration.findUnique({
          where: { id },
        });
      if (!existing)
        return { status: false, message: 'Employer registration not found' };
      const updated =
        await this.prisma.socialSecurityEmployerRegistration.update({
          where: { id },
          data: {
            registrationNumber:
              body.registrationNumber ?? existing.registrationNumber,
            employerName: body.employerName ?? existing.employerName,
            employerType: body.employerType ?? existing.employerType,
            businessAddress: body.businessAddress ?? existing.businessAddress,
            businessCity: body.businessCity ?? existing.businessCity,
            businessState: body.businessState ?? existing.businessState,
            businessCountry: body.businessCountry ?? existing.businessCountry,
            contactPerson: body.contactPerson ?? existing.contactPerson,
            contactNumber: body.contactNumber ?? existing.contactNumber,
            email: body.email ?? existing.email,
            registrationDate: body.registrationDate
              ? new Date(body.registrationDate)
              : existing.registrationDate,
            expiryDate: body.expiryDate
              ? new Date(body.expiryDate)
              : existing.expiryDate,
            status: body.status ?? existing.status,
            totalEmployees: body.totalEmployees ?? existing.totalEmployees,
            monthlyContribution: body.monthlyContribution
              ? (body.monthlyContribution as any)
              : existing.monthlyContribution,
            notes: body.notes ?? existing.notes,
            documentUrls: body.documentUrls
              ? (body.documentUrls as any)
              : existing.documentUrls,
            updatedById: ctx.userId,
          },
        });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'social-security',
        entity: 'SocialSecurityEmployerRegistration',
        entityId: id,
        description: `Updated employer registration ${updated.registrationNumber}`,
        oldValues: JSON.stringify(existing),
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
      return { status: true, data: updated, message: 'Updated successfully' };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'social-security',
        entity: 'SocialSecurityEmployerRegistration',
        entityId: id,
        description: 'Failed to update employer registration',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return {
        status: false,
        message: 'Failed to update employer registration',
      };
    }
  }

  async removeEmployerRegistration(
    id: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing =
        await this.prisma.socialSecurityEmployerRegistration.findUnique({
          where: { id },
        });
      if (!existing)
        return { status: false, message: 'Employer registration not found' };
      await this.prisma.socialSecurityEmployerRegistration.delete({
        where: { id },
      });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'social-security',
        entity: 'SocialSecurityEmployerRegistration',
        entityId: id,
        description: `Deleted employer registration ${existing.registrationNumber}`,
        oldValues: JSON.stringify(existing),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
      return { status: true, message: 'Deleted successfully' };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'social-security',
        entity: 'SocialSecurityEmployerRegistration',
        entityId: id,
        description: 'Failed to delete employer registration',
        errorMessage: error?.message,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return {
        status: false,
        message: 'Failed to delete employer registration',
      };
    }
  }

  // ========== Employee Registration CRUD ==========
  async listEmployeeRegistrations(
    employeeId?: string,
    institutionId?: string,
    employerRegistrationId?: string,
  ) {
    const where: any = {};
    if (employeeId) where.employeeId = employeeId;
    if (institutionId) where.institutionId = institutionId;
    if (employerRegistrationId)
      where.employerRegistrationId = employerRegistrationId;
    const items = await this.prisma.socialSecurityEmployeeRegistration.findMany(
      {
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          institution: true,
          employerRegistration: true,
          employee: {
            select: {
              id: true,
              employeeId: true,
              employeeName: true,
              department: { select: { id: true, name: true } },
            },
          },
        },
      },
    );
    return { status: true, data: items };
  }

  async getEmployeeRegistration(id: string) {
    const item =
      await this.prisma.socialSecurityEmployeeRegistration.findUnique({
        where: { id },
        include: {
          institution: true,
          employerRegistration: true,
          employee: true,
          contributions: {
            take: 12,
            orderBy: { createdAt: 'desc' },
          },
        },
      });
    if (!item)
      return { status: false, message: 'Employee registration not found' };
    return { status: true, data: item };
  }

  async createEmployeeRegistration(
    body: CreateSocialSecurityEmployeeRegistrationDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const created =
        await this.prisma.socialSecurityEmployeeRegistration.create({
          data: {
            institutionId: body.institutionId,
            employerRegistrationId: body.employerRegistrationId,
            employeeId: body.employeeId,
            registrationNumber: body.registrationNumber,
            cardNumber: body.cardNumber,
            registrationDate: new Date(body.registrationDate),
            expiryDate: body.expiryDate ? new Date(body.expiryDate) : null,
            status: body.status ?? 'active',
            contributionRate: body.contributionRate as any,
            baseSalary: body.baseSalary as any,
            monthlyContribution: body.monthlyContribution as any,
            isEmployerContribution: body.isEmployerContribution ?? true,
            employeeContribution: body.employeeContribution
              ? (body.employeeContribution as any)
              : null,
            employerContribution: body.employerContribution
              ? (body.employerContribution as any)
              : null,
            cardIssueDate: body.cardIssueDate
              ? new Date(body.cardIssueDate)
              : null,
            cardExpiryDate: body.cardExpiryDate
              ? new Date(body.cardExpiryDate)
              : null,
            cardStatus: body.cardStatus,
            documentUrls: body.documentUrls as any,
            notes: body.notes,
            createdById: ctx.userId,
          },
        });

      // If contributionRate was not provided, update it from institution
      if (
        body.contributionRate === undefined ||
        body.contributionRate === null
      ) {
        const inst = await this.prisma.socialSecurityInstitution.findUnique({
          where: { id: body.institutionId },
        });
        if (inst) {
          await this.prisma.socialSecurityEmployeeRegistration.update({
            where: { id: created.id },
            data: {
              contributionRate: (inst as any).contributionRate,
              monthlyContribution:
                (Number((inst as any).contributionRate) *
                  Number(body.baseSalary)) /
                100,
            },
          });
        }
      }
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'social-security',
        entity: 'SocialSecurityEmployeeRegistration',
        entityId: created.id,
        description: `Created employee registration ${created.registrationNumber}`,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
      return { status: true, data: created, message: 'Created successfully' };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'social-security',
        entity: 'SocialSecurityEmployeeRegistration',
        description: 'Failed to create employee registration',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return {
        status: false,
        message: 'Failed to create employee registration',
      };
    }
  }

  async updateEmployeeRegistration(
    id: string,
    body: UpdateSocialSecurityEmployeeRegistrationDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing =
        await this.prisma.socialSecurityEmployeeRegistration.findUnique({
          where: { id },
        });
      if (!existing)
        return { status: false, message: 'Employee registration not found' };
      const updated =
        await this.prisma.socialSecurityEmployeeRegistration.update({
          where: { id },
          data: {
            registrationNumber:
              body.registrationNumber ?? existing.registrationNumber,
            cardNumber: body.cardNumber ?? existing.cardNumber,
            registrationDate: body.registrationDate
              ? new Date(body.registrationDate)
              : existing.registrationDate,
            expiryDate: body.expiryDate
              ? new Date(body.expiryDate)
              : existing.expiryDate,
            status: body.status ?? existing.status,
            contributionRate: body.contributionRate
              ? (body.contributionRate as any)
              : (existing as any).contributionRate,
            baseSalary: body.baseSalary
              ? (body.baseSalary as any)
              : existing.baseSalary,
            monthlyContribution: body.monthlyContribution
              ? (body.monthlyContribution as any)
              : existing.monthlyContribution,
            isEmployerContribution:
              body.isEmployerContribution ?? existing.isEmployerContribution,
            employeeContribution: body.employeeContribution
              ? (body.employeeContribution as any)
              : existing.employeeContribution,
            employerContribution: body.employerContribution
              ? (body.employerContribution as any)
              : existing.employerContribution,
            cardIssueDate: body.cardIssueDate
              ? new Date(body.cardIssueDate)
              : existing.cardIssueDate,
            cardExpiryDate: body.cardExpiryDate
              ? new Date(body.cardExpiryDate)
              : existing.cardExpiryDate,
            cardStatus: body.cardStatus ?? existing.cardStatus,
            documentUrls: body.documentUrls
              ? (body.documentUrls as any)
              : existing.documentUrls,
            notes: body.notes ?? existing.notes,
            updatedById: ctx.userId,
          },
        });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'social-security',
        entity: 'SocialSecurityEmployeeRegistration',
        entityId: id,
        description: `Updated employee registration ${updated.registrationNumber}`,
        oldValues: JSON.stringify(existing),
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
      return { status: true, data: updated, message: 'Updated successfully' };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'social-security',
        entity: 'SocialSecurityEmployeeRegistration',
        entityId: id,
        description: 'Failed to update employee registration',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return {
        status: false,
        message: 'Failed to update employee registration',
      };
    }
  }

  async removeEmployeeRegistration(
    id: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing =
        await this.prisma.socialSecurityEmployeeRegistration.findUnique({
          where: { id },
        });
      if (!existing)
        return { status: false, message: 'Employee registration not found' };
      await this.prisma.socialSecurityEmployeeRegistration.delete({
        where: { id },
      });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'social-security',
        entity: 'SocialSecurityEmployeeRegistration',
        entityId: id,
        description: `Deleted employee registration ${existing.registrationNumber}`,
        oldValues: JSON.stringify(existing),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
      return { status: true, message: 'Deleted successfully' };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'social-security',
        entity: 'SocialSecurityEmployeeRegistration',
        entityId: id,
        description: 'Failed to delete employee registration',
        errorMessage: error?.message,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return {
        status: false,
        message: 'Failed to delete employee registration',
      };
    }
  }

  // ========== Contribution CRUD ==========
  async listContributions(
    employeeId?: string,
    institutionId?: string,
    month?: string,
    year?: string,
  ) {
    const where: any = {};
    if (employeeId) where.employeeId = employeeId;
    if (institutionId) where.institutionId = institutionId;
    if (month) where.month = month;
    if (year) where.year = year;
    const items = await this.prisma.socialSecurityContribution.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        institution: true,
        employerRegistration: true,
        employeeRegistration: true,
        employee: {
          select: {
            id: true,
            employeeId: true,
            employeeName: true,
          },
        },
      },
    });
    return { status: true, data: items };
  }

  async getContribution(id: string) {
    const item = await this.prisma.socialSecurityContribution.findUnique({
      where: { id },
      include: {
        institution: true,
        employerRegistration: true,
        employeeRegistration: true,
        employee: true,
        payrollDetail: true,
      },
    });
    if (!item) return { status: false, message: 'Contribution not found' };
    return { status: true, data: item };
  }

  async createContribution(
    body: CreateSocialSecurityContributionDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const created = await this.prisma.socialSecurityContribution.create({
        data: {
          institutionId: body.institutionId,
          employerRegistrationId: body.employerRegistrationId,
          employeeRegistrationId: body.employeeRegistrationId,
          employeeId: body.employeeId,
          month: body.month,
          year: body.year,
          date: new Date(body.date),
          baseSalary: body.baseSalary as any,
          contributionRate: body.contributionRate as any,
          contributionAmount: body.contributionAmount as any,
          employeeContribution: body.employeeContribution
            ? (body.employeeContribution as any)
            : null,
          employerContribution: body.employerContribution
            ? (body.employerContribution as any)
            : null,
          paymentStatus: body.paymentStatus ?? 'pending',
          paymentDate: body.paymentDate ? new Date(body.paymentDate) : null,
          paymentReference: body.paymentReference,
          dueDate: body.dueDate ? new Date(body.dueDate) : null,
          lateFee: body.lateFee ? (body.lateFee as any) : null,
          notes: body.notes,
          status: body.status ?? 'active',
          payrollDetailId: body.payrollDetailId,
          createdById: ctx.userId,
        },
      });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'social-security',
        entity: 'SocialSecurityContribution',
        entityId: created.id,
        description: `Created contribution for employee ${body.employeeId}`,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
      return { status: true, data: created, message: 'Created successfully' };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'social-security',
        entity: 'SocialSecurityContribution',
        description: 'Failed to create contribution',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to create contribution' };
    }
  }

  async updateContribution(
    id: string,
    body: UpdateSocialSecurityContributionDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.socialSecurityContribution.findUnique({
        where: { id },
      });
      if (!existing)
        return { status: false, message: 'Contribution not found' };
      const updated = await this.prisma.socialSecurityContribution.update({
        where: { id },
        data: {
          baseSalary: body.baseSalary
            ? (body.baseSalary as any)
            : existing.baseSalary,
          contributionRate: body.contributionRate
            ? (body.contributionRate as any)
            : (existing as any).contributionRate,
          contributionAmount: body.contributionAmount
            ? (body.contributionAmount as any)
            : existing.contributionAmount,
          employeeContribution: body.employeeContribution
            ? (body.employeeContribution as any)
            : existing.employeeContribution,
          employerContribution: body.employerContribution
            ? (body.employerContribution as any)
            : existing.employerContribution,
          paymentStatus: body.paymentStatus ?? existing.paymentStatus,
          paymentDate: body.paymentDate
            ? new Date(body.paymentDate)
            : existing.paymentDate,
          paymentReference: body.paymentReference ?? existing.paymentReference,
          dueDate: body.dueDate ? new Date(body.dueDate) : existing.dueDate,
          lateFee: body.lateFee ? (body.lateFee as any) : existing.lateFee,
          notes: body.notes ?? existing.notes,
          status: body.status ?? existing.status,
          payrollDetailId: body.payrollDetailId ?? existing.payrollDetailId,
          updatedById: ctx.userId,
        },
      });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'social-security',
        entity: 'SocialSecurityContribution',
        entityId: id,
        description: `Updated contribution ${id}`,
        oldValues: JSON.stringify(existing),
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
      return { status: true, data: updated, message: 'Updated successfully' };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'social-security',
        entity: 'SocialSecurityContribution',
        entityId: id,
        description: 'Failed to update contribution',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to update contribution' };
    }
  }

  async removeContribution(
    id: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.socialSecurityContribution.findUnique({
        where: { id },
      });
      if (!existing)
        return { status: false, message: 'Contribution not found' };
      await this.prisma.socialSecurityContribution.delete({ where: { id } });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'social-security',
        entity: 'SocialSecurityContribution',
        entityId: id,
        description: `Deleted contribution ${id}`,
        oldValues: JSON.stringify(existing),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
      return { status: true, message: 'Deleted successfully' };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'social-security',
        entity: 'SocialSecurityContribution',
        entityId: id,
        description: 'Failed to delete contribution',
        errorMessage: error?.message,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to delete contribution' };
    }
  }
}
